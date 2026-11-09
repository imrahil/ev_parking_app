// The public notification endpoints: arm, disarm and list watches.

import { spendBudget } from './budget.js'
import { allowedOrigins, json } from './http.js'
import { isPushEndpoint, isSubscription, pushConfigured, subId } from './push.js'

const WATCH_TTL_S = 8 * 60 * 60 // a forgotten watch expires itself, no KV write
const SUB_TTL_S = 90 * 24 * 60 * 60
// An unchanged subscription is rewritten (to push its TTL out) at most this
// often, so re-arming costs no KV write in the common case.
const SUB_REFRESH_MS = 7 * 24 * 60 * 60 * 1000
const MAX_WATCHES_PER_SUB = 5
const MAX_SUBS = 200

// Watch key names carry both ids (watch:<stationId>:<subId>), so finding who
// watches what costs one list() and no reads. Neither id can contain a colon:
// station ids are UUIDs, sub ids are base64url.
const WATCH_PREFIX = 'watch:'
const watchKey = (stationId, sub) => `${WATCH_PREFIX}${stationId}:${sub}`

/** Every armed watch, parsed from the key names: [{ key, stationId, sub, expiration }] */
export async function listWatches(env) {
  const { keys } = await env.CACHE.list({ prefix: WATCH_PREFIX })
  return keys.flatMap((k) => {
    const parts = k.name.split(':')
    return parts.length === 3
      ? [{ key: k.name, stationId: parts[1], sub: parts[2], expiration: k.expiration }]
      : []
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /watch {subscription, stationId} · DELETE /watch {endpoint, stationId}
 * Checks what both share — origin, JSON body, station id — then hands over.
 */
export async function handleWatch(request, env, cors) {
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

  return request.method === 'DELETE'
    ? disarmWatch(body, stationId, env, cors)
    : armWatch(body, stationId, env, cors)
}

async function disarmWatch(body, stationId, env, cors) {
  if (!isPushEndpoint(body?.endpoint)) return json({ error: 'Invalid endpoint' }, 400, cors)
  const id = await subId(body.endpoint)
  const key = watchKey(stationId, id)
  // A read first (100k/day): disarming what isn't armed costs no delete, so
  // every real delete pairs with a watch put that was already budgeted.
  if ((await env.CACHE.get(key)) === null) return json({ ok: true }, 200, cors)
  const refused = await spendBudget(env, 'delete', 1, cors)
  if (refused) return refused
  await env.CACHE.delete(key)
  return json({ ok: true }, 200, cors)
}

async function armWatch(body, stationId, env, cors) {
  if (!pushConfigured(env)) {
    return json({ error: 'Notifications are not configured on the server' }, 503, cors)
  }

  const subscription = body?.subscription
  if (!isSubscription(subscription)) return json({ error: 'Invalid subscription' }, 400, cors)

  const id = await subId(subscription.endpoint)
  const { value: existing, metadata } = await env.CACHE.getWithMetadata(`sub:${id}`)

  // A new subscription also lists `sub:` for the cap check below
  const listed = await spendBudget(env, 'list', existing ? 1 : 2, cors)
  if (listed) return listed

  // Caps, because these writes are public and the free plan allows only
  // 1000 KV writes/day — shared with the board itself.
  if (!existing) {
    const { keys } = await env.CACHE.list({ prefix: 'sub:', limit: MAX_SUBS + 1 })
    if (keys.length >= MAX_SUBS) return json({ error: 'Too many subscriptions' }, 429, cors)
  }
  const mine = (await listWatches(env)).filter((w) => w.sub === id)
  const key = watchKey(stationId, id)
  const armed = mine.find((w) => w.key === key)
  if (mine.length >= MAX_WATCHES_PER_SUB && !armed) {
    return json({ error: 'Too many watches' }, 429, cors)
  }

  // Skip writes that change nothing. The caps above bound how many keys exist,
  // not how many writes happen — without this, a client re-arming in a loop
  // burns the 1000 writes/day the cron needs to keep the board fresh.
  const now = Date.now()
  const value = JSON.stringify(subscription)
  const subFresh = existing === value && now - (metadata?.at ?? 0) < SUB_REFRESH_MS

  const puts = Number(!subFresh) + Number(!armed)
  if (puts > 0) {
    const refused = await spendBudget(env, 'put', puts, cors)
    if (refused) return refused
  }

  if (!subFresh) {
    await env.CACHE.put(`sub:${id}`, value, { expirationTtl: SUB_TTL_S, metadata: { at: now } })
  }

  // An armed watch keeps its original expiry; re-arming does not extend it
  if (armed) {
    const expiresIn = armed.expiration ? Math.max(0, armed.expiration - Math.floor(now / 1000)) : WATCH_TTL_S
    return json({ ok: true, sub: id, expiresIn }, 200, cors)
  }
  await env.CACHE.put(key, '', { expirationTtl: WATCH_TTL_S })
  return json({ ok: true, sub: id, expiresIn: WATCH_TTL_S }, 200, cors)
}

/** GET /watches?sub=<id> — lets a device recover its armed watches after a reinstall. */
export async function handleWatches(url, env, cors) {
  const sub = url.searchParams.get('sub')
  if (!sub) return json({ error: 'Missing sub' }, 400, cors)
  const refused = await spendBudget(env, 'list', 1, cors)
  if (refused) return refused
  const stations = (await listWatches(env)).filter((w) => w.sub === sub).map((w) => w.stationId)
  return json({ stations }, 200, cors)
}
