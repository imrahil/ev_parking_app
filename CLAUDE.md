# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — type-check (`tsc -b`) then production build to `dist/`
- `npm run preview` — preview the production build
- `npm run update-stations -- <path-to-history.json>` — merge new station IDs from a charging-history file into `public/stations.json` (idempotent, dedupes by `id`)

No test runner or linter is configured.

## Architecture

Single-page React + Vite + TypeScript + Tailwind v4 app. **No backend** — the browser calls `https://www.ecarup.com/api/stations?id=<uuid>` directly. Hosted on GitHub Pages via `.github/workflows/deploy.yml` (Pages cannot proxy, so CORS on ecarup.com is load-bearing — if it ever breaks, fallback is a Cloudflare Worker proxy or moving the host to Vercel/Netlify).

Data flow:

1. `public/stations.json` — runtime-fetched list of `{id, name}` station refs. **Edited directly on GitHub** to add stations without rebuilding; `update-stations.mjs` populates it from a `history.json` export.
2. `src/useStations.ts` — loads `stations.json`, then polls `fetchStation(id)` for each ID on an interval. Refresh interval (minutes) is persisted in `localStorage` under `parking-app:refreshMin`.
3. `src/api.ts` — `stateToStatus()` maps the API's numeric `State` field: `1 → available`, `2 → occupied`, anything else → `unknown`. Same mapping applies to per-`Connector` state.
4. `src/App.tsx` renders `StationCard`s in a responsive grid; cards display the station's overall status plus per-connector chips when a station has multiple connectors.

The `name` in `stations.json` is a fallback label only — the live `Name` from the API takes precedence once a fetch succeeds.

Vite is configured with `base: './'` so the same build works on GitHub Pages regardless of the repo subpath.
