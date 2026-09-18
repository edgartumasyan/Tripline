# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Tripline — a personal travel-planning journal. React 19 + Vite SPA, installable as a PWA,
deployed as a static site to GitHub Pages. Everything the app shows (countries → cities →
places) lives in one file, `src/data.json`. There is no backend and no database.

The decision everything else follows from: **the app is read-write when served from
localhost and read-only everywhere else.** `isOwner()` (`src/App.jsx`) tests the hostname;
the `/api/data` dev-server middleware in `vite.config.js` is what actually writes
`src/data.json` back to disk. On GitHub Pages that endpoint doesn't exist, so visitors
browse but nothing persists. **Adding a place is therefore a commit, not a database write** —
`npm run dev`, edit in the UI, then commit the resulting `src/data.json` diff.

## Commands

```bash
npm run dev      # Vite dev server + the writable /api/data middleware — the only mode that can save
npm run build    # production build to dist/ (also what CI runs)
npm run preview  # serve dist/ — read-only, mirrors the deployed site
```

The site's base path is `/Tripline/`, so dev and preview live at
`http://localhost:<port>/Tripline/`, not at `/`.

There is **no test suite, no linter and no typechecker** in this repo. Don't invent
`npm test` / `npm run lint` commands — they don't exist. The checks that do exist are
`npm run build` (catches syntax/import errors) and a browser pass (below).

### Verifying a UI change

`playwright` is a devDependency, kept for ad-hoc browser checks rather than a test suite.
Build, serve, drive it, screenshot:

```bash
npm run build && npx vite preview --port 4317 &
# in a scratch .mjs file — a bare `from 'playwright'` will NOT resolve outside the project dir:
#   import { chromium, devices } from '/absolute/path/to/Tripline/node_modules/playwright/index.mjs'
#   await page.goto('http://localhost:4317/Tripline/')
```

Check phone width too (`devices['iPhone 13']`) — several features (the print path, the list
view, the card toolbar) behave differently below 720–860px.

## Architecture

Read `docs/ARCHITECTURE.md` for the detail. The shape in brief:

- **`src/App.jsx` (~1560 lines) is the whole app.** One React class component, no router, no
  state library. It is a port of a standalone design document (`Tripline.dc.html`, not in
  this repo) and keeps that document's conventions on purpose — see below.
- **`renderVals()` → `render()`.** All logic, formatting, and event handlers are assembled
  into one plain view-model object (`V`) by `renderVals()`; `render()` is close to dumb
  markup reading `V.*`. When adding a feature, put the thinking in `renderVals()` or a
  method, and keep `render()` declarative.
- **Styling is inline style *strings*** parsed by `css()` (`'display:flex; gap:8px'`), with
  the `<El>` wrapper supplying hover/focus variants. Every colour is a CSS custom property
  from `src/index.css`, so dark mode is a variable swap — never write a themed colour
  literal. `src/design.css` holds only non-colour chrome (breakpoints, print rules, Leaflet
  pins).
- **Persistence is debounced and file-shaped.** `mutate()` deep-clones state, `persist()`
  PUTs to `/api/data` 400ms later. `goHome()` flushes the pending save, then re-fetches, so
  an external edit to `src/data.json` (a git pull, another tab) shows up without a reload.
- **Lazy/heavy paths:** Leaflet map (`src/components/CityMap.jsx`) is `React.lazy`; jsPDF and
  html2canvas load only on the mobile print path.

## Conventions & gotchas

- **Ids are derived from the name and are load-bearing.** `slug()` + `latinize()`
  (`src/translit.js`) build `id` from the English name. `src/coords.js` (`COORDS`) is keyed
  by landmark id, so **renaming a place changes its id and orphans its map pin**. If you
  rename, update the `COORDS` key too — or give the place its own `coords` in the dialog,
  which takes precedence over the table.
- **`description` is the Armenian original**; `descriptionEn` / `descriptionRu` are optional
  translations that fall back to it (`pickDescription`). Same pattern for entity names:
  `name` is the base, `nameHy` / `nameRu` optional (`pickName`). UI chrome is translated in
  `src/i18n.js`; the travel notes themselves are shown as authored.
- **Dead fields in data.json:** cities carry `notes` and `checklist`, places carry `day` —
  no code reads any of them. Leave them alone; don't build on them assuming they work.
- **Ephemeral vs persisted state.** Only `data` is written to `src/data.json`. `theme`,
  `lang` and nav position go to localStorage (`trips.theme`, `trips.lang`, `trips.nav`).
  Everything else in `state` (route, expanded, lightbox, dialog, viewerOrder, drag) is
  deliberately per-session.
- **Viewers can reorder too**, but only in memory: `viewerOrder` keyed by city id, used so a
  guest can arrange places before printing. `orderedLandmarks()` is the single place that
  resolves owner order vs viewer order — read from it, not from `city.landmarks`, whenever
  display order matters.
- **The comments in `src/App.jsx` explain *why*, often about a browser quirk** (iOS canvas
  limits, PWA update checks, print images going through the wsrv.nl proxy). They earned
  their place — match that density and tone rather than stripping or padding them.

## Workflow

Feature branch (`feature/<short-kebab-description>`) → PR → merge to `main`. Pushing to
`main` triggers `.github/workflows/deploy.yml`, which builds and publishes to GitHub Pages.
Commit subjects are short imperative sentences ("Add Venice with eleven places to Italy",
"Refresh data when returning home via the logo").

## Further reading

- `docs/ARCHITECTURE.md` — how App.jsx is organised, the print/PDF pipeline, drag & drop,
  theming, i18n, the map.
- `docs/DATA.md` — the `src/data.json` schema, id rules, coordinates, and how to add a
  country / city / place.
