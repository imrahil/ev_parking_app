# parking-status worker

Cloudflare Worker that polls all ecarup stations every 10 minutes (cron
trigger), stores the aggregate in KV, and serves it to the app from a single
endpoint: `GET /stations`. See `docs/backend-options.md` for the rationale.

## One-time setup

Requires a free Cloudflare account (dash.cloudflare.com). Then, from this
`worker/` directory:

```sh
# 1. Log in (opens the browser)
npx wrangler login

# 2. Create the KV namespace and copy the printed id
#    into wrangler.toml ([[kv_namespaces]] -> id)
npx wrangler kv namespace create CACHE

# 3. Deploy — the printed URL is the API endpoint
npx wrangler deploy
```

The deploy prints a URL like `https://parking-status.<subdomain>.workers.dev`.
Put that (plus `/stations`) into `VITE_API_URL` — see "Frontend" below.

## Endpoint

`GET /stations` →

```json
{
  "updatedAt": 1751970000000,
  "stations": [
    { "ref": { "id": "…", "name": "…", "group": "…" }, "data": { /* ecarup response */ } },
    { "ref": { "id": "…", "name": "…" }, "data": null, "error": "HTTP 500" }
  ]
}
```

- `updatedAt` — when the worker last refreshed from ecarup (ms epoch).
- `data` is the untouched ecarup station response; `error` is set instead when
  that station's fetch failed.
- The first request after a fresh deploy triggers an on-demand refresh, so the
  endpoint works before the first cron run.

## Frontend

`src/api.ts` reads the endpoint from `VITE_API_URL` (see `.env`). When it is
empty, the app falls back to calling ecarup.com directly from the browser —
useful for local dev and as an escape hatch if the worker is down.

## Day-2 operations

- **Add/remove stations**: edit `public/stations.json` on GitHub as before.
  The worker re-reads it on every refresh — no redeploy needed.
- **Logs**: `npx wrangler tail`
- **Change cadence**: edit `crons` in `wrangler.toml`, redeploy. The cron fires
  every 10 minutes, but between 18:00 and 06:00 Europe/Zurich the handler only
  refreshes on the full hour (overnight parking isn't allowed, so nobody needs
  fresh data then) — that window lives in `worker.js`, not in the cron.
- **Limits** (free plan): 100k requests/day, 50 subrequests per invocation
  (caps the station list at ~48 — batch the fetches in `refreshAll` if you
  ever exceed that), KV 1k writes/day (cron uses 144).
