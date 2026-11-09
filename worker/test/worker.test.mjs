// Exercises worker.js against a mock KV and a mock push service. The push
// crypto is NOT mocked — the real RFC 8291 encryption runs for every send.
//
//   cd worker && npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker, { appendHistory, WriteBudget } from '../src/worker.js'

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// --- fixtures -------------------------------------------------------------

async function makeVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey)
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  return { publicKey: b64url(pub), privateKey: jwk.d }
}

async function makeSubscription(host = 'fcm.googleapis.com', id = 'a') {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey)
  return {
    endpoint: `https://${host}/fcm/send/${id}`,
    expirationTime: null,
    keys: { p256dh: b64url(pub), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) },
  }
}

function makeKV(initial = {}) {
  const store = new Map(Object.entries(initial))
  const meta = new Map() // key -> { metadata, expiration }
  const kv = {
    store,
    meta,
    // The free plan's separate daily budgets: 1,000 each of puts, deletes, lists
    writes: 0,
    deletes: 0,
    lists: 0,
    async get(key, type) {
      const v = store.get(key)
      if (v === undefined) return null
      return type === 'json' ? JSON.parse(v) : v
    },
    async getWithMetadata(key) {
      const v = store.get(key)
      return { value: v ?? null, metadata: v === undefined ? null : (meta.get(key)?.metadata ?? null) }
    },
    async put(key, value, opts = {}) {
      kv.writes++
      store.set(key, value)
      meta.set(key, {
        metadata: opts.metadata ?? null,
        expiration: opts.expirationTtl ? Math.floor(Date.now() / 1000) + opts.expirationTtl : undefined,
      })
    },
    async delete(key) {
      kv.deletes++
      store.delete(key)
      meta.delete(key)
    },
    async list({ prefix = '', limit = 1000 } = {}) {
      kv.lists++
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .slice(0, limit)
        .map((name) => {
          const expiration = meta.get(name)?.expiration
          return expiration ? { name, expiration } : { name }
        })
      return { keys, list_complete: true }
    },
  }
  return kv
}

// The real WriteBudget class over an in-memory storage, behind a stub
// namespace shaped like a Durable Object binding.
function makeBudget() {
  const storage = new Map()
  const budget = new WriteBudget({
    storage: {
      async get(key) {
        return storage.get(key)
      },
      async put(key, value) {
        storage.set(key, value)
      },
    },
  })
  return {
    storage,
    idFromName: (name) => name,
    get: () => ({ fetch: (url) => budget.fetch(new Request(url)) }),
  }
}

const STATIONS_JSON_URL = 'https://example.test/stations.json'

function installFetch(states, pushStatus = 201) {
  const pushes = []
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url

    if (url === STATIONS_JSON_URL) {
      const refs = Object.keys(states).map((id) => ({ id, name: `Station ${id.slice(0, 4)}` }))
      return new Response(JSON.stringify(refs), { status: 200 })
    }
    if (url.startsWith('https://www.ecarup.com/api/stations')) {
      const id = new URL(url).searchParams.get('id')
      return new Response(
        JSON.stringify({
          ID: id,
          Name: `Charger ${id.slice(0, 4)}`,
          State: states[id],
          Connectors: [],
        }),
        { status: 200 },
      )
    }
    pushes.push({ url, headers: init.headers, body: init.body })
    return new Response('', { status: pushStatus })
  }
  return pushes
}

const uuid = (n) => `${String(n).padStart(8, '0')}-1111-2222-3333-444444444444`

async function envWith(kv, vapid, budget = makeBudget()) {
  return {
    CACHE: kv,
    WATCH_BUDGET: budget,
    STATIONS_JSON_URL,
    ALLOWED_ORIGINS: 'https://imrahil.github.io,http://localhost:5173',
    VAPID_SUBJECT: 'mailto:test@example.test',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
  }
}

// September => Europe/Zurich is UTC+2: 12:00Z = 14:00 (day), 20:00Z = 22:00 (night)
const DAY = new Date('2026-09-01T12:00:00Z').getTime()
const NIGHT = new Date('2026-09-01T20:00:00Z').getTime()

const vapid = await makeVapid()

// --- scheduled: transition detection --------------------------------------

test('first run records a baseline and notifies nobody', async () => {
  const sub = await makeSubscription()
  const kv = makeKV({
    'sub:SUBA': JSON.stringify(sub),
    [`watch:${uuid(1)}:SUBA`]: '',
  })
  const pushes = installFetch({ [uuid(1)]: 1 })
  await worker.scheduled({ scheduledTime: DAY }, await envWith(kv, vapid))

  assert.equal(pushes.length, 0, 'must not push on the very first run')
  assert.deepEqual(await kv.get('state', 'json'), { [uuid(1)]: 1 })
  assert.ok(kv.store.has(`watch:${uuid(1)}:SUBA`), 'watch stays armed')
})

test('occupied -> free pushes once and disarms the watch', async () => {
  const sub = await makeSubscription()
  const kv = makeKV({
    state: JSON.stringify({ [uuid(1)]: 2, [uuid(2)]: 2 }),
    'sub:SUBA': JSON.stringify(sub),
    [`watch:${uuid(1)}:SUBA`]: '',
  })
  const pushes = installFetch({ [uuid(1)]: 1, [uuid(2)]: 2 })
  await worker.scheduled({ scheduledTime: DAY }, await envWith(kv, vapid))

  assert.equal(pushes.length, 1, 'exactly one push')
  assert.equal(pushes[0].url, sub.endpoint)
  assert.match(pushes[0].headers.Authorization, /^vapid t=ey.+,k=/, 'RFC 8292 VAPID header')
  assert.equal(pushes[0].headers['Content-Encoding'], 'aes128gcm', 'RFC 8291 encoding')
  assert.ok(pushes[0].body.byteLength > 0, 'encrypted payload present')
  assert.equal(kv.store.has(`watch:${uuid(1)}:SUBA`), false, 'one-shot: watch cleared')
  assert.ok(kv.store.has('sub:SUBA'), 'subscription kept for next time')
  assert.deepEqual(await kv.get('state', 'json'), { [uuid(1)]: 1, [uuid(2)]: 2 })
})

test('unknown -> free also fires (a failed poll must not swallow it)', async () => {
  const sub = await makeSubscription()
  const kv = makeKV({
    state: JSON.stringify({ [uuid(1)]: 0 }),
    'sub:S': JSON.stringify(sub),
    [`watch:${uuid(1)}:S`]: '',
  })
  const pushes = installFetch({ [uuid(1)]: 1 })
  await worker.scheduled({ scheduledTime: DAY }, await envWith(kv, vapid))
  assert.equal(pushes.length, 1)
})

test('still-occupied station notifies nobody', async () => {
  const sub = await makeSubscription()
  const kv = makeKV({
    state: JSON.stringify({ [uuid(1)]: 2 }),
    'sub:S': JSON.stringify(sub),
    [`watch:${uuid(1)}:S`]: '',
  })
  const pushes = installFetch({ [uuid(1)]: 2 })
  await worker.scheduled({ scheduledTime: DAY }, await envWith(kv, vapid))
  assert.equal(pushes.length, 0)
  assert.ok(kv.store.has(`watch:${uuid(1)}:S`), 'watch stays armed')
})

test('a free charger nobody watches costs no pushes', async () => {
  const kv = makeKV({ state: JSON.stringify({ [uuid(1)]: 2 }) })
  const pushes = installFetch({ [uuid(1)]: 1 })
  await worker.scheduled({ scheduledTime: DAY }, await envWith(kv, vapid))
  assert.equal(pushes.length, 0)
})

test('night runs update the baseline but stay silent', async () => {
  const sub = await makeSubscription()
  const kv = makeKV({
    state: JSON.stringify({ [uuid(1)]: 2 }),
    'sub:S': JSON.stringify(sub),
    [`watch:${uuid(1)}:S`]: '',
  })
  const pushes = installFetch({ [uuid(1)]: 1 })
  await worker.scheduled({ scheduledTime: NIGHT }, await envWith(kv, vapid))

  assert.equal(pushes.length, 0, 'no 22:00 notifications')
  assert.deepEqual(await kv.get('state', 'json'), { [uuid(1)]: 1 }, 'baseline still advances')
  assert.ok(kv.store.has(`watch:${uuid(1)}:S`), 'watch survives to fire during the day')
})

test('a dead subscription (410) is dropped', async () => {
  const sub = await makeSubscription()
  const kv = makeKV({
    state: JSON.stringify({ [uuid(1)]: 2 }),
    'sub:S': JSON.stringify(sub),
    [`watch:${uuid(1)}:S`]: '',
  })
  installFetch({ [uuid(1)]: 1 }, 410)
  await worker.scheduled({ scheduledTime: DAY }, await envWith(kv, vapid))

  assert.equal(kv.store.has('sub:S'), false, 'subscription purged')
  assert.equal(kv.store.has(`watch:${uuid(1)}:S`), false, 'watch purged')
})

test('a transient push failure keeps the watch armed and retries next run', async () => {
  const sub = await makeSubscription()
  const kv = makeKV({
    state: JSON.stringify({ [uuid(1)]: 2 }),
    'sub:S': JSON.stringify(sub),
    [`watch:${uuid(1)}:S`]: '',
  })
  installFetch({ [uuid(1)]: 1 }, 500)
  const env = await envWith(kv, vapid)
  await worker.scheduled({ scheduledTime: DAY }, env)

  assert.ok(kv.store.has(`watch:${uuid(1)}:S`), 'still armed after a 500')
  assert.deepEqual(await kv.get('pending', 'json'), [uuid(1)])

  // Next run: station still free, so there is no fresh transition — the retry
  // has to come from `pending`, not from the state diff.
  const pushes = installFetch({ [uuid(1)]: 1 }, 201)
  await worker.scheduled({ scheduledTime: DAY }, env)
  assert.equal(pushes.length, 1, 'retried on the next refresh')
  assert.equal(kv.store.has('pending'), false, 'pending cleared once delivered')
})

test('push budget is capped by remaining subrequests, overflow carried', async () => {
  // 47 stations => 50 - 1 - 47 = 2 pushes of headroom (below the CPU cap)
  const states = {}
  for (let i = 1; i <= 47; i++) states[uuid(i)] = 2
  const freed = uuid(1)
  states[freed] = 1

  const seed = {
    state: JSON.stringify(Object.fromEntries(Object.keys(states).map((id) => [id, 2]))),
  }
  for (let i = 0; i < 6; i++) {
    seed[`sub:S${i}`] = JSON.stringify(await makeSubscription('fcm.googleapis.com', `s${i}`))
    seed[`watch:${freed}:S${i}`] = ''
  }
  const kv = makeKV(seed)
  const pushes = installFetch(states)
  await worker.scheduled({ scheduledTime: DAY }, await envWith(kv, vapid))

  assert.equal(pushes.length, 2, `sent ${pushes.length}, expected the 2 that fit`)
  assert.deepEqual(await kv.get('pending', 'json'), [freed], 'overflow carried to next run')
  const left = [...kv.store.keys()].filter((k) => k.startsWith('watch:'))
  assert.equal(left.length, 4, 'undelivered watches stay armed')
})

test('pushes per run are capped for CPU, the rest go out next run', async () => {
  // Few stations, so subrequests are plentiful — only the CPU cap applies
  const freed = uuid(1)
  const seed = { state: JSON.stringify({ [freed]: 2, [uuid(2)]: 2 }) }
  for (let i = 0; i < 5; i++) {
    seed[`sub:S${i}`] = JSON.stringify(await makeSubscription('fcm.googleapis.com', `s${i}`))
    seed[`watch:${freed}:S${i}`] = ''
  }
  const kv = makeKV(seed)
  const env = await envWith(kv, vapid)

  let pushes = installFetch({ [freed]: 1, [uuid(2)]: 2 })
  await worker.scheduled({ scheduledTime: DAY }, env)
  assert.equal(pushes.length, 3, `sent ${pushes.length}, expected the per-run cap of 3`)
  assert.deepEqual(await kv.get('pending', 'json'), [freed])

  pushes = installFetch({ [freed]: 1, [uuid(2)]: 2 })
  await worker.scheduled({ scheduledTime: DAY }, env)
  assert.equal(pushes.length, 2, 'the remaining 2 go out on the next run')
  assert.equal(kv.store.has('pending'), false, 'pending cleared once all delivered')
  assert.equal([...kv.store.keys()].filter((k) => k.startsWith('watch:')).length, 0)
})

// --- HTTP endpoints -------------------------------------------------------

const post = (body, origin = 'https://imrahil.github.io') =>
  new Request('https://w.test/watch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  })

test('POST /watch stores the subscription and the watch', async () => {
  const kv = makeKV()
  installFetch({})
  const sub = await makeSubscription()
  const res = await worker.fetch(
    post({ subscription: sub, stationId: uuid(1) }),
    await envWith(kv, vapid),
  )
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.ok(body.sub, 'returns the subscription id')
  assert.ok(kv.store.has(`sub:${body.sub}`))
  assert.ok(kv.store.has(`watch:${uuid(1)}:${body.sub}`))
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://imrahil.github.io')
})

test('POST /watch rejects a non-push endpoint (no open relay)', async () => {
  const kv = makeKV()
  installFetch({})
  const sub = await makeSubscription()
  sub.endpoint = 'https://attacker.test/collect'
  const res = await worker.fetch(
    post({ subscription: sub, stationId: uuid(1) }),
    await envWith(kv, vapid),
  )
  assert.equal(res.status, 400)
  assert.equal(kv.store.size, 0)
})

test('POST /watch rejects a junk stationId', async () => {
  const kv = makeKV()
  installFetch({})
  const sub = await makeSubscription()
  const res = await worker.fetch(
    post({ subscription: sub, stationId: '../../etc' }),
    await envWith(kv, vapid),
  )
  assert.equal(res.status, 400)
  assert.equal(kv.store.size, 0)
})

test('POST /watch rejects an unknown origin', async () => {
  const kv = makeKV()
  installFetch({})
  const sub = await makeSubscription()
  const res = await worker.fetch(
    post({ subscription: sub, stationId: uuid(1) }, 'https://evil.test'),
    await envWith(kv, vapid),
  )
  assert.equal(res.status, 403)
  assert.equal(kv.store.size, 0)
})

test('watches per subscription are capped', async () => {
  const kv = makeKV()
  installFetch({})
  const sub = await makeSubscription()
  const env = await envWith(kv, vapid)
  for (let i = 1; i <= 5; i++) {
    const r = await worker.fetch(post({ subscription: sub, stationId: uuid(i) }), env)
    assert.equal(r.status, 200, `arm ${i}`)
  }
  const sixth = await worker.fetch(post({ subscription: sub, stationId: uuid(6) }), env)
  assert.equal(sixth.status, 429)
})

test('re-arming an already watched station is idempotent, not a cap hit', async () => {
  const kv = makeKV()
  installFetch({})
  const sub = await makeSubscription()
  const env = await envWith(kv, vapid)
  for (let i = 1; i <= 5; i++) {
    await worker.fetch(post({ subscription: sub, stationId: uuid(i) }), env)
  }
  const again = await worker.fetch(post({ subscription: sub, stationId: uuid(3) }), env)
  assert.equal(again.status, 200)
})

test('re-arming the same watch costs no KV writes', async () => {
  const kv = makeKV()
  installFetch({})
  const sub = await makeSubscription()
  const env = await envWith(kv, vapid)
  const first = await (await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)).json()
  assert.equal(kv.writes, 2, 'first arm writes sub + watch')

  for (let i = 0; i < 50; i++) {
    const r = await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)
    assert.equal(r.status, 200)
  }
  assert.equal(kv.writes, 2, 'a retry loop burns nothing')

  const again = await (await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)).json()
  assert.equal(again.sub, first.sub)
  assert.ok(again.expiresIn > 0 && again.expiresIn <= first.expiresIn, 'reports the original expiry')

  await worker.fetch(post({ subscription: sub, stationId: uuid(2) }), env)
  assert.equal(kv.writes, 3, 'a new station writes only its watch')
})

test('a changed or week-old subscription is rewritten', async () => {
  const kv = makeKV()
  installFetch({})
  const sub = await makeSubscription()
  const env = await envWith(kv, vapid)
  const { sub: id } = await (await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)).json()

  // Rotated keys on the same endpoint must replace the stored copy
  const rotated = { ...sub, keys: { ...sub.keys, auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } }
  await worker.fetch(post({ subscription: rotated, stationId: uuid(1) }), env)
  assert.deepEqual(await kv.get(`sub:${id}`, 'json'), rotated)
  assert.equal(kv.writes, 3)

  // Unchanged but last written 8 days ago: rewritten so the 90-day TTL keeps moving
  kv.meta.get(`sub:${id}`).metadata = { at: Date.now() - 8 * 24 * 60 * 60 * 1000 }
  await worker.fetch(post({ subscription: rotated, stationId: uuid(1) }), env)
  assert.equal(kv.writes, 4)
  assert.ok(Date.now() - kv.meta.get(`sub:${id}`).metadata.at < 1000)

  // Subscriptions stored before metadata existed get refreshed once, then settle
  kv.meta.get(`sub:${id}`).metadata = null
  await worker.fetch(post({ subscription: rotated, stationId: uuid(1) }), env)
  await worker.fetch(post({ subscription: rotated, stationId: uuid(1) }), env)
  assert.equal(kv.writes, 5)
})

test('/watch stops writing once the daily budget is spent; the board is untouched', async () => {
  const kv = makeKV()
  const budget = makeBudget()
  const today = new Date().toISOString().slice(0, 10)
  budget.storage.set('used', { day: today, n: 399 })
  installFetch({})
  const env = await envWith(kv, vapid, budget)

  // A new subscription needs 2 puts (sub + watch); only 1 is left
  const sub = await makeSubscription('fcm.googleapis.com', 'late')
  const refused = await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)
  assert.equal(refused.status, 429)
  assert.match((await refused.json()).error, /tomorrow/)
  assert.equal(kv.writes, 0, 'nothing written when refused')
  assert.equal(budget.storage.get('used').n, 399, 'a refusal spends nothing')

  // The cron still refreshes: the budget only gates /watch
  installFetch({ [uuid(1)]: 1 })
  await worker.scheduled({ scheduledTime: DAY }, env)
  assert.ok(kv.store.has('all'))
})

test('the budget counts puts, resets daily, and re-arming spends none', async () => {
  const kv = makeKV()
  const budget = makeBudget()
  installFetch({})
  const env = await envWith(kv, vapid, budget)
  const sub = await makeSubscription()

  await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)
  assert.equal(budget.storage.get('used').n, 2, 'sub + watch')
  await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)
  assert.equal(budget.storage.get('used').n, 2, 'no-op re-arm is free')
  await worker.fetch(post({ subscription: sub, stationId: uuid(2) }), env)
  assert.equal(budget.storage.get('used').n, 3, 'watch only')

  // Yesterday's exhausted count does not carry over
  budget.storage.set('used', { day: '2000-01-01', n: 400 })
  const r = await worker.fetch(post({ subscription: sub, stationId: uuid(3) }), env)
  assert.equal(r.status, 200)
  assert.deepEqual(budget.storage.get('used'), { day: new Date().toISOString().slice(0, 10), n: 1 })
})

test('/watch fails closed when the budget is unreachable', async () => {
  const kv = makeKV()
  installFetch({})
  const broken = {
    idFromName: () => 'x',
    get: () => ({
      fetch: async () => {
        throw new Error('DO down')
      },
    }),
  }
  const sub = await makeSubscription()
  const res = await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), await envWith(kv, vapid, broken))
  assert.equal(res.status, 503)
  assert.equal(kv.writes, 0)
})

test('DELETE /watch disarms, GET /watches lists what is armed', async () => {
  const kv = makeKV()
  installFetch({})
  const sub = await makeSubscription()
  const env = await envWith(kv, vapid)
  const armed = await (
    await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)
  ).json()
  await worker.fetch(post({ subscription: sub, stationId: uuid(2) }), env)

  const list = await (
    await worker.fetch(
      new Request(`https://w.test/watches?sub=${encodeURIComponent(armed.sub)}`),
      env,
    )
  ).json()
  assert.deepEqual(list.stations.sort(), [uuid(1), uuid(2)].sort())

  const del = await worker.fetch(
    new Request('https://w.test/watch', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Origin: 'https://imrahil.github.io' },
      body: JSON.stringify({ endpoint: sub.endpoint, stationId: uuid(1) }),
    }),
    env,
  )
  assert.equal(del.status, 200)
  assert.equal(kv.store.has(`watch:${uuid(1)}:${armed.sub}`), false)
  assert.ok(kv.store.has(`watch:${uuid(2)}:${armed.sub}`), 'other watch untouched')
})

const del = (endpoint, stationId) =>
  new Request('https://w.test/watch', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Origin: 'https://imrahil.github.io' },
    body: JSON.stringify({ endpoint, stationId }),
  })
const today = () => new Date().toISOString().slice(0, 10)

test('disarming what is not armed costs no delete and no budget', async () => {
  const kv = makeKV()
  const budget = makeBudget()
  installFetch({})
  const sub = await makeSubscription()
  const env = await envWith(kv, vapid, budget)

  for (let i = 0; i < 20; i++) {
    const r = await worker.fetch(del(sub.endpoint, uuid(1)), env)
    assert.equal(r.status, 200)
  }
  assert.equal(kv.deletes, 0)
  assert.equal(budget.storage.has('used:delete'), false)
})

test('DELETE /watch spends the delete budget and stops once it is gone', async () => {
  const kv = makeKV()
  const budget = makeBudget()
  installFetch({})
  const sub = await makeSubscription()
  const env = await envWith(kv, vapid, budget)
  const { sub: id } = await (await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)).json()
  await worker.fetch(post({ subscription: sub, stationId: uuid(2) }), env)

  assert.equal((await worker.fetch(del(sub.endpoint, uuid(1)), env)).status, 200)
  assert.equal(kv.deletes, 1)
  assert.deepEqual(budget.storage.get('used:delete'), { day: today(), n: 1 })

  budget.storage.set('used:delete', { day: today(), n: 300 })
  const refused = await worker.fetch(del(sub.endpoint, uuid(2)), env)
  assert.equal(refused.status, 429)
  assert.match((await refused.json()).error, /expire on its own/)
  assert.equal(kv.deletes, 1, 'nothing deleted when refused')
  assert.ok(kv.store.has(`watch:${uuid(2)}:${id}`), 'still armed')
})

test('GET /watches spends the list budget and stops once it is gone', async () => {
  const kv = makeKV()
  const budget = makeBudget()
  installFetch({})
  const env = await envWith(kv, vapid, budget)
  const watches = () => worker.fetch(new Request('https://w.test/watches?sub=abc'), env)

  assert.equal((await watches()).status, 200)
  assert.deepEqual(budget.storage.get('used:list'), { day: today(), n: 1 })

  budget.storage.set('used:list', { day: today(), n: 500 })
  const lists = kv.lists
  const refused = await watches()
  assert.equal(refused.status, 429)
  assert.equal(kv.lists, lists, 'nothing listed when refused')
})

test('POST /watch takes its lists before listing (2 for a new subscription)', async () => {
  const kv = makeKV()
  const budget = makeBudget()
  installFetch({})
  const sub = await makeSubscription()
  const env = await envWith(kv, vapid, budget)

  await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)
  assert.equal(kv.lists, 2)
  assert.equal(budget.storage.get('used:list').n, 2)
  await worker.fetch(post({ subscription: sub, stationId: uuid(2) }), env)
  assert.equal(kv.lists, 3, 'known subscription skips the sub: cap list')
  assert.equal(budget.storage.get('used:list').n, 3)

  budget.storage.set('used:list', { day: today(), n: 500 })
  const refused = await worker.fetch(post({ subscription: sub, stationId: uuid(3) }), env)
  assert.equal(refused.status, 429)
  assert.equal(kv.lists, 3)
  assert.equal(kv.writes, 3, 'nor written')
})

test('the cron delivers even when every public budget is spent', async () => {
  const sub = await makeSubscription()
  const kv = makeKV({
    state: JSON.stringify({ [uuid(1)]: 2 }),
    'sub:S': JSON.stringify(sub),
    [`watch:${uuid(1)}:S`]: '',
  })
  const budget = makeBudget()
  for (const [op, key] of [['put', 'used'], ['delete', 'used:delete'], ['list', 'used:list']]) {
    budget.storage.set(key, { day: today(), n: { put: 400, delete: 300, list: 500 }[op] })
  }
  const pushes = installFetch({ [uuid(1)]: 1 })
  await worker.scheduled({ scheduledTime: DAY }, await envWith(kv, vapid, budget))

  assert.equal(pushes.length, 1)
  assert.equal(kv.store.has(`watch:${uuid(1)}:S`), false, 'delivered and disarmed')
})

test('with no VAPID keys the board still refreshes and nothing is pushed', async () => {
  const sub = await makeSubscription()
  const kv = makeKV({
    state: JSON.stringify({ [uuid(1)]: 2 }),
    'sub:S': JSON.stringify(sub),
    [`watch:${uuid(1)}:S`]: '',
  })
  const pushes = installFetch({ [uuid(1)]: 1 })
  const env = await envWith(kv, vapid)
  delete env.VAPID_PRIVATE_KEY // worker deployed before the secret was set

  await worker.scheduled({ scheduledTime: DAY }, env)

  assert.equal(pushes.length, 0, 'no attempt to sign with a missing key')
  assert.ok(await kv.get('all'), 'the board was still refreshed')
  assert.deepEqual(await kv.get('state', 'json'), { [uuid(1)]: 1 }, 'baseline still advances')

  const res = await worker.fetch(post({ subscription: sub, stationId: uuid(1) }), env)
  assert.equal(res.status, 503, 'arming says so rather than failing later')
})

test('GET /stations still serves the board', async () => {
  const kv = makeKV({ all: JSON.stringify({ updatedAt: 1, stations: [] }) })
  installFetch({})
  const res = await worker.fetch(new Request('https://w.test/stations'), await envWith(kv, vapid))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
  assert.deepEqual(await res.json(), { updatedAt: 1, stations: [] })
})

// --- history ---------------------------------------------------------------

const sample = (updatedAt, entries) => ({
  updatedAt,
  stations: entries.map(([n, power]) => ({
    ref: { id: uuid(n), name: `S${n}` },
    data: power === null ? null : { State: power > 0 ? 2 : 1, ActivePower: power },
  })),
})

test('history appends aligned samples and keeps gaps as null', () => {
  let h = appendHistory(null, sample(1000, [[1, 7.44], [2, null]]))
  h = appendHistory(h, sample(2000, [[1, 0], [2, 3.6]]))
  assert.deepEqual(h, {
    t: [1000, 2000],
    p: { [uuid(1)]: [7.4, 0], [uuid(2)]: [null, 3.6] },
    s: { [uuid(1)]: [1, 0], [uuid(2)]: [null, 1] },
  })
})

test('history drops samples older than 12h and pads new stations', () => {
  const H = 12 * 60 * 60 * 1000
  let h = appendHistory(null, sample(0, [[1, 5]]))
  h = appendHistory(h, sample(H / 2, [[1, 6]]))
  h = appendHistory(h, sample(H + 1000, [[1, 7], [3, 2]]))
  assert.deepEqual(h.t, [H / 2, H + 1000])
  assert.deepEqual(h.p[uuid(1)], [6, 7])
  assert.deepEqual(h.p[uuid(3)], [null, 2])
})

test('history written before occupancy existed gains it, padded with gaps', () => {
  const legacy = { t: [1000], p: { [uuid(1)]: [5] } }
  const h = appendHistory(legacy, sample(2000, [[1, 6]]))
  assert.deepEqual(h.p[uuid(1)], [5, 6])
  assert.deepEqual(h.s[uuid(1)], [null, 1])
})

test('history drops stations removed from stations.json', () => {
  let h = appendHistory(null, sample(1000, [[1, 1], [2, 2]]))
  h = appendHistory(h, sample(2000, [[1, 1]]))
  assert.deepEqual(Object.keys(h.p), [uuid(1)])
})

test('cron run writes history and GET /history serves it', async () => {
  const kv = makeKV()
  installFetch({ [uuid(1)]: 2 })
  const env = await envWith(kv, vapid)
  await worker.scheduled({ scheduledTime: DAY }, env)

  const res = await worker.fetch(new Request('https://w.test/history'), env)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.t.length, 1)
  assert.deepEqual(body.p[uuid(1)], [null]) // mock ecarup reports no ActivePower
  assert.deepEqual(body.s[uuid(1)], [1]) // but it does report State 2 = plugged in
})

test('GET /history is empty, not an error, before the first run', async () => {
  const res = await worker.fetch(new Request('https://w.test/history'), await envWith(makeKV(), vapid))
  assert.deepEqual(await res.json(), { t: [], p: {}, s: {} })
})
