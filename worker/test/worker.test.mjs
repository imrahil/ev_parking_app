// Exercises worker.js against a mock KV and a mock push service. The push
// crypto is NOT mocked — the real RFC 8291 encryption runs for every send.
//
//   cd worker && npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../src/worker.js'

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
  return {
    store,
    async get(key, type) {
      const v = store.get(key)
      if (v === undefined) return null
      return type === 'json' ? JSON.parse(v) : v
    },
    async put(key, value) {
      store.set(key, value)
    },
    async delete(key) {
      store.delete(key)
    },
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .slice(0, limit)
        .map((name) => ({ name }))
      return { keys, list_complete: true }
    },
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

async function envWith(kv, vapid) {
  return {
    CACHE: kv,
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
  // 45 stations => 50 - 1 - 45 = 4 pushes of headroom
  const states = {}
  for (let i = 1; i <= 45; i++) states[uuid(i)] = 2
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

  assert.equal(pushes.length, 4, `sent ${pushes.length}, expected the 4 that fit`)
  assert.deepEqual(await kv.get('pending', 'json'), [freed], 'overflow carried to next run')
  const left = [...kv.store.keys()].filter((k) => k.startsWith('watch:'))
  assert.equal(left.length, 2, 'undelivered watches stay armed')
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
