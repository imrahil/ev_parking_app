// The 12 h power history (history.js): appendHistory() on its own, then the
// cron writing it and GET /history serving it.
//
//   cd worker && npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { appendHistory } from '../src/history.js'
import worker from '../src/worker.js'
import {
  DAY,
  envWith,
  installFetch,
  makeKV,
  makeVapid,
  uuid,
} from './helpers.mjs'

const vapid = await makeVapid()

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
