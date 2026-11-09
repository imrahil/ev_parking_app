// Turns state transitions between two refreshes into one-shot pushes.

import { MAX_EXTERNAL_SUBREQUESTS, STATE_AVAILABLE } from './board.js'
import { pushConfigured, sendPush } from './push.js'
import { listWatches } from './watches.js'

const STATE_KEY = 'state' // last seen State per station, for transition detection
const PENDING_KEY = 'pending' // stations freed but not fully notified yet

// Free plan: 10ms of CPU per invocation. Each push costs ~2ms of RFC 8291
// encryption (fresh ECDH key pair + HKDF + AES-GCM) on top of ~1-2ms for the
// refresh itself, so more than a few pushes in one run gets the invocation
// killed — and a kill mid-deliver() loses the rest silently, because `state`
// is already written and they are no longer transitions. Overflow goes to
// `pending` and is delivered on the next run (+10 min).
const MAX_PUSHES_PER_RUN = 3

/**
 * Compares this refresh against the last one and pushes to whoever is watching
 * a station that just became available.
 *
 * `silent` keeps the baseline up to date without delivering (used at night) —
 * without it, the 06:00 run would compare against 20:00 and fire for every
 * charger that emptied overnight.
 */
export async function notifyWatchers(env, payload, silent) {
  const next = {}
  for (const s of payload.stations) if (s.data) next[s.ref.id] = s.data.State

  const prev = await env.CACHE.get(STATE_KEY, 'json')
  const write = async () => {
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      await env.CACHE.put(STATE_KEY, JSON.stringify(next))
    }
  }

  // No baseline yet (first run after deploy): record one, notify nothing.
  // Otherwise every occupied charger would look like it had just freed up.
  if (!prev || silent || !pushConfigured(env)) {
    await write()
    return
  }

  const freed = new Set(
    Object.keys(next).filter((id) => next[id] === STATE_AVAILABLE && prev[id] !== STATE_AVAILABLE)
  )

  // Anything we ran out of push budget for last time, still free
  const pending = (await env.CACHE.get(PENDING_KEY, 'json')) ?? []
  for (const id of pending) if (next[id] === STATE_AVAILABLE) freed.add(id)

  await write()
  const undelivered = freed.size > 0 ? await deliver(env, payload, freed) : new Set()

  // `pending` is settled here and nowhere else: whatever could not go out is
  // carried to the next run, and a list that has been worked off is removed.
  if (undelivered.size > 0) {
    await env.CACHE.put(PENDING_KEY, JSON.stringify([...undelivered]))
  } else if (pending.length > 0) {
    await env.CACHE.delete(PENDING_KEY)
  }
}

/**
 * Pushes to everyone watching a station in `freed`. Returns the station ids
 * that still have someone to notify — out of push budget, or a transient
 * failure — for the caller to retry on the next run.
 */
async function deliver(env, payload, freed) {
  // Matching costs no reads — we only read the subscriptions we'll notify
  const targets = (await listWatches(env)).filter((w) => freed.has(w.stationId))

  const undelivered = new Set()
  if (targets.length === 0) return undelivered

  const names = new Map(payload.stations.map((s) => [s.ref.id, s.data?.Name ?? s.ref.name]))
  let budget = Math.max(
    0,
    Math.min(MAX_PUSHES_PER_RUN, MAX_EXTERNAL_SUBREQUESTS - 1 - payload.stations.length)
  )

  for (const { key, stationId, sub } of targets) {
    const subscription = await env.CACHE.get(`sub:${sub}`, 'json')
    if (!subscription) {
      await env.CACHE.delete(key) // subscription expired out from under the watch
      continue
    }

    if (budget === 0) {
      undelivered.add(stationId)
      continue
    }
    budget--

    const status = await sendPush(
      subscription,
      {
        title: `${names.get(stationId) ?? 'Charger'} is free`,
        body: 'Tap to open the board.',
        tag: stationId,
      },
      env
    )

    if (status >= 200 && status < 300) {
      await env.CACHE.delete(key) // one-shot: fired, so disarm
    } else if (status === 404 || status === 410) {
      await env.CACHE.delete(key)
      await env.CACHE.delete(`sub:${sub}`) // push service says it's gone for good
    } else {
      undelivered.add(stationId) // transient — retry next refresh
    }
  }

  return undelivered
}
