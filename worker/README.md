# parking-status worker

Cloudflare Worker that polls all ecarup stations every 10 minutes (cron
trigger), stores the aggregate in KV, and serves it to the app from a single
endpoint: `GET /stations`. It also sends the "your charger is free" Web Push
notifications. See the repo `README.md` for how the app consumes it.

```sh
npm test   # node:test, no dependencies
```

## One-time setup

Requires a free Cloudflare account (dash.cloudflare.com). Then, from this
`worker/` directory:

```sh
# 1. Log in (opens the browser)
npx wrangler login

# 2. Create the KV namespace and copy the printed id
#    into wrangler.toml ([[kv_namespaces]] -> id)
npx wrangler kv namespace create CACHE

# 3. Store the VAPID private key (see "Notifications" below)
npx wrangler secret put VAPID_PRIVATE_KEY

# 4. Deploy — the printed URL is the API endpoint
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

## Notification endpoints

| Route | Purpose |
| --- | --- |
| `POST /watch` `{subscription, stationId}` | arm a one-shot watch |
| `DELETE /watch` `{endpoint, stationId}` | disarm it |
| `GET /watches?sub=<id>` | what this device has armed (survives a reinstall) |

Writes are restricted to the origins in `ALLOWED_ORIGINS`, the subscription
endpoint must be on a known push service, and each subscription may hold 5
watches (200 subscriptions total). Those caps matter: the free plan allows
1,000 KV writes/day and the board shares that budget.

## Notifications

`scheduled()` diffs each refresh against the `state` key and pushes to whoever
watches a station that just went occupied → available. Watches are one-shot
(delivered, then deleted) and carry an 8h TTL so forgotten ones expire for
free. Night runs (20:00–06:00) update the baseline but never notify.

Because notifications ride the existing 10-minute refresh, a freed charger is
detected 0–10 minutes later. If that turns out to be too slow, the upgrade is a
second cron that polls **only the watched stations** every minute — cheap,
since there are rarely more than a handful.

Setup: `npx web-push generate-vapid-keys`, then the public key into
`wrangler.toml` (`VAPID_PUBLIC_KEY`) and the app's `.env`
(`VITE_VAPID_PUBLIC_KEY`), and the private key into
`npx wrangler secret put VAPID_PRIVATE_KEY`.

`src/push.js` implements RFC 8291 / RFC 8292 by hand — the npm web-push
libraries that run on Workers still emit the legacy `aesgcm` encoding, which
Apple rejects, so they break iOS silently. `test/push.test.mjs` pins it to the
RFC's own test vector.

## Frontend

`src/api.ts` reads the endpoint from `VITE_API_URL` (see `.env`). When it is
empty, the app falls back to calling ecarup.com directly from the browser —
useful for local dev and as an escape hatch if the worker is down.

## Day-2 operations

- **Add/remove stations**: edit `public/stations.json` on GitHub as before.
  The worker re-reads it on every refresh — no redeploy needed.
- **Logs**: `npx wrangler tail`
- **Change cadence**: edit `crons` in `wrangler.toml`, redeploy. The cron fires
  every 10 minutes, but between 20:00 and 06:00 Europe/Zurich the handler only
  refreshes on the full hour (overnight parking isn't allowed, so nobody needs
  fresh data then) — that window lives in `worker.js`, not in the cron.
- **Debug a notification**: seed the baseline as occupied for a station that is
  actually free, then run the cron —
  `npx wrangler kv key put --binding CACHE state '{"<station-id>":2}'`.
- **Limits** (free plan): 100k requests/day; **50 _external_ subrequests** per
  invocation (KV is not external — it has its own 1000/invocation budget), so
  `stations.json` + one fetch per station leaves the rest as the push budget,
  and the station list is capped near 49; KV 1k writes/day (cron uses ~94, and
  `state` is only written when something changed); 10ms CPU per invocation —
  if `wrangler tail` ever reports "Exceeded CPU limit", move `notifyWatchers`
  into its own invocation.
