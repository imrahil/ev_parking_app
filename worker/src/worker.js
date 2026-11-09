// Entry point: the cron that refreshes everything and the HTTP routes.
//
//   board.js    fetch every station from ecarup -> KV `all`
//   history.js  12 h charging-power history    -> KV `history`
//   notify.js   state diff -> one-shot pushes (push.js does the crypto)
//   watches.js  POST/DELETE /watch, GET /watches
//   budget.js   daily KV budget for those public endpoints (Durable Object)
//   http.js     CORS and response helpers

import { BOARD_KEY, refreshAll } from './board.js'
import { HISTORY_KEY, recordHistory } from './history.js'
import { cachedJson, corsFor, errorMessage, json } from './http.js'
import { notifyWatchers } from './notify.js'
import { handleWatch, handleWatches } from './watches.js'

// The Durable Object class has to be exported from the module `main` points at
export { WriteBudget } from './budget.js'
export { appendHistory } from './history.js'

// Night window (Europe/Zurich): only hourly refreshes between these hours, and
// no notifications at all. Overnight parking isn't allowed, so nobody needs
// fresh data — or a push at 03:00.
const NIGHT_START_HOUR = 20 // inclusive
const NIGHT_END_HOUR = 6 // exclusive
const TIME_ZONE = 'Europe/Zurich'

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
    // Best effort: a history failure must not cost anyone their notification
    try {
      await recordHistory(env, payload)
    } catch (e) {
      console.error('history', e)
    }
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

    if (url.pathname === '/history' && ['GET', 'HEAD'].includes(request.method)) {
      const body = (await env.CACHE.get(HISTORY_KEY)) ?? JSON.stringify({ t: [], p: {}, s: {} })
      return cachedJson(body, cors)
    }

    if (!['GET', 'HEAD'].includes(request.method) || !['/', '/stations'].includes(url.pathname)) {
      return new Response('Not found', { status: 404, headers: cors })
    }

    try {
      // Warm the cache on the first request after deploy (before the cron ran)
      let body = await env.CACHE.get(BOARD_KEY)
      if (!body) body = JSON.stringify(await refreshAll(env))

      return cachedJson(body, cors)
    } catch (e) {
      return json({ error: errorMessage(e) }, 502, cors)
    }
  },
}
