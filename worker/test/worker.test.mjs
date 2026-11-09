// The entry point's own routes (worker.js). The cron, the watch endpoints and
// the history each have their own test file.
//
//   cd worker && npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import worker from '../src/worker.js'
import {
  envWith,
  installFetch,
  makeKV,
  makeVapid,
} from './helpers.mjs'

const vapid = await makeVapid()

test('GET /stations still serves the board', async () => {
  const kv = makeKV({ all: JSON.stringify({ updatedAt: 1, stations: [] }) })
  installFetch({})
  const res = await worker.fetch(new Request('https://w.test/stations'), await envWith(kv, vapid))
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
  assert.deepEqual(await res.json(), { updatedAt: 1, stations: [] })
})
