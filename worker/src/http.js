// CORS, response and error-text helpers shared by the other modules.

export function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function corsFor(request, env) {
  const origin = request.headers.get('Origin')
  const allowed = origin && allowedOrigins(env).includes(origin)
  return {
    // The board is public data, so reads stay open to any origin; writes are
    // gated separately in handleWatch (CORS is not a security boundary).
    'Access-Control-Allow-Origin': allowed ? origin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...(allowed ? { Vary: 'Origin' } : {}),
  }
}

export function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/**
 * Serves a blob straight out of KV (already JSON text). Cacheable for a
 * minute: the cron rewrites it every 10, and the board polls every 60 s.
 */
export function cachedJson(body, cors) {
  return new Response(body, {
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
  })
}

export function errorMessage(e) {
  return e instanceof Error ? e.message : String(e)
}
