# Pilatus EV Chargers

Live status board (available / occupied) for the EV chargers available to
Pilatus Aircraft employees. Installable as a PWA, hosted on GitHub Pages.

Station data comes from the ecarup.com public API. Since v2 the app no longer
polls ecarup from the browser: a **Cloudflare Worker** does the fetching
server-side and the app reads one cached aggregate. The same worker keeps a
12-hour power history and sends the "charger is free" push notifications.

## Features

- **Server-side fetching** — a Cloudflare Worker polls every station on a cron
  schedule, caches the aggregate in KV, and serves it from a single
  `GET /stations` endpoint. The browser makes **one** request per refresh
  instead of one per station, and no longer depends on ecarup's CORS headers.
- **Night cadence** — the cron fires every 10 minutes, but between 20:00 and
  06:00 Europe/Zurich the worker only refreshes on the full hour (overnight
  parking isn't allowed, so nobody needs fresh data then).
- **Honest timestamps** — cards show "Updated X ago" based on when the *worker*
  last polled ecarup, not when the browser last fetched the cache.
- **Auto-refresh** — the app re-reads the cache every 60 s and immediately when
  the tab / PWA comes back into view. There are no manual refresh controls.
- **Group filters** — chips per charger area (`group` in `stations.json`) with
  a free/total badge; the active filter is remembered.
- **Free only** — a switch next to the chips that shows just the chargers that
  are free right now; the badges keep counting everything. Remembered too.
- **Themes** — auto / light / dark, applied before first paint so there's no
  flash of the wrong theme.
- **Per-connector chips** — stations with more than one connector show each
  connector's state individually.
- **Charging power** — an occupied card shows the power currently being drawn.
- **12-hour power history** — every card has a sparkline of charging power
  over the last 12 hours, with its peak, a tick on every full clock hour, and
  shading for the periods a car was plugged in (an idle plugged-in car reads
  0 kW, just like a free bay). Gaps are left as gaps, never drawn across.
- **"Notify me when it's free"** — tap the bell on a busy charger and get a push
  notification the moment it frees up, even with the app closed. Watches fire
  once, never at night, and expire after 8 hours.
- **Direct-mode fallback** — with `VITE_API_URL` empty the app calls ecarup
  from the browser exactly as it used to. Useful for local dev and as an
  escape hatch if the worker is down.

## Stack

React 19 + Vite + TypeScript + Tailwind v4 on the frontend; a Cloudflare
Worker (KV, a cron trigger, and one Durable Object that counts the public
endpoints' daily KV budget) as the backend, all on the free plan. The app is
deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to
`main`; the worker is deployed by hand with `npx wrangler deploy`.

## Architecture

```
public/stations.json ──(read on every refresh)──┐
                                                ▼
       cron */10min ──►  Cloudflare Worker  ──► ecarup.com/api/stations?id=…
                              │  (one fetch per station)
                              ▼
                          KV cache  ──►  GET /stations  ──►  the app (every 60 s)
                              ├──────►  GET /history   ──►  sparklines (every 5 min)
                              └──────►  Web Push       ──►  devices watching a charger
```

Each cron run does three things with the fresh data: rewrites the board blob,
appends one sample per station to the 12 h history, and compares every
station's state with the previous run to push to whoever is watching one that
just freed up. The app arms and disarms those watches through `POST` /
`DELETE /watch`.

The station list lives in `public/stations.json` and is served by GitHub Pages.
The worker reads it over HTTP on every refresh, so **adding or removing a
station is a one-file edit on GitHub** — no rebuild of the app, no redeploy of
the worker.

State mapping used by the UI (`stateToStatus` in `src/api.ts`):

| `State` | Meaning   |
| ------- | --------- |
| `1`     | Available |
| `2`     | Occupied  |
| other   | Unknown   |

The same mapping applies per `Connector`.

## Local development

```sh
npm install
npm run dev      # start the Vite dev server
npm run build    # type-check (tsc -b) + production build to dist/
npm run preview  # preview the production build
npm test         # unit + contract tests (Vitest)
npm run e2e      # end-to-end tests (Playwright; first run: npx playwright install chromium)
npm run coverage # unit-test coverage report
```

CI (`.github/workflows/ci.yml`) runs the tests, the build, the worker tests
and the e2e suite on every pull request, and the GitHub Pages deploy waits
for it.

### Configuration

`.env` (committed on purpose — both values are public, and the GitHub Pages
build needs them at build time):

```
VITE_API_URL=https://parking-status.<subdomain>.workers.dev/stations
VITE_VAPID_PUBLIC_KEY=<public half of the VAPID pair>
```

Both are baked into the bundle at build time, so changing either requires a
rebuild/redeploy. Leave `VITE_API_URL` empty to run in direct mode against
ecarup; leave `VITE_VAPID_PUBLIC_KEY` empty to ship without notifications.

### Notifications setup

One-time, to turn the bell on:

```sh
npx web-push generate-vapid-keys      # generates a keypair
```

- Public key → `.env` as `VITE_VAPID_PUBLIC_KEY` **and** `worker/wrangler.toml`
  as `VAPID_PUBLIC_KEY`. It is public by design — the browser is handed it.
- Private key → `cd worker && npx wrangler secret put VAPID_PRIVATE_KEY`.
  Never commit it.

Then redeploy both halves. On **iPhone and iPad the app must be installed**
(Share → Add to Home Screen, iOS 16.4+) — Safari does not deliver push to a
plain tab. Everywhere else a normal tab is enough.

## Worker

`cd worker && npm test` runs the worker's test suite (`node:test`, no
dependencies) — it covers the notification state machine and pins the push
encryption to the RFC 8291 test vector.

See [`worker/README.md`](worker/README.md) for one-time setup
(`wrangler login` → `kv namespace create` → `deploy`), the endpoints and
their response shapes, logs (`npx wrangler tail`), and the free-plan limits
(notably: 50 subrequests per invocation caps the station list at ~48, and the
public notification endpoints have their own daily KV budget so they can never
starve the board).

CI does not deploy the worker. After changing anything under `worker/`, run
`npx wrangler deploy` from that directory.

## Adding stations

Edit `public/stations.json` — an array of `{ id, name, group? }`:

```json
{ "id": "dc35802d-…", "name": "Besucherparkplatz 1", "group": "Besucherplatz" }
```

`name` is only a fallback label; the live `Name` from the API wins once a fetch
succeeds. `group` drives the filter chips.

## Persisted settings

All in `localStorage`:

| Key                         | Value                                                  |
| --------------------------- | ------------------------------------------------------ |
| `parking-app:theme`         | `light` / `dark` (absent = follow the OS)              |
| `parking-app:groupFilter`   | the active group chip (`''` = All)                     |
| `parking-app:freeOnly`      | `1` / `0` — the "Free only" switch                     |
| `parking-app:watches`       | station ids with an armed notification (server is truth) |

Every group is always shown; there is no way to hide one.
