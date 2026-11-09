// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { allStations, FREE, jsonResponse, ref, requestUrl } from '../test/fixtures'

async function load(apiUrl: string) {
  vi.stubEnv('VITE_API_URL', apiUrl)
  vi.resetModules()
  const rtl = await import('@testing-library/react')
  const { useHistory } = await import('./useHistory')
  return { ...rtl, useHistory }
}

const API = 'https://worker.test/stations'

describe('useHistory', () => {
  it('loads /history from the worker', async () => {
    const history = { t: [1, 2], p: { a: [1, null] } }
    const fetch = vi.fn(async (_i: RequestInfo | URL) => jsonResponse(history))
    vi.stubGlobal('fetch', fetch)
    const { renderHook, waitFor, useHistory } = await load(API)

    const { result } = renderHook(() => useHistory())

    await waitFor(() => expect(result.current).toEqual(history))
    expect(requestUrl(fetch.mock.calls[0][0])).toBe('https://worker.test/history')
  })

  it('stays null on a malformed or failed response', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(allStations([[ref(1), FREE]])))
    const { renderHook, useHistory } = await load(API)
    const { result } = renderHook(() => useHistory())
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current).toBeNull()
  })

  it('does nothing in direct mode', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const { renderHook, useHistory } = await load('')
    const { result } = renderHook(() => useHistory())
    await new Promise((r) => setTimeout(r, 20))
    expect(fetch).not.toHaveBeenCalled()
    expect(result.current).toBeNull()
  })
})
