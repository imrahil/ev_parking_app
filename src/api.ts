import type {
  AllStationsResponse,
  PushSubscriptionPayload,
  StationApiResponse,
  StationRef,
} from './types'
import { STATE_CODE, STATUS, type Status } from './consts/consts'

const BASE = 'https://www.ecarup.com/api/stations'

// Aggregated status endpoint served by the Cloudflare Worker (set in .env,
// see worker/README.md). Empty -> poll ecarup.com directly from the browser.
export const API_URL: string = import.meta.env.VITE_API_URL ?? ''

export async function fetchAllStations(signal?: AbortSignal): Promise<AllStationsResponse> {
  const res = await fetch(API_URL, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchStation(id: string, signal?: AbortSignal): Promise<StationApiResponse> {
  const res = await fetch(`${BASE}?id=${encodeURIComponent(id)}`, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
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

export async function armWatch(
  subscription: PushSubscriptionPayload,
  stationId: string,
): Promise<void> {
  const res = await fetch(apiUrl('watch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription, stationId }),
  })
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`)
}

export async function disarmWatch(endpoint: string, stationId: string): Promise<void> {
  const res = await fetch(apiUrl('watch'), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, stationId }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function fetchWatches(sub: string): Promise<string[]> {
  const res = await fetch(apiUrl(`watches?sub=${encodeURIComponent(sub)}`))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return ((await res.json()) as { stations: string[] }).stations
}
