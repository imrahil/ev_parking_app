// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { allStations, apiStation, BUSY, FREE, jsonResponse, ref, requestUrl } from '../test/fixtures'
import type { StationRef } from '../types'

/**
 * api.ts reads VITE_API_URL at import, so each test loads a fresh module graph
 * for its mode. Testing Library comes along so it shares that graph's React.
 */
async function load(apiUrl: string) {
  vi.stubEnv('VITE_API_URL', apiUrl)
  vi.resetModules()
  const rtl = await import('@testing-library/react')
  const { useStations } = await import('./useStations')
  return { ...rtl, useStations }
}

const API = 'https://worker.test/stations'

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('API mode', () => {
  it('makes one request for the whole board and never loads stations.json', async () => {
    const payload = allStations([[ref(1, 'A'), FREE], [ref(2, 'B'), BUSY]], 1_000)
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(payload))
    vi.stubGlobal('fetch', fetch)
    const { renderHook, waitFor, useStations } = await load(API)

    const { result } = renderHook(() => useStations(60_000))

    await waitFor(() => expect(result.current.refs).toHaveLength(2))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(requestUrl(fetch.mock.calls[0][0])).toBe(API)
    expect(result.current.refs).toEqual([ref(1, 'A'), ref(2, 'B')])
  })

  it("stamps fetchedAt with the worker's updatedAt, not the browser's clock", async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(allStations([[ref(1), FREE]], 42)))
    const { renderHook, waitFor, useStations } = await load(API)

    const { result } = renderHook(() => useStations(60_000))

    await waitFor(() => expect(result.current.views[ref(1).id]).toBeDefined())
    expect(result.current.views[ref(1).id]).toMatchObject({ fetchedAt: 42, loading: false, error: null })
  })

  it('passes per-station upstream errors through to the view', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(allStations([[ref(1), null]])))
    const { renderHook, waitFor, useStations } = await load(API)

    const { result } = renderHook(() => useStations(60_000))

    await waitFor(() => expect(result.current.views[ref(1).id]?.error).toBe('HTTP 503'))
    expect(result.current.views[ref(1).id].data).toBeNull()
  })

  it('a failed refresh reports refsError but keeps the last board', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(allStations([[ref(1), FREE]])))
      .mockResolvedValueOnce(jsonResponse({ error: 'upstream' }, 502))
      .mockResolvedValueOnce(jsonResponse(allStations([[ref(1), BUSY]])))
    vi.stubGlobal('fetch', fetch)
    const { renderHook, waitFor, useStations } = await load(API)

    const { result } = renderHook(() => useStations(60_000))
    await waitFor(() => expect(result.current.views[ref(1).id]?.data?.State).toBe(FREE))

    setVisibility('visible')
    await waitFor(() => expect(result.current.refsError).toBe('HTTP 502'))
    expect(result.current.views[ref(1).id].data?.State).toBe(FREE)

    setVisibility('visible')
    await waitFor(() => expect(result.current.refsError).toBeNull())
    expect(result.current.views[ref(1).id].data?.State).toBe(BUSY)
  })

  it('refreshes on the interval and when the app comes back into view', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(allStations([[ref(1), FREE]])))
    vi.stubGlobal('fetch', fetch)
    const { act, renderHook, waitFor, useStations } = await load(API)

    renderHook(() => useStations(60_000))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    await act(async () => vi.advanceTimersByTime(60_000))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))

    setVisibility('hidden')
    expect(fetch).toHaveBeenCalledTimes(2)
    setVisibility('visible')
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
  })

  it('skips a refresh while the previous one is still in flight', async () => {
    let release!: () => void
    const fetch = vi.fn(
      () => new Promise<Response>((resolve) => (release = () => resolve(jsonResponse(allStations([[ref(1), FREE]]))))),
    )
    vi.stubGlobal('fetch', fetch)
    const { act, renderHook, waitFor, useStations } = await load(API)

    const { result } = renderHook(() => useStations(60_000))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    setVisibility('visible')
    setVisibility('visible')
    expect(fetch).toHaveBeenCalledTimes(1)

    await act(async () => release())
    await waitFor(() => expect(result.current.refs).toHaveLength(1))
  })

  it('a StrictMode remount still gets its first refresh', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(allStations([[ref(1), FREE]])))
    vi.stubGlobal('fetch', fetch)
    const { renderHook, waitFor, useStations } = await load(API)
    const { StrictMode } = await import('react')

    const { result } = renderHook(() => useStations(60_000), { wrapper: StrictMode })

    await waitFor(() => expect(result.current.views[ref(1).id]?.data?.State).toBe(FREE))
  })
})

describe('direct mode (no worker)', () => {
  const refs: StationRef[] = [ref(1, 'A'), ref(2, 'A')]

  function stubUpstream(states: Record<string, number | 'fail'>) {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.endsWith('stations.json')) return jsonResponse(refs)
      const id = new URL(url).searchParams.get('id')!
      const state = states[id]
      if (state === 'fail') return jsonResponse({}, 500)
      return jsonResponse(apiStation(refs.find((r) => r.id === id)!, state))
    })
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('loads stations.json, shows loading cards, then polls ecarup per station', async () => {
    const fetch = stubUpstream({ [refs[0].id]: FREE, [refs[1].id]: BUSY })
    const { renderHook, waitFor, useStations } = await load('')

    const { result } = renderHook(() => useStations(60_000))

    await waitFor(() => expect(result.current.refs).toEqual(refs))
    await waitFor(() => expect(result.current.views[refs[1].id].data?.State).toBe(BUSY))
    const urls = fetch.mock.calls.map(([i]) => requestUrl(i))
    expect(urls[0]).toMatch(/stations\.json$/)
    expect(urls.filter((u) => u.startsWith('https://www.ecarup.com/'))).toHaveLength(2)
    expect(result.current.views[refs[0].id].fetchedAt).toBeGreaterThan(0)
  })

  it('a failing station keeps its last data and shows the error', async () => {
    const states: Record<string, number | 'fail'> = { [refs[0].id]: FREE, [refs[1].id]: BUSY }
    stubUpstream(states)
    const { renderHook, waitFor, useStations } = await load('')

    const { result } = renderHook(() => useStations(60_000))
    await waitFor(() => expect(result.current.views[refs[0].id].data?.State).toBe(FREE))

    states[refs[0].id] = 'fail'
    setVisibility('visible')

    await waitFor(() => expect(result.current.views[refs[0].id].error).toBe('HTTP 500'))
    expect(result.current.views[refs[0].id].data?.State).toBe(FREE)
    expect(result.current.views[refs[1].id].error).toBeNull()
  })

  it('reports a missing stations.json as refsError', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({}, 404))
    const { renderHook, waitFor, useStations } = await load('')

    const { result } = renderHook(() => useStations(60_000))

    await waitFor(() => expect(result.current.refsError).toBe('Failed to load stations.json: 404'))
  })
})
