import type { Page } from '@playwright/test'
import { WORKER } from '../playwright.config'
import type { AllStationsResponse, PowerHistory, StationApiResponse, StationRef } from '../src/types'
import { apiStation, BUSY, FREE, ref, uuid } from '../src/test/fixtures'

// The unit tests' builders, so both suites describe a station the same way
export { BUSY, FREE, uuid }

export const station = (n: number, group: string | undefined, State: number, name = `Charger ${n}`) => {
  const r = ref(n, group, `Fallback ${n}`)
  return {
    ref: r,
    data: apiStation(r, State, {
      Name: name,
      Description: group ? `${group} level` : 'Ungrouped',
      Connectors: [],
    }),
  }
}

type Board = { ref: StationRef; data: StationApiResponse | null }[]

const MIN = 60_000
export const CHARGING_KW = 7.4

/**
 * Two hours of 10-minute samples ending now: occupied stations have been
 * plugged in and drawing CHARGING_KW throughout, the rest sat idle.
 */
export function historyFor(board: Board, now = Date.now()): PowerHistory {
  const t = Array.from({ length: 13 }, (_, i) => now - (12 - i) * 10 * MIN)
  const series = (value: (busy: boolean) => number) =>
    Object.fromEntries(board.map((s) => [s.ref.id, t.map(() => value(s.data?.State === BUSY))]))
  return { t, p: series((busy) => (busy ? CHARGING_KW : 0)), s: series(Number) }
}

/** The real stations.json groups. */
export const BOARD = [
  station(1, 'Besucherplatz', FREE, 'Besucherparkplatz 1'),
  station(2, 'Parkhaus 1.OG', FREE, 'Parkhaus 1.OG 01'),
  station(3, 'Parkhaus 1.OG', BUSY, 'Parkhaus 1.OG 02'),
  station(4, 'Parkhaus EG', BUSY, 'Parkhaus EG 01'),
  station(5, 'Weisshorn', BUSY, 'Weisshorn 1'),
  station(6, 'Aletschhorn', FREE, 'Aletschhorn 1'),
]

type Recorded = { method: string; path: string; body: unknown }

/**
 * Answers the fake worker origin the e2e build talks to. The board can be
 * swapped (or the worker "taken down") mid-test; every request is recorded.
 */
export async function fakeWorker(
  page: Page,
  initial: Board = BOARD,
  // history: omitted = one matching the board; null = /history fails
  opts: { updatedAt?: number; history?: PowerHistory | null } = {},
) {
  const state = {
    board: initial as Board | null,
    updatedAt: opts.updatedAt ?? Date.now(),
    history: opts.history === undefined ? historyFor(initial) : opts.history,
    watches: new Set<string>(),
    requests: [] as Recorded[],
  }

  await page.route(`${WORKER}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const body = req.postData() ? JSON.parse(req.postData()!) : null
    state.requests.push({ method: req.method(), path: url.pathname, body })
    const json = (status: number, payload: unknown) =>
      route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, json: payload })

    if (req.method() === 'OPTIONS') {
      return route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }
    if (url.pathname === '/stations') {
      if (!state.board) return json(502, { error: 'stations.json HTTP 500' })
      const payload: AllStationsResponse = { updatedAt: state.updatedAt, stations: state.board }
      return json(200, payload)
    }
    if (url.pathname === '/history') {
      return state.history ? json(200, state.history) : json(500, { error: 'history unavailable' })
    }
    if (url.pathname === '/watch' && req.method() === 'POST') {
      state.watches.add(body.stationId)
      return json(200, { ok: true })
    }
    if (url.pathname === '/watch' && req.method() === 'DELETE') {
      state.watches.delete(body.stationId)
      return json(200, { ok: true })
    }
    if (url.pathname === '/watches') return json(200, { stations: [...state.watches] })
    return json(404, { error: 'Not found' })
  })

  return {
    ...state,
    get requests() {
      return state.requests
    },
    setBoard(board: typeof state.board, updatedAt = Date.now()) {
      state.board = board
      state.updatedAt = updatedAt
    },
    stationRequests: () => state.requests.filter((r) => r.path === '/stations'),
  }
}

/**
 * Stands in for the browser push stack (permission prompt, service worker,
 * PushManager): headless Chromium has no push service to subscribe to.
 */
export async function fakePush(page: Page, prompt: NotificationPermission = 'granted') {
  await page.addInitScript((answer) => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/e2e-device'
    let sub: unknown = null
    const subscription = {
      endpoint,
      toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'p256dh', auth: 'auth' } }),
    }
    const reg = {
      pushManager: {
        getSubscription: async () => sub,
        subscribe: async () => (sub = subscription),
      },
    }
    let permission: NotificationPermission = 'default'
    Object.defineProperty(Notification, 'permission', { get: () => permission })
    Notification.requestPermission = async () => (permission = answer)
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: async () => reg, ready: Promise.resolve(reg), getRegistration: async () => reg },
    })
  }, prompt)
}

export const card = (page: Page, name: string) =>
  page.locator('main .grid > div').filter({ has: page.getByRole('heading', { name, exact: true }) })

export const cardNames = (page: Page) => page.locator('main h3').allTextContents()

export const chip = (page: Page, group: string) => page.locator('header').getByRole('button', { name: new RegExp(`^${group}`) })
