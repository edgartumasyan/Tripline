# Architecture

How Tripline is put together, and why it is put together that way. Written for someone (or
some agent) who has to change it without reading all ~1560 lines of `src/App.jsx` first.

## Module map

| File | Role |
| --- | --- |
| `src/App.jsx` | The entire app: state, logic, view model, markup. One class component. |
| `src/components/CityMap.jsx` | Leaflet satellite map of one city's places. Lazy-loaded. |
| `src/data.json` | All content. ~1.3 MB. See `docs/DATA.md`. |
| `src/storage.js` | `loadData()` / `saveData()` against the dev API, `makeId()`. |
| `src/coords.js` | `COORDS`: landmark id → `[lat, lon]` for the built-in places. |
| `src/i18n.js` | UI copy in en/hy/ru, `labelsFor()`, `pluralize()`. |
| `src/translit.js` | `latinize()` — Armenian/Russian/diacritic folding so ids stay readable. |
| `src/index.css` | The design tokens. Light palette on `:root`, dark on `:root[data-theme='dark']`. |
| `src/design.css` | Non-colour chrome ported from the design doc: breakpoints, print rules, map pins. |
| `src/main.jsx` | Mount + the PWA service-worker update strategy. |
| `vite.config.js` | Build config **and** the dev-only `/api/data` read/write middleware. |

## The design-document port

`App.jsx` began as a port of a standalone HTML design document (`Tripline.dc.html`, not in
this repo), and deliberately keeps its idioms:

- **Inline style strings**, not CSS classes or styled-components:
  `style={css('display:flex; gap:8px; color:var(--ink)')}`. `css()` parses the string into a
  React style object; later declarations win, which is how `<El>` layers hover and focus over
  a base string.
- **`<El>`** is a tiny wrapper reproducing the design runtime's `style-hover` / `style-focus`:
  `<El as="button" base="…" hover="…" focus="…">`. Use it whenever an element needs a hover
  or focus appearance; plain elements otherwise.
- **`data-t="…"` attributes** mark elements the ported CSS in `design.css` targets
  (`[data-t~='hdr']`, `[data-t~='print-sheet']`, …). Don't rename them casually.

## renderVals() → render()

`renderVals()` returns one flat object (`V`) holding every string, style, flag and callback
the markup needs; `render()` reads `V.*` and is close to logic-free. `buildCard()` does the
same job for a single place card and is called once per landmark.

Practical consequence: **new behaviour goes in `renderVals()` or a method, not in JSX.**
A conditional in `render()` should be a flag the view model already computed (`V.lightbox.hasSiblings`,
`V.routeReady`), not an expression over `this.state`.

## State

`this.state` mixes three lifetimes, and the distinction matters:

1. **`data`** — the document. The only thing written to `src/data.json`.
2. **localStorage-backed** — `theme` (`trips.theme`), `lang` (`trips.lang`), and nav position
   (`countryId` / `cityId` / `overviewCountry` / `view`, saved as `trips.nav` in
   `componentDidUpdate`). Restored on mount so a refresh or a PWA update lands you back where
   you were. A restored `list` view downgrades to `grid` below 720px.
3. **Ephemeral** — `route`, `expanded`, `lightbox`, `dialog`, `confirm`, `dragIndex`,
   `viewerOrder`, `printSheet`, `pdfFile`, `copied`, menus and queries. Never persisted,
   deliberately.

### Writes

`mutate(fn)` deep-clones `state.data`, hands the clone to `fn`, and calls `persist()`, which
setStates immediately and PUTs to `/api/data` 400 ms later. The pending copy is kept on the
instance (`this._pendingData`) so `goHome()` can flush it early: `goHome` flushes, awaits the
save, then re-fetches, so an external edit to `src/data.json` — a git pull, another tab, a
hand edit — shows up without a browser reload. A failed refetch keeps the in-memory data.

## Ownership

`isOwner()` returns true only on `localhost` / `127.0.0.1` / `file:`. It gates the add/edit/
delete affordances. This is not security — it is a guard against accidental edits on the
published copy, and it matches the model "I edit locally and publish a static snapshot".
Anything a guest *can* do (reordering for print, picking a route, switching language/theme)
is ephemeral by design.

## Ordering and drag & drop

`orderedLandmarks(city)` is the single source of display order: for an owner that is
`city.landmarks` itself; for a guest it is `viewerOrder[city.id]` — an in-memory arrangement
so they can reorder before printing — with any unknown places appended. **Read display order
from this method, never from `city.landmarks` directly.**

Two drag implementations exist because one cannot cover both inputs:

- **Desktop:** native HTML5 drag events (`onDragStart` / `onDragOver`) on the card.
- **Touch:** a pointer-event drag started from the handle (`startPointerDrag` →
  `pointerDragMove` → `endPointerDrag`), because touch never fires the HTML5 events.
  The card styles switch off `user-select` and `-webkit-touch-callout` so pressing to drag
  doesn't raise the text-selection popover instead.

Both funnel into `reorderLandmark(from, to, …)`, which writes through `mutate()` for an owner
and into `viewerOrder` for a guest.

## Theming

Every colour in the app is `var(--…)`, defined twice in `src/index.css`: light on `:root`,
dark on `:root[data-theme='dark']`. `applyTheme()` stamps `data-theme` on `<html>` from
`mode()`, which resolves the stored preference or falls back to `prefers-color-scheme`.
So **dark mode is a token swap and requires no per-component work** — a new element just has
to use the tokens. The two deliberate exceptions, both correct: the buttons that sit on a
card photo keep light-palette colours (they'd vanish into the image otherwise), and the print
sheet is always light because it previews a printed page.

## Internationalisation

Three languages (`en`, `hy`, `ru`). `labelsFor(lang)` supplies UI chrome from `src/i18n.js`;
`pluralize(lang, n, key)` handles the Russian/Armenian plural rules via `pl()`.

Content is different from chrome: entities carry optional `nameHy` / `nameRu` alongside the
base `name` (`pickName`), and places carry `descriptionEn` / `descriptionRu` alongside the
Armenian `description` (`pickDescription`). Both fall back to the base when a translation is
missing. Search matches **any** language variant (`allNames` + `matchesQuery`), not just the
selected one.

## Map

`CityMap.jsx` is `React.lazy` because Leaflet plus its CSS is ~150 KB the country grid never
needs. Basemap is Esri World Imagery (satellite, no API key; note the tile order is
`{z}/{y}/{x}`). Pins are numbered by itinerary position and coloured with the page's own CSS
variables, so they follow the theme. A place is pinned only if it has coordinates —
`lm.coords` (typed into the dialog) wins over the `COORDS` table; places with neither are
left off and the caption reports how many.

Coordinates are entered as Google's DMS string (`39°28'12.0"N 0°22'12.0"W`) and parsed by
`parseDMS()`.

## Route / directions

Up to `MAX_ROUTE` (10) places with coordinates can be picked; selection order is route order,
and `directionsUrl()` builds a Google Maps directions link. Ten is Google's own cap on a
single route, so the UI hard-caps rather than silently dropping stops. The route is
ephemeral and clears when you leave the city.

## Print / PDF

The most intricate part of the app, and it splits by platform in `printCity()`:

- **Desktop (`printViaFrame`)** renders the guide HTML into an off-screen iframe and prints it.
- **Mobile (`printViaSheet`)** shows the guide as a full-screen in-app overlay and builds a
  PDF with html2canvas + jsPDF. Reasons, all learned the hard way: iOS ignores printing an
  off-screen iframe; the old new-tab approach stranded users in the installed PWA (no tab
  bar, no back button) when they cancelled; and iOS's own printer names the file after the
  browser and kills the Google Maps links. The PDF is captured **one block at a time** (header,
  then each place row) so no block straddles a page and no single canvas exceeds iOS Safari's
  limit. Building is backgrounded and the Share button is a *fresh* tap, because user
  activation expires long before a 36-place PDF finishes.

Photos in the print/PDF path go through the `wsrv.nl` proxy (`printImageSrc`) — it shrinks
them (a 27-place city was ~50 MB otherwise) and, crucially, serves CORS headers a canvas can
read. Every proxied `<img>` keeps the original URL in `data-fallback`, and `awaitSheetImages()`
retries with it when the proxy misses, so an outage costs file size, never the photo.

## PWA updates

`main.jsx` registers the service worker with `registerType: 'autoUpdate'`, then asks for an
update check on `visibilitychange` and hourly. An installed PWA almost never *navigates*, so
without that it would keep serving the bundle it booted from until force-killed. The reload
an update triggers is cheap because nav position is restored from `trips.nav`.

`src/data.json` is imported `?url` (not as a module) so Vite emits it as its own hashed asset:
it stays out of the JS bundle, gets precached by the service worker for offline use, and
editing content no longer invalidates the app's JavaScript. `vite.config.js` also tells the
dev server to ignore `src/data.json` in its watcher — otherwise every save would trigger an
HMR reload and bounce the user back to the home screen.
