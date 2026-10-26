import type { AllStationsResponse, Connector, StationApiResponse, StationRef, StationView } from '../types'
import { STATE_CODE } from '../consts/consts'

export const FREE = STATE_CODE.AVAILABLE
export const BUSY = STATE_CODE.OCCUPIED
export const OFFLINE = 0

// The worker only accepts UUID station ids, so fixtures use them everywhere
export const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-2222-3333-444444444444`

export const ref = (n: number, group?: string, name = `Station ${n}`): StationRef => ({
  id: uuid(n),
  name,
  ...(group ? { group } : {}),
})

export const connector = (Id: number, State: number, Name = String(Id)): Connector => ({
  Id,
  Name,
  State,
  ActivePower: State === BUSY ? 7.4 : 0,
  MaxPower: 11,
})

export function apiStation(r: StationRef, State: number, patch: Partial<StationApiResponse> = {}): StationApiResponse {
  return {
    ID: r.id,
    Name: `Live ${r.name}`,
    Description: `${r.group ?? 'Ungrouped'} charger`,
    State,
    ActivePower: 0,
    IsDisabled: false,
    Connectors: [connector(1, State)],
    ...patch,
  }
}

export const view = (r: StationRef, data: StationApiResponse | null, patch: Partial<StationView> = {}): StationView => ({
  ref: r,
  loading: false,
  error: null,
  data,
  fetchedAt: Date.now(),
  ...patch,
})

/** A worker /stations payload: [ref, State] pairs, State null = upstream error. */
export function allStations(entries: [StationRef, number | null][], updatedAt = Date.now()): AllStationsResponse {
  return {
    updatedAt,
    stations: entries.map(([r, state]) =>
      state === null ? { ref: r, data: null, error: 'HTTP 503' } : { ref: r, data: apiStation(r, state) },
    ),
  }
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export const requestUrl = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
