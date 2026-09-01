# Pilatus EV Chargers

Live status board (available / occupied) for the EV chargers available to
Pilatus Aircraft employees. Installable as a PWA, hosted on GitHub Pages.

Station data comes from the ecarup.com public API. Since v2 the app no longer
polls ecarup from the browser: a **Cloudflare Worker** does the fetching
server-side and the app reads one cached aggregate.

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
- **Settings** — hide charger groups you don't care about (⚙ in the header).
- **Themes** — auto / light / dark, applied before first paint so there's no
  flash of the wrong theme.
- **Per-connector chips** — stations with more than one connector show each
  connector's state individually.
- **Direct-mode fallback** — with `VITE_API_URL` empty the app calls ecarup
  from the browser exactly as it used to. Useful for local dev and as an
  escape hatch if the worker is down.

## Stack

React 19 + Vite + TypeScript + Tailwind v4 on the frontend; a Cloudflare
Worker (KV + cron trigger) as the backend. Deployed to GitHub Pages by
`.github/workflows/deploy.yml` on every push to `main`.

## Architecture

```
public/stations.json ──(read on every refresh)──┐
                                                ▼
       cron */10min ──►  Cloudflare Worker  ──► ecarup.com/api/stations?id=…
                              │  (one fetch per station)
                              ▼
                          KV cache  ──►  GET /stations  ──►  the app (every 60 s)
```

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
```

There is no test runner or linter configured; `npm run build` is the check.

### Configuration

`.env` (committed on purpose — the worker URL is public, and the GitHub Pages
build needs it at build time):

```
VITE_API_URL=https://parking-status.<subdomain>.workers.dev/stations
```

`VITE_API_URL` is baked into the bundle at build time, so changing it requires
a rebuild/redeploy. Leave it empty to run in direct mode against ecarup.

## Worker

See [`worker/README.md`](worker/README.md) for one-time setup
(`wrangler login` → `kv namespace create` → `deploy`), the response shape,
logs (`npx wrangler tail`), and the free-plan limits (notably: 50 subrequests
per invocation caps the station list at ~48).

## Adding stations

Edit `public/stations.json` — an array of `{ id, name, group? }`:

```json
{ "id": "dc35802d-…", "name": "Besucherparkplatz 1", "group": "Besucherplatz" }
```

`name` is only a fallback label; the live `Name` from the API wins once a fetch
succeeds. `group` drives the filter chips and the settings dialog.

## Persisted settings

All in `localStorage`:

| Key                         | Value                                                  |
| --------------------------- | ------------------------------------------------------ |
| `parking-app:theme`         | `light` / `dark` (absent = follow the OS)              |
| `parking-app:groupFilter`   | the active group chip (`''` = All)                     |
| `parking-app:hiddenGroups`  | JSON array of groups hidden via Settings               |

Default hidden groups: `Besucherplatz`, `Parkhaus EG`.
