// The public endpoints (watches.js) and the daily KV budget that guards them
// (budget.js): POST/DELETE /watch and GET /watches.
//
//   cd worker && npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../src/worker.js'
import {
  b64url,
  DAY,
  del,
  envWith,
  installFetch,
  makeBudget,
  makeKV,
  makeSubscription,
  makeVapid,
  post,
  today,
  uuid,
} from './helpers.mjs'

const vapid = await makeVapid()

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
