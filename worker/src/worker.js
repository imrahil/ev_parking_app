const ECARUP_BASE = 'https://www.ecarup.com/api/stations'
const KV_KEY = 'all'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

/**
 * Fetches every station from ecarup and stores the aggregate in KV.
 * Returns the payload: { updatedAt, stations: [{ ref, data, error? }] }
 *
 * Note: the free plan allows 50 subrequests per invocation — with
 * stations.json + KV put that caps the list at ~48 stations. Batch the
 * fetches if the list ever grows beyond that.
 */
async function refreshAll(env) {
  const res = await fetch(env.STATIONS_JSON_URL)
  if (!res.ok) throw new Error(`stations.json HTTP ${res.status}`)
  const refs = await res.json()

  const stations = await Promise.all(
    refs.map(async (ref) => {
      try {
        const r = await fetch(`${ECARUP_BASE}?id=${encodeURIComponent(ref.id)}`)
        if (!r.ok) return { ref, data: null, error: `HTTP ${r.status}` }
        return { ref, data: await r.json() }
      } catch (e) {
        return { ref, data: null, error: e instanceof Error ? e.message : String(e) }
      }
    })
  )

  const payload = { updatedAt: Date.now(), stations }
  await env.CACHE.put(KV_KEY, JSON.stringify(payload))
  return payload
}

export default {
  async scheduled(event, env) {
    // Overnight parking isn't allowed, so nobody needs fresh data at night:
    // refresh every 10 min from 06:00-17:59 Zurich time, hourly otherwise.
    // (Cron schedules run in UTC; checking Europe/Zurich here keeps the
    // boundary correct across daylight-saving changes.)
    const when = new Date(event.scheduledTime)
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', {
        hour: 'numeric',
        hourCycle: 'h23',
        timeZone: 'Europe/Zurich',
      }).format(when)
    )
    const night = hour >= 18 || hour < 6
    if (night && when.getUTCMinutes() !== 0) return
    await refreshAll(env)
  },

  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(request.url)
    if (!['GET', 'HEAD'].includes(request.method) || !['/', '/stations'].includes(url.pathname)) {
      return new Response('Not found', { status: 404, headers: CORS_HEADERS })
    }

    try {
      // Warm the cache on the first request after deploy (before the cron ran)
      let body = await env.CACHE.get(KV_KEY)
      if (!body) body = JSON.stringify(await refreshAll(env))

      return new Response(body, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        },
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }
  },
}
