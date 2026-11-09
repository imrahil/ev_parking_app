import type {
  AllStationsResponse,
  PowerHistory,
  PushSubscriptionPayload,
  StationApiResponse,
  StationRef,
} from './types'
import { STATE_CODE, STATUS, type Status } from './consts/consts'

const BASE = 'https://www.ecarup.com/api/stations'

// Aggregated status endpoint served by the Cloudflare Worker (set in .env,
// see worker/README.md). Empty -> poll ecarup.com directly from the browser.
export const API_URL: string = import.meta.env.VITE_API_URL ?? ''

/** GET a JSON body; any non-2xx rejects with `HTTP <status>`. */
async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function fetchAllStations(signal?: AbortSignal): Promise<AllStationsResponse> {
  return getJson(API_URL, signal)
}

export async function fetchHistory(signal?: AbortSignal): Promise<PowerHistory> {
  const body = await getJson<unknown>(apiUrl('history'), signal)
  if (!isPowerHistory(body)) throw new Error('Malformed history')
  return body
}

function isPowerHistory(v: unknown): v is PowerHistory {
  if (typeof v !== 'object' || v === null) return false
  const { t, p } = v as Partial<PowerHistory>
  return Array.isArray(t) && typeof p === 'object' && p !== null && !Array.isArray(p)
}

export function fetchStation(id: string, signal?: AbortSignal): Promise<StationApiResponse> {
  return getJson(`${BASE}?id=${encodeURIComponent(id)}`, signal)
}

export async function loadStations(): Promise<StationRef[]> {
  const url = `${import.meta.env.BASE_URL}stations.json`
  const res = await fetch(url, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`Failed to load stations.json: ${res.status}`)
  return res.json()
}

export function stateToStatus(state: number | undefined): Status {
  if (state === STATE_CODE.AVAILABLE) return STATUS.AVAILABLE
  if (state === STATE_CODE.OCCUPIED) return STATUS.OCCUPIED
  return STATUS.UNKNOWN
}

// --- Notification watches (API mode only; the worker sends the pushes) ---

const apiUrl = (path: string) => new URL(path, API_URL).toString()

/**
 * Stable id for a push subscription — SHA-256 of the endpoint, base64url.
 * Mirrors `subId()` in worker/src/push.js; both sides must agree or a device
 * can't look its own watches back up.
 */
export async function subIdFor(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * POST or DELETE /watch. A refusal rejects with the worker's own `error` text,
 * which is written for the user (which cap or daily budget was hit, and what
 * happens next); `HTTP <status>` only when the body carries none.
 */
async function sendWatch(method: 'POST' | 'DELETE', body: object): Promise<void> {
  const res = await fetch(apiUrl('watch'), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return
  const { error } = (await res.json().catch(() => ({}))) as { error?: unknown }
  throw new Error(typeof error === 'string' ? error : `HTTP ${res.status}`)
}

export function armWatch(subscription: PushSubscriptionPayload, stationId: string): Promise<void> {
  return sendWatch('POST', { subscription, stationId })
}

export function disarmWatch(endpoint: string, stationId: string): Promise<void> {
  return sendWatch('DELETE', { endpoint, stationId })
}

export async function fetchWatches(sub: string): Promise<string[]> {
  const { stations } = await getJson<{ stations: string[] }>(apiUrl(`watches?sub=${encodeURIComponent(sub)}`))
  return stations
}
