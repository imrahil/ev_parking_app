import type { Page } from '@playwright/test'
import { WORKER } from '../playwright.config'
import type { AllStationsResponse, StationApiResponse, StationRef } from '../src/types'

export const FREE = 1
export const BUSY = 2

export const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-2222-3333-444444444444`

export const station = (n: number, group: string | undefined, State: number, name = `Charger ${n}`) => ({
  ref: { id: uuid(n), name: `Fallback ${n}`, ...(group ? { group } : {}) } as StationRef,
  data: {
    ID: uuid(n),
    Name: name,
    Description: group ? `${group} level` : 'Ungrouped',
    State,
    ActivePower: 0,
    IsDisabled: false,
    Connectors: [],
  } as StationApiResponse,
})

/**
 * The real stations.json groups. Besucherplatz and Parkhaus EG are hidden by
 * default, so a fresh visit shows Parkhaus 1.OG, Weisshorn and Aletschhorn.
 */
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
export async function fakeWorker(page: Page, initial = BOARD, opts: { updatedAt?: number } = {}) {
  const state = {
    board: initial as { ref: StationRef; data: StationApiResponse | null }[] | null,
    updatedAt: opts.updatedAt ?? Date.now(),
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
