Pilatus EV Chargers
===================

Small web app showing live status (available / occupied) of the EV chargers
available to Pilatus Aircraft employees. Data comes from the ecarup.com public
station API; the app calls it directly from the browser, so there is no
backend to run.

Stack
-----
React 19 + Vite + TypeScript + Tailwind v4. Hosted on GitHub Pages via
.github/workflows/deploy.yml (auto-deploys on push to main).

Data source
-----------
GET https://www.ecarup.com/api/stations?id=<uuid>

State mapping used by the UI:
  1 = Available
  2 = Occupied
  other = Unknown

Station list
------------
public/stations.json holds the {id, name} entries the app polls. It is fetched
at runtime, so you can add stations by editing this file on GitHub — no
rebuild needed (the next deploy / page load picks up the change).

To bulk-import station IDs from someone's exported charging history:

  npm run update-stations -- path/to/history.json

The script merges new IDs into public/stations.json (deduped by id, sorted by
name).

Local development
-----------------
  npm install
  npm run dev      # start dev server
  npm run build    # type-check + production build
  npm run preview  # preview the production build

Settings
--------
Refresh interval is selectable in the UI (1/5/10/15/30 min) and persisted in
localStorage under the key "parking-app:refreshMin". Default is 5 minutes.
