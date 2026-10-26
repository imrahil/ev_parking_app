// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { jsonResponse, requestUrl, uuid } from '../test/fixtures'

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1'

/** usePushWatch reads both env values at import, so load it fresh per test. */
async function load(env: { api?: string; vapid?: string } = {}) {
  vi.stubEnv('VITE_API_URL', env.api ?? 'https://worker.test/stations')
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', env.vapid ?? 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U')
  vi.resetModules()
  const rtl = await import('@testing-library/react')
  const { usePushWatch } = await import('./usePushWatch')
  return { ...rtl, usePushWatch }
}

/** The browser push stack: permission prompt, SW registration, PushManager. */
function stubPushApis(opts: { permission?: NotificationPermission; prompt?: NotificationPermission; subscribed?: boolean } = {}) {
  let subscription: { endpoint: string; toJSON: () => unknown } | null = opts.subscribed
    ? { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }) }
    : null
  const pushManager = {
    getSubscription: async () => subscription,
    subscribe: vi.fn(async () => {
      subscription = { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }) }
      return subscription
    }),
  }
  const reg = { pushManager }
  const requestPermission = vi.fn(async () => opts.prompt ?? 'granted')
  vi.stubGlobal('Notification', Object.assign(function Notification() {}, { permission: opts.permission ?? 'default', requestPermission }))
  vi.stubGlobal('PushManager', function PushManager() {})
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: vi.fn(async () => reg), ready: Promise.resolve(reg), getRegistration: async () => reg },
  })
  return { pushManager, requestPermission }
}

function stubWorker(watches: string[] = []) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    if (url.includes('/watches?')) return jsonResponse({ stations: watches })
    if (url.endsWith('/watch')) return jsonResponse({ ok: true })
    throw new Error(`unexpected fetch ${init?.method ?? 'GET'} ${url}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('detected state', () => {
  it('is unconfigured without a worker URL or a VAPID key', async () => {
    stubPushApis()
    for (const env of [{ api: '' }, { vapid: '' }]) {
      const { renderHook, usePushWatch, cleanup } = await load(env)
      const { result } = renderHook(() => usePushWatch())
      expect(result.current.state).toBe('unconfigured')
      cleanup()
    }
  })

  it('is ready when the push APIs exist, blocked once permission is denied', async () => {
    stubWorker()
    stubPushApis()
    let { renderHook, usePushWatch } = await load()
    expect(renderHook(() => usePushWatch()).result.current.state).toBe('ready')

    stubPushApis({ permission: 'denied' })
    ;({ renderHook, usePushWatch } = await load())
    expect(renderHook(() => usePushWatch()).result.current.state).toBe('blocked')
  })

  it('asks iPhone users in a Safari tab to install the app first', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
    const { renderHook, usePushWatch } = await load()
    expect(renderHook(() => usePushWatch()).result.current.state).toBe('needs-install')
  })

  it('is unsupported on a desktop browser without push', async () => {
    const { renderHook, usePushWatch } = await load()
    expect(renderHook(() => usePushWatch()).result.current.state).toBe('unsupported')
  })
})

describe('arming and disarming', () => {
  it('asks permission, subscribes, arms on the worker and remembers the watch', async () => {
    const { pushManager, requestPermission } = stubPushApis()
    const fetch = stubWorker()
    const { act, renderHook, usePushWatch } = await load()
    const { result } = renderHook(() => usePushWatch())

    await act(() => result.current.toggle(uuid(1)))

    expect(requestPermission).toHaveBeenCalledOnce()
    expect(pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ stationId: uuid(1), subscription: { endpoint: ENDPOINT } })
    expect(result.current.watches).toEqual([uuid(1)])
    expect(result.current.busy).toBeNull()
    expect(JSON.parse(localStorage.getItem('parking-app:watches')!)).toEqual([uuid(1)])
  })

  it('a denied prompt flips to blocked without calling the worker', async () => {
    stubPushApis({ prompt: 'denied' })
    const fetch = stubWorker()
    const { act, renderHook, usePushWatch } = await load()
    const { result } = renderHook(() => usePushWatch())

    await act(() => result.current.toggle(uuid(1)))

    expect(result.current.state).toBe('blocked')
    expect(result.current.watches).toEqual([])
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('toggling an armed station disarms it', async () => {
    stubPushApis({ subscribed: true })
    const fetch = stubWorker([uuid(2)])
    const { act, renderHook, usePushWatch, waitFor } = await load()
    const { result } = renderHook(() => usePushWatch())
    await waitFor(() => expect(result.current.watches).toEqual([uuid(2)]))

    await act(() => result.current.toggle(uuid(2)))

    const del = fetch.mock.calls.find(([, init]) => init?.method === 'DELETE')!
    expect(JSON.parse(del[1]!.body as string)).toEqual({ endpoint: ENDPOINT, stationId: uuid(2) })
    expect(result.current.watches).toEqual([])
  })

  it('a worker error is reported and the watch is not recorded', async () => {
    stubPushApis()
    vi.stubGlobal('fetch', async () => jsonResponse({ error: 'Too many watches' }, 429))
    const { act, renderHook, usePushWatch } = await load()
    const { result } = renderHook(() => usePushWatch())

    await act(() => result.current.toggle(uuid(1)))

    expect(result.current.error).toBe('Too many watches')
    expect(result.current.watches).toEqual([])
  })

  it('the server list replaces stale local watches (one-shot, expiring)', async () => {
    localStorage.setItem('parking-app:watches', JSON.stringify([uuid(1), uuid(2)]))
    stubPushApis({ subscribed: true })
    stubWorker([uuid(2)])
    const { renderHook, usePushWatch, waitFor } = await load()
    const { result } = renderHook(() => usePushWatch())

    expect(result.current.watches).toEqual([uuid(1), uuid(2)])
    await waitFor(() => expect(result.current.watches).toEqual([uuid(2)]))
  })
})
