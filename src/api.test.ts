import { describe, expect, it, vi } from 'vitest'
import {
  API_URL,
  armWatch,
  disarmWatch,
  fetchAllStations,
  fetchStation,
  fetchWatches,
  stateToStatus,
  subIdFor,
} from './api'
import { STATUS } from './consts/consts'
import { allStations, BUSY, FREE, jsonResponse, OFFLINE, ref, requestUrl, uuid } from './test/fixtures'

describe('stateToStatus', () => {
  it('maps the ecarup state codes', () => {
    expect(stateToStatus(FREE)).toBe(STATUS.AVAILABLE)
    expect(stateToStatus(BUSY)).toBe(STATUS.OCCUPIED)
  })

  it('treats every other code, and a missing one, as unknown', () => {
    for (const s of [OFFLINE, 3, 99, -1, undefined]) expect(stateToStatus(s)).toBe(STATUS.UNKNOWN)
  })
})

describe('subIdFor', () => {
  it('is the base64url SHA-256 of the endpoint, unpadded', async () => {
    const id = await subIdFor('https://fcm.googleapis.com/fcm/send/a')
    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(id).toBe(Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode('https://fcm.googleapis.com/fcm/send/a')),
    ).toString('base64url'))
  })
})

describe('worker client', () => {
  it('is in API mode in tests (VITE_API_URL comes from the committed .env)', () => {
    expect(API_URL).toMatch(/^https:\/\//)
  })

  it('fetchAllStations returns the worker payload as-is', async () => {
    const payload = allStations([[ref(1, 'A'), FREE]], 1234)
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(payload))
    vi.stubGlobal('fetch', fetch)

    await expect(fetchAllStations()).resolves.toEqual(payload)
    expect(requestUrl(fetch.mock.calls[0][0])).toBe(API_URL)
  })

  it('fetchAllStations rejects on a non-2xx response', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ error: 'boom' }, 502))
    await expect(fetchAllStations()).rejects.toThrow('HTTP 502')
  })

  it('fetchStation asks ecarup for one station, id encoded', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}))
    vi.stubGlobal('fetch', fetch)

    await fetchStation('a b')
    expect(requestUrl(fetch.mock.calls[0][0])).toBe('https://www.ecarup.com/api/stations?id=a%20b')
  })

  it('armWatch POSTs the subscription next to /stations and surfaces the worker error', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ error: 'Too many watches' }, 429))
    vi.stubGlobal('fetch', fetch)
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/a', expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }

    await expect(armWatch(subscription, uuid(1))).rejects.toThrow('Too many watches')

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(new URL('watch', API_URL).toString())
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ subscription, stationId: uuid(1) })
  })

  it('disarmWatch sends only the endpoint, never the keys', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetch)

    await disarmWatch('https://fcm.googleapis.com/fcm/send/a', uuid(2))

    const [, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body as string)).toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/a', stationId: uuid(2) })
  })

  it('fetchWatches looks watches up by subscription id', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ stations: [uuid(3)] }))
    vi.stubGlobal('fetch', fetch)

    await expect(fetchWatches('a+b')).resolves.toEqual([uuid(3)])
    expect(requestUrl(fetch.mock.calls[0][0])).toBe(new URL('watches?sub=a%2Bb', API_URL).toString())
  })
})
