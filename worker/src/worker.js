import { isPushEndpoint, isSubscription, sendPush, subId } from './push.js'

const ECARUP_BASE = 'https://www.ecarup.com/api/stations'
const KV_KEY = 'all'
const STATE_KEY = 'state' // last seen State per station, for transition detection
const PENDING_KEY = 'pending' // stations freed but not fully notified yet

const STATE_AVAILABLE = 1

// Night window (Europe/Zurich): only hourly refreshes between these hours, and
// no notifications at all. Overnight parking isn't allowed, so nobody needs
// fresh data — or a push at 03:00.
const NIGHT_START_HOUR = 20 // inclusive
const NIGHT_END_HOUR = 6 // exclusive
const TIME_ZONE = 'Europe/Zurich'

// Free plan: 50 *external* subrequests per invocation (KV is not external, it
// counts against a separate 1000/invocation budget). The refresh spends
// 1 (stations.json) + one per station, and what's left is our push budget.
const MAX_EXTERNAL_SUBREQUESTS = 50

const WATCH_TTL_S = 8 * 60 * 60 // a forgotten watch expires itself, no KV write
const SUB_TTL_S = 90 * 24 * 60 * 60
const MAX_WATCHES_PER_SUB = 5
const MAX_SUBS = 200

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Notifications need the VAPID pair. Without it the worker still refreshes the
 * board and serves /stations exactly as before — so it is safe to deploy this
 * worker before `wrangler secret put VAPID_PRIVATE_KEY` has ever been run.
 */
function pushConfigured(env) {
  return Boolean(env.VAPID_SUBJECT && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
}

/**
 * Fetches every station from ecarup and stores the aggregate in KV.
 * Returns the payload: { updatedAt, stations: [{ ref, data, error? }] }
 *
 * Note: the free plan allows 50 external subrequests per invocation — with
 * stations.json that caps the list at ~49 stations (fewer once notifications
 * need room). Batch the fetches if the list ever grows beyond that.
 */
async function refreshAll(env) {
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
        return { ref, data: null, error: e instanceof Error ? e.message : String(e) }
      }
    })
  )

  const payload = { updatedAt: Date.now(), stations }
  await env.CACHE.put(KV_KEY, JSON.stringify(payload))
  return payload
}

/**
 * Compares this refresh against the last one and pushes to whoever is watching
 * a station that just became available.
 *
 * `silent` keeps the baseline up to date without delivering (used at night) —
 * without it, the 06:00 run would compare against 20:00 and fire for every
 * charger that emptied overnight.
 */
async function notifyWatchers(env, payload, silent) {
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
  if (freed.size === 0) {
    if (pending.length) await env.CACHE.delete(PENDING_KEY)
    return
  }

  await deliver(env, payload, freed, pending.length > 0)
}

async function deliver(env, payload, freed, hadPending) {
  // Key names alone (watch:<stationId>:<subId>) tell us who wants what, so
  // matching costs no reads — we only read the subscriptions we'll notify.
  const { keys } = await env.CACHE.list({ prefix: 'watch:' })
  const targets = keys
    .map((k) => k.name.split(':'))
    .filter((parts) => parts.length === 3 && freed.has(parts[1]))
    .map(([, stationId, sub]) => ({ key: `watch:${stationId}:${sub}`, stationId, sub }))

  if (targets.length === 0) {
    if (hadPending) await env.CACHE.delete(PENDING_KEY)
    return
  }

  const names = new Map(payload.stations.map((s) => [s.ref.id, s.data?.Name ?? s.ref.name]))
  let budget = Math.max(0, MAX_EXTERNAL_SUBREQUESTS - 1 - payload.stations.length)
  const undelivered = new Set()

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

  if (undelivered.size > 0) {
    await env.CACHE.put(PENDING_KEY, JSON.stringify([...undelivered]))
  } else if (hadPending) {
    await env.CACHE.delete(PENDING_KEY)
  }
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function corsFor(request, env) {
  const origin = request.headers.get('Origin')
  const allowed = origin && allowedOrigins(env).includes(origin)
  return {
    // The board is public data, so reads stay open to any origin; writes are
    // gated separately in handleWatch (CORS is not a security boundary).
    'Access-Control-Allow-Origin': allowed ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...(allowed ? { Vary: 'Origin' } : {}),
  }
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/** POST /watch {subscription, stationId} · DELETE /watch {endpoint, stationId} */
async function handleWatch(request, env, cors) {
  const origin = request.headers.get('Origin')
  if (origin && !allowedOrigins(env).includes(origin)) {
    return json({ error: 'Origin not allowed' }, 403, cors)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400, cors)
  }

  const stationId = body?.stationId
  if (typeof stationId !== 'string' || !UUID_RE.test(stationId)) {
    return json({ error: 'Invalid stationId' }, 400, cors)
  }

  if (request.method === 'DELETE') {
    if (!isPushEndpoint(body?.endpoint)) return json({ error: 'Invalid endpoint' }, 400, cors)
    const id = await subId(body.endpoint)
    await env.CACHE.delete(`watch:${stationId}:${id}`)
    return json({ ok: true }, 200, cors)
  }

  if (!pushConfigured(env)) {
    return json({ error: 'Notifications are not configured on the server' }, 503, cors)
  }

  const subscription = body?.subscription
  if (!isSubscription(subscription)) return json({ error: 'Invalid subscription' }, 400, cors)

  const id = await subId(subscription.endpoint)
  const existing = await env.CACHE.get(`sub:${id}`)

  // Caps, because these writes are public and the free plan allows only
  // 1000 KV writes/day — shared with the board itself.
  if (!existing) {
    const { keys } = await env.CACHE.list({ prefix: 'sub:', limit: MAX_SUBS + 1 })
    if (keys.length >= MAX_SUBS) return json({ error: 'Too many subscriptions' }, 429, cors)
  }
  const { keys: watches } = await env.CACHE.list({ prefix: 'watch:' })
  const mine = watches.filter((k) => k.name.endsWith(`:${id}`))
  if (mine.length >= MAX_WATCHES_PER_SUB && !mine.some((k) => k.name === `watch:${stationId}:${id}`)) {
    return json({ error: 'Too many watches' }, 429, cors)
  }

  await env.CACHE.put(`sub:${id}`, JSON.stringify(subscription), { expirationTtl: SUB_TTL_S })
  await env.CACHE.put(`watch:${stationId}:${id}`, '', { expirationTtl: WATCH_TTL_S })
  return json({ ok: true, sub: id, expiresIn: WATCH_TTL_S }, 200, cors)
}

/** GET /watches?sub=<id> — lets a device recover its armed watches after a reinstall. */
async function handleWatches(url, env, cors) {
  const sub = url.searchParams.get('sub')
  if (!sub) return json({ error: 'Missing sub' }, 400, cors)
  const { keys } = await env.CACHE.list({ prefix: 'watch:' })
  const stations = keys
    .map((k) => k.name.split(':'))
    .filter((parts) => parts.length === 3 && parts[2] === sub)
    .map((parts) => parts[1])
  return json({ stations }, 200, cors)
}

export default {
  async scheduled(event, env) {
    // Cron schedules run in UTC; checking the local hour here keeps the
    // night boundary correct across daylight-saving changes.
    const when = new Date(event.scheduledTime)
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: TIME_ZONE,
      }).format(when)
    )
    const night = hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR
    if (night && when.getUTCMinutes() !== 0) return

    const payload = await refreshAll(env)
    await notifyWatchers(env, payload, night)
  },

  async fetch(request, env) {
    const url = new URL(request.url)
    const cors = corsFor(request, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors })
    }

    if (url.pathname === '/watch' && ['POST', 'DELETE'].includes(request.method)) {
      return handleWatch(request, env, cors)
    }

    if (url.pathname === '/watches' && request.method === 'GET') {
      return handleWatches(url, env, cors)
    }

    if (!['GET', 'HEAD'].includes(request.method) || !['/', '/stations'].includes(url.pathname)) {
      return new Response('Not found', { status: 404, headers: cors })
    }

    try {
      // Warm the cache on the first request after deploy (before the cron ran)
      let body = await env.CACHE.get(KV_KEY)
      if (!body) body = JSON.stringify(await refreshAll(env))

      return new Response(body, {
        headers: {
          ...cors,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
  },
}
