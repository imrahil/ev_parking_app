/**
 * Contract tests: the frontend's API client talking to the real worker
 * (worker/src/worker.js) in-process, over a mock KV. Only the outside world -
 * stations.json and ecarup.com - is faked. If the payload shape or the
 * subscription id ever drift between the two sides, these fail.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../worker/src/worker.js'
import { subId } from '../worker/src/push.js'
import { API_URL, armWatch, disarmWatch, fetchAllStations, fetchWatches, subIdFor } from './api'
import { apiStation, BUSY, FREE, jsonResponse, ref, requestUrl } from './test/fixtures'
import type { StationRef } from './types'

const STATIONS_JSON_URL = 'https://pages.test/stations.json'
const ORIGIN = 'https://imrahil.github.io'

function makeKV() {
  const store = new Map<string, string>()
  return {
    store,
    async get(key: string, type?: string) {
      const v = store.get(key)
      return v === undefined ? null : type === 'json' ? JSON.parse(v) : v
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit)
      return { keys: keys.map((name) => ({ name })), list_complete: true }
    },
  }
}

let kv: ReturnType<typeof makeKV>
let board: { refs: StationRef[]; states: Record<string, number | 'down'> }
let upstreamCalls: string[]

const env = () => ({
  CACHE: kv,
  STATIONS_JSON_URL,
  ALLOWED_ORIGINS: ORIGIN,
  // Any non-empty strings: arming only checks that push is configured
  VAPID_SUBJECT: 'mailto:test@example.test',
  VAPID_PUBLIC_KEY: 'public',
  VAPID_PRIVATE_KEY: 'private',
})

const workerBase = new URL('.', API_URL).toString()

beforeEach(() => {
  kv = makeKV()
  upstreamCalls = []
  board = { refs: [ref(1, 'Weisshorn'), ref(2, 'Weisshorn'), ref(3)], states: {} }
  board.states[board.refs[0].id] = FREE
  board.states[board.refs[1].id] = BUSY
  board.states[board.refs[2].id] = 'down'

  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    // The browser's calls to the worker: hand them to the real fetch handler,
    // with the Origin header a browser on GitHub Pages would send.
    if (url.startsWith(workerBase)) {
      const headers = new Headers(init?.headers)
      headers.set('Origin', ORIGIN)
      return worker.fetch(new Request(url, { ...init, headers }), env())
    }
    upstreamCalls.push(url)
    if (url === STATIONS_JSON_URL) return jsonResponse(board.refs)
    if (url.startsWith('https://www.ecarup.com/api/stations')) {
      const id = new URL(url).searchParams.get('id')!
      const state = board.states[id]
      const r = board.refs.find((x) => x.id === id)!
      return state === 'down' ? jsonResponse({}, 503) : jsonResponse(apiStation(r, state))
    }
    throw new Error(`unexpected fetch ${url}`)
  })
})

describe('GET /stations', () => {
  it('warms an empty cache and returns a payload fetchAllStations can use', async () => {
    const before = Date.now()
    const all = await fetchAllStations()

    expect(all.updatedAt).toBeGreaterThanOrEqual(before)
    expect(all.stations.map((s) => s.ref)).toEqual(board.refs)
    expect(all.stations[0].data?.State).toBe(FREE)
    expect(all.stations[1].data?.State).toBe(BUSY)
    expect(all.stations[2]).toMatchObject({ data: null, error: 'HTTP 503' })
    // stations.json + one fetch per station
    expect(upstreamCalls).toHaveLength(1 + board.refs.length)
  })

  it('serves the cached board without touching upstream again', async () => {
    const first = await fetchAllStations()
    board.states[board.refs[0].id] = BUSY

    const second = await fetchAllStations()
    expect(second).toEqual(first)
    expect(upstreamCalls).toHaveLength(1 + board.refs.length)
  })

  it('the cron refresh replaces the board the next request sees', async () => {
    await fetchAllStations()
    board.states[board.refs[0].id] = BUSY
    await worker.scheduled({ scheduledTime: new Date('2026-09-01T12:00:00Z').getTime() }, env())

    const all = await fetchAllStations()
    expect(all.stations[0].data?.State).toBe(BUSY)
  })
})

describe('notification watches', () => {
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
    expirationTime: null,
    keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
  }

  it('subIdFor matches the worker, so a device can find its own watches', async () => {
    for (const endpoint of [subscription.endpoint, 'https://web.push.apple.com/QH_+/=x']) {
      expect(await subIdFor(endpoint)).toBe(await subId(endpoint))
    }
  })

  it('arm -> list -> disarm round-trips through the worker', async () => {
    const station = board.refs[1].id
    const mine = await subIdFor(subscription.endpoint)

    await armWatch(subscription, station)
    expect(kv.store.has(`watch:${station}:${mine}`)).toBe(true)
    await expect(fetchWatches(mine)).resolves.toEqual([station])

    await disarmWatch(subscription.endpoint, station)
    await expect(fetchWatches(mine)).resolves.toEqual([])
  })

  it('armWatch surfaces the worker validation error', async () => {
    await expect(armWatch({ ...subscription, endpoint: 'https://evil.test/push' }, board.refs[0].id))
      .rejects.toThrow('Invalid subscription')
    await expect(armWatch(subscription, 'not-a-uuid')).rejects.toThrow('Invalid stationId')
  })
})
