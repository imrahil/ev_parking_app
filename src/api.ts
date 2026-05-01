import type { StationApiResponse, StationRef } from './types'
import { STATE_CODE, STATUS, type Status } from './consts'

const BASE = 'https://www.ecarup.com/api/stations'

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
