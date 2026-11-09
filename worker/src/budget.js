// Daily KV budget for the public endpoints, counted in a Durable Object.

import { json } from './http.js'

// KV operations the public endpoints (/watch, /watches) may spend per UTC day,
// when the free plan's budgets reset. Puts, deletes and lists each have their
// own 1,000/day; these caps leave the cron the rest, so abuse can at worst
// disable arming/disarming until midnight UTC, never freeze the board (puts)
// or stop notifications from being delivered (deletes, lists).
// Counted strictly in WriteBudget. The cron is never counted:
//   put    — needs ~300/day (`all` + `history` per run, `state` on change)
//   delete — ~1 per delivered push (bounded by the watch puts) + `pending`
//   list   — 1 per run that has a freed station, so <= ~94/day
const PUBLIC_KV_BUDGET = { put: 400, delete: 300, list: 500 }
// Where each counter lives in WriteBudget's storage. `used` predates the
// delete/list counters, so it stays the put counter.
const BUDGET_STORAGE_KEY = { put: 'used', delete: 'used:delete', list: 'used:list' }

const BUDGET_EXHAUSTED = {
  put: 'Too many notifications armed today — try again tomorrow',
  delete: 'Too many notifications turned off today — it will expire on its own within 8 hours',
  list: 'Too many notification lookups today — try again tomorrow',
}

/**
 * Strict, global count of the KV puts, deletes and lists the public endpoints
 * have made today (one counter each — the class name predates the last two,
 * and renaming a Durable Object class needs a migration). A Durable Object
 * because the built-in rate limiter is per-location and per-minute at most,
 * which can't hold a daily total. One instance (idFromName('watch')); its
 * requests run one at a time, so the read-check-write below cannot race.
 *
 * A plain fetch() class rather than an RPC DurableObject subclass, so
 * worker.js stays importable under node:test.
 */
export class WriteBudget {
  constructor(state) {
    this.storage = state.storage
  }

  /** GET ?op=put|delete|list&n=<count>&limit=<per day> → { ok, used } */
  async fetch(request) {
    const url = new URL(request.url)
    const key = BUDGET_STORAGE_KEY[url.searchParams.get('op') ?? 'put']
    const n = Number(url.searchParams.get('n'))
    const limit = Number(url.searchParams.get('limit'))
    if (!key || !(n > 0) || !(limit > 0)) return Response.json({ error: 'Bad request' }, { status: 400 })

    const day = new Date().toISOString().slice(0, 10) // UTC, like the KV reset
    const prev = await this.storage.get(key)
    const used = prev?.day === day ? prev.n : 0
    if (used + n > limit) return Response.json({ ok: false, used })

    await this.storage.put(key, { day, n: used + n })
    return Response.json({ ok: true, used: used + n })
  }
}

/**
 * Takes `n` of today's public budget for a KV operation before it is spent.
 * Returns null to proceed, or the error Response to send instead: 429 once the
 * budget is gone, 503 if the budget can't be reached — fail closed, because an
 * uncounted operation is exactly what this guards against.
 */
export async function spendBudget(env, op, n, cors) {
  let ok
  try {
    const stub = env.WATCH_BUDGET.get(env.WATCH_BUDGET.idFromName('watch'))
    const res = await stub.fetch(`https://budget/take?op=${op}&n=${n}&limit=${PUBLIC_KV_BUDGET[op]}`)
    if (!res.ok) throw new Error(`budget HTTP ${res.status}`)
    ok = (await res.json()).ok
  } catch (e) {
    console.error('kv budget', e)
    return json({ error: 'Notifications are temporarily unavailable' }, 503, cors)
  }
  return ok ? null : json({ error: BUDGET_EXHAUSTED[op] }, 429, cors)
}
