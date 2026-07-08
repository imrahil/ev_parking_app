# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — type-check (`tsc -b`) then production build to `dist/`
- `npm run preview` — preview the production build

No test runner or linter is configured.

## Architecture

Single-page React + Vite + TypeScript + Tailwind v4 app, hosted on GitHub Pages via `.github/workflows/deploy.yml`. Station data comes from a **Cloudflare Worker** (`worker/` — see `worker/README.md` and `docs/backend-options.md`): a 10-minute cron polls all ecarup stations and caches the aggregate in KV; the app fetches it in one request from `GET /stations`. The worker URL is set via `VITE_API_URL` in `.env` (baked in at build time). When `VITE_API_URL` is empty, the app falls back to calling `https://www.ecarup.com/api/stations?id=<uuid>` directly from the browser (then ecarup's CORS headers are load-bearing).

Data flow:

1. `public/stations.json` — list of `{id, name, group?}` station refs, read by the worker on every refresh (and by the browser in direct mode). **Edited directly on GitHub** to add stations without rebuilding or redeploying anything.
2. `src/hooks/useStations.ts` — API mode: one `fetchAllStations()` call per interval; direct mode: loads `stations.json`, then polls `fetchStation(id)` per ID. Refresh interval (minutes) is persisted in `localStorage` under `parking-app:refreshMin`.
3. `src/api.ts` — `stateToStatus()` maps the API's numeric `State` field: `1 → available`, `2 → occupied`, anything else → `unknown`. Same mapping applies to per-`Connector` state.
4. `src/App.tsx` renders `StationCard`s in a responsive grid; cards display the station's overall status plus per-connector chips when a station has multiple connectors.

The `name` in `stations.json` is a fallback label only — the live `Name` from the API takes precedence once a fetch succeeds.

Vite is configured with `base: './'` so the same build works on GitHub Pages regardless of the repo subpath.
