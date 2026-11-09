// Shared by the worker tests and by the frontend's contract test
// (src/worker.test.ts): a mock KV, the real WriteBudget over in-memory
// storage, a mock upstream + push service, and request builders.
// Not a test file itself — `npm test` only runs *.test.mjs.
import { WriteBudget } from '../src/budget.js'

export const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function makeVapid() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])
  const pub = await crypto.subtle.exportKey('raw', kp.publicKey)
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  return { publicKey: b64url(pub), privateKey: jwk.d }
}

export async function makeSubscription(host = 'fcm.googleapis.com', id = 'a') {
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

export function makeKV(initial = {}) {
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
export function makeBudget() {
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

export const STATIONS_JSON_URL = 'https://example.test/stations.json'

export function installFetch(states, pushStatus = 201) {
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

export const uuid = (n) => `${String(n).padStart(8, '0')}-1111-2222-3333-444444444444`

export async function envWith(kv, vapid, budget = makeBudget()) {
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
export const DAY = new Date('2026-09-01T12:00:00Z').getTime()
export const NIGHT = new Date('2026-09-01T20:00:00Z').getTime()

// --- requests to the public endpoints ---------------------------------------

export const post = (body, origin = 'https://imrahil.github.io') =>
  new Request('https://w.test/watch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  })

export const del = (endpoint, stationId) =>
  new Request('https://w.test/watch', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Origin: 'https://imrahil.github.io' },
    body: JSON.stringify({ endpoint, stationId }),
  })
export const today = () => new Date().toISOString().slice(0, 10)
