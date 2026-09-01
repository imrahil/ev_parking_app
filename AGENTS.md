# AGENTS.md

Guidance for coding agents working in this repository. Human-facing docs live
in [`README.md`](README.md) and [`worker/README.md`](worker/README.md).

## Setup commands

```sh
npm install
npm run dev      # Vite dev server
npm run build    # tsc -b (type-check) + production build to dist/
npm run preview  # serve the production build
```

There is **no test runner and no linter**. `npm run build` is the only
automated check — run it before declaring frontend work done.

Worker commands run from `worker/`:

```sh
npx wrangler dev     # run the worker locally
npx wrangler deploy  # deploy (also needed after any worker/ change)
npx wrangler tail    # live logs
```

## Architecture

Single-page React app (GitHub Pages) + a Cloudflare Worker that does the
station polling server-side.

```
public/stations.json ──(HTTP read on every refresh)──┐
                                                     ▼
        cron */10min ──►  worker/src/worker.js  ──►  ecarup.com/api/stations?id=…
                                │
                                ▼
                            KV cache  ──►  GET /stations  ──►  src/hooks/useStations.ts
```

The pieces that need reading together:

- **`worker/src/worker.js`** — `refreshAll()` fetches `STATIONS_JSON_URL`
  (set in `wrangler.toml` [vars], pointing at the GitHub Pages copy of
  `stations.json`), fans out one fetch per station, and writes
  `{ updatedAt, stations: [{ ref, data, error? }] }` to KV under the key
  `all`. `fetch()` serves that blob and warms it on-demand if KV is empty.
- **`src/hooks/useStations.ts`** — the only place that knows about the two
  modes (below). Polls every `REFRESH_MS` and on `visibilitychange`.
- **`src/api.ts`** — `fetchAllStations()` (worker), `fetchStation()` (direct),
  `loadStations()` (stations.json), and `stateToStatus()`.
- **`src/App.tsx`** — grid, group filter chips, counts, settings dialog wiring.

### Two modes

`API_URL` (`src/api.ts`, from `VITE_API_URL`) decides:

- **API mode** (non-empty): one `GET /stations` per refresh. The station list
  arrives *with* the response, so `stations.json` is never fetched by the
  browser.
- **Direct mode** (empty): the browser loads `stations.json` and polls
  `ecarup.com` per station — ecarup's CORS headers become load-bearing. Kept
  as a local-dev convenience and an escape hatch if the worker is down. Don't
  delete it when touching the hook.

## Conventions and constraints

- **`public/stations.json` is edited directly on GitHub.** The worker re-reads
  it over HTTP on every refresh, so adding a station needs no rebuild and no
  worker redeploy. Never move the list into the bundle or into worker code.
- **`VITE_API_URL` is baked in at build time**, so changing it requires a
  rebuild + redeploy. `.env` is committed deliberately: the worker URL is
  public and the GitHub Actions build passes no env of its own.
- **No user-facing refresh controls.** `REFRESH_MS` in `src/App.tsx` is fixed
  at 60 s (the worker refreshes every 10 min; polling its cache more often
  buys nothing). A configurable interval existed once and was removed on
  purpose — don't reintroduce it.
- **`fetchedAt` is the worker's `updatedAt` in API mode**, not the browser's
  fetch time, so "Updated X ago" on a card shows the real data age. Keep that
  when refactoring.
- **The night window lives in `worker.js`, not in the cron.** The cron fires
  every 10 min year-round; `scheduled()` returns early off the hour between
  20:00–06:00 Europe/Zurich (checked via `Intl` on `event.scheduledTime` so
  DST stays correct).
- **Free-plan limit: 50 subrequests per worker invocation**, which with
  `stations.json` + the KV put caps the list at ~48 stations. Batch the
  fetches in `refreshAll()` before going past that.
- **Status values are constants**, not string literals: `STATUS` /
  `STATE_CODE` and the class-name maps live in `src/consts/consts.ts`.
- The `name` in `stations.json` is a fallback label only — the live `Name`
  from the API wins once a fetch succeeds.
- `useStations` guards refreshes with an **effect-local** `refreshing` flag so
  a StrictMode remount can't block the next mount's first refresh. Keep it
  effect-local if you touch that effect.

## Styling

- Tailwind v4, configured **in CSS** (`src/index.css`) — no `tailwind.config`.
  Palette and font tokens are `@theme` custom properties (`--color-navy`,
  `--color-mint`, `--color-busy`, …); use the token classes (`text-mint`,
  `bg-navy`) rather than raw hex.
- Dark mode is **class-based** via `@custom-variant dark (&:where(.dark, .dark *))`.
  Two places toggle `.dark` on `<html>`: `src/hooks/useTheme.ts` and the inline
  no-flash script in `index.html`. Change one, change the other — and keep the
  `parking-app:theme` key identical in both.
- `vite.config.ts` sets `base: './'` so the build works from any GitHub Pages
  subpath. Reference public assets relatively (`./icons/…`), never `/icons/…`.

## Code style

No formatter config is checked in; match the surrounding code: 2-space indent,
single quotes, **no semicolons**, named exports (no default exports), function
components with hooks in `src/hooks/`, types in `src/types.ts`.

## Deployment

Push to `main` → `.github/workflows/deploy.yml` builds and publishes `dist/`
to GitHub Pages. The worker is **not** deployed by CI: run
`npx wrangler deploy` from `worker/` after changing anything under `worker/`.
