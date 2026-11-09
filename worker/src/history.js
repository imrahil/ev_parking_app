// Rolling 12 h charging-power history, one KV blob for all stations.

import { STATE_OCCUPIED } from './board.js'

export const HISTORY_KEY = 'history' // charging power over the last HISTORY_MS, all stations in one blob
// Matches HISTORY_WINDOW_MS in src/sparkline.ts — the chart
// draws exactly this window, so change both.
const HISTORY_MS = 12 * 60 * 60 * 1000

/**
 * Appends this refresh's ActivePower (kW) to the rolling history and drops
 * samples older than HISTORY_MS. Shape: { t: [ms…], p: { [stationId]: [kW|null…] },
 * s: { [stationId]: [1|0|null…] } } — s is "a car is plugged in" — with every
 * series aligned to t; null = the station's fetch failed (a gap,
 * not a zero).
 *
 * One blob, one write per refresh (~94/day) — per-sample keys would blow the
 * free plan's 1000 KV writes/day. Only the cron calls this, so the
 * read-modify-write has no concurrent writer.
 */
export function appendHistory(prev, payload) {
  const old = prev && Array.isArray(prev.t) && prev.p ? prev : { t: [], p: {} }
  const oldS = old.s ?? {} // history written before `s` existed has none
  const cutoff = payload.updatedAt - HISTORY_MS
  const first = old.t.findIndex((t) => t >= cutoff)
  const start = first === -1 ? old.t.length : first

  const kept = old.t.length - start
  // A station new to the list (or missing from older history) is padded with gaps
  const extend = (column, sample) => [...(column ? column.slice(start) : new Array(kept).fill(null)), sample]

  const p = {}
  const occupied = {}
  for (const s of payload.stations) {
    const power = s.data?.ActivePower
    p[s.ref.id] = extend(old.p[s.ref.id], Number.isFinite(power) ? Math.round(power * 10) / 10 : null)
    occupied[s.ref.id] = extend(oldS[s.ref.id], s.data ? Number(s.data.State === STATE_OCCUPIED) : null)
  }
  return { t: [...old.t.slice(start), payload.updatedAt], p, s: occupied }
}

export async function recordHistory(env, payload) {
  const prev = await env.CACHE.get(HISTORY_KEY, 'json')
  await env.CACHE.put(HISTORY_KEY, JSON.stringify(appendHistory(prev, payload)))
}
