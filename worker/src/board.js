// The board: one fetch per station from ecarup, aggregated into a single KV blob.

import { errorMessage } from './http.js'

const ECARUP_BASE = 'https://www.ecarup.com/api/stations'
export const BOARD_KEY = 'all' // the aggregate GET /stations serves

// ecarup's State codes; everything else is unknown
export const STATE_AVAILABLE = 1
export const STATE_OCCUPIED = 2

// Free plan: 50 *external* subrequests per invocation (KV is not external, it
// counts against a separate 1000/invocation budget). The refresh spends
// 1 (stations.json) + one per station, and what's left is our push budget.
export const MAX_EXTERNAL_SUBREQUESTS = 50

/**
 * Fetches every station from ecarup and stores the aggregate in KV.
 * Returns the payload: { updatedAt, stations: [{ ref, data, error? }] }
 *
 * Note: the free plan allows 50 external subrequests per invocation — with
 * stations.json that caps the list at ~49 stations (fewer once notifications
 * need room). Batch the fetches if the list ever grows beyond that.
 */
export async function refreshAll(env) {
  const res = await fetch(env.STATIONS_JSON_URL)
  if (!res.ok) throw new Error(`stations.json HTTP ${res.status}`)
  const refs = await res.json()

  const stations = await Promise.all(
    refs.map(async (ref) => {
      try {
        const r = await fetch(`${ECARUP_BASE}?id=${encodeURIComponent(ref.id)}`)
        if (!r.ok) return { ref, data: null, error: `HTTP ${r.status}` }
        return { ref, data: await r.json() }
      } catch (e) {
        return { ref, data: null, error: errorMessage(e) }
      }
    })
  )

  const payload = { updatedAt: Date.now(), stations }
  await env.CACHE.put(BOARD_KEY, JSON.stringify(payload))
  return payload
}
