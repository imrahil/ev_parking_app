// The cron's notification state machine (notify.js), run through
// worker.scheduled() against a mock KV and a mock push service. The push
// crypto is NOT mocked — the real RFC 8291 encryption runs for every send.
//
//   cd worker && npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../src/worker.js'
import {
  DAY,
  envWith,
  installFetch,
  makeBudget,
  makeKV,
  makeSubscription,
  makeVapid,
  NIGHT,
  post,
  today,
  uuid,
} from './helpers.mjs'

const vapid = await makeVapid()

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
