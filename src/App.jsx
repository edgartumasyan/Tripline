import React from 'react'
import { COORDS } from './coords.js'
import { EN, HY, RU, LANG_ORDER, LANG_LABEL, LANG_FLAG, LANG_NAME, COUNTRY_NAMES, CITY_NAMES, labelsFor, pluralize } from './i18n.js'
import { loadData, saveData } from './storage.js'
import CityMap from './components/CityMap.jsx'
import './design.css'

// Port of the Tripline.dc.html design component. The markup below mirrors the
// design's <x-dc> template one-to-one; inline style strings are kept as authored
// and turned into React style objects by css(), and per-element style-hover /
// style-focus becomes the <El> wrapper. Every color is a CSS custom property
// (var(--…)) defined in index.css, so dark mode is a variable swap — there are
// no per-role remapping rules. View-model values come from renderVals(), a
// direct port of the design's DCLogic class. The map slot delegates to the
// app's own enhanced CityMap; data is loaded/saved through storage.js.

const LANGS = { en: EN, hy: HY, ru: RU }

// Google Maps directions accept at most 10 points on a single route, so the
// selection is hard-capped here instead of silently dropping extras.
const MAX_ROUTE = 10

// Parse a design inline-style string ("a:1; b:2") into a React style object.
// Later declarations win, which is how <El> layers hover/focus over the base.
function css(str) {
  const out = {}
  ;(str || '').split(';').forEach((decl) => {
    const i = decl.indexOf(':')
    if (i < 0) return
    const key = decl.slice(0, i).trim()
    if (!key) return
    const prop = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    out[prop] = decl.slice(i + 1).trim()
  })
  return out
}

// Reproduces the design runtime's style-hover / style-focus: the extra style
// strings are appended to the base while the element is hovered / focused.
class El extends React.Component {
  state = { hovered: false, focused: false }
  render() {
    const { as = 'div', base = '', hover, focus, children, ...rest } = this.props
    let s = base
    if (hover && this.state.hovered) s += ';' + hover
    if (focus && this.state.focused) s += ';' + focus
    const props = { ...rest, style: css(s) }
    if (hover) {
      props.onMouseEnter = (e) => { this.setState({ hovered: true }); rest.onMouseEnter?.(e) }
      props.onMouseLeave = (e) => { this.setState({ hovered: false }); rest.onMouseLeave?.(e) }
    }
    if (focus) {
      props.onFocus = (e) => { this.setState({ focused: true }); rest.onFocus?.(e) }
      props.onBlur = (e) => { this.setState({ focused: false }); rest.onBlur?.(e) }
    }
    return React.createElement(as, props, children)
  }
}

export default class App extends React.Component {
  state = {
    data: null,
    lang: 'en',
    theme: 'auto',
    countryId: null, cityId: null, openCountry: null,
    view: 'grid',
    // Mobile nav drawer (retained but unused now the sidebar is gone) and the
    // overview's selected country (null = show the country grid, else drill
    // into that country's cities). Both are ephemeral UI state, never persisted.
    drawerOpen: false, overviewCountry: null, langMenuOpen: false,
    // Overview search boxes: filter the country grid and the selected country's
    // city grid by (localized) name. Ephemeral, reset when leaving the overview.
    countryQuery: '', cityQuery: '',
    // Whether the drilled-in country header's ⋮ menu is open, encoded as
    // 'country:<id>' (null = none). A click-away backdrop closes it. Ephemeral.
    cardMenuOpen: null,
    dialog: null, confirm: null, lightbox: null, dragIndex: null,
    // Viewer-only reorder for Print/PDF, keyed by cityId — never persisted, resets on refresh.
    viewerOrder: {},
    // Ordered list of landmark ids the user has picked for a Google Maps
    // directions link. Selection order = route order. Ephemeral: cleared when
    // navigating to another city, never persisted.
    route: [],
  }

  componentDidMount() {
    const savedTheme = localStorage.getItem('trips.theme')
    if (savedTheme) this.setState({ theme: savedTheme })
    const savedLang = localStorage.getItem('trips.lang')
    if (savedLang && LANGS[savedLang]) this.setState({ lang: savedLang })
    // Restore where the user last was (country / city / overview / view) so a
    // refresh or shared link lands back on the same screen. Ephemeral, in
    // localStorage only — never part of the saved document. List view needs
    // more width than a phone has, so a restored 'list' downgrades to 'grid'
    // below the same breakpoint the CSS hides the List toggle at.
    try {
      const savedNav = JSON.parse(localStorage.getItem('trips.nav') || 'null')
      if (savedNav) {
        if (savedNav.view === 'list' && window.innerWidth <= 720) savedNav.view = 'grid'
        this.setState(savedNav)
      }
    } catch (e) {}
    window.addEventListener('resize', this.handleResize = () => {
      if (this.state.view === 'list' && window.innerWidth <= 720) this.setState({ view: 'grid' })
    })
    loadData().then((d) => this.setState({ data: d }))
    this.applyTheme()
  }

  componentWillUnmount() {
    if (this.handleResize) window.removeEventListener('resize', this.handleResize)
  }

  componentDidUpdate(prevProps) {
    this.applyTheme()
    // Persist navigation position whenever it changes (compared against a cached
    // signature so unrelated re-renders don't rewrite localStorage).
    const nav = { countryId: this.state.countryId, cityId: this.state.cityId, overviewCountry: this.state.overviewCountry, view: this.state.view }
    const navStr = JSON.stringify(nav)
    if (this._lastNavStr !== navStr) {
      this._lastNavStr = navStr
      try { localStorage.setItem('trips.nav', navStr) } catch (e) {}
    }
  }

  applyTheme() { document.documentElement.setAttribute('data-theme', this.mode()) }

  mode() {
    if (this.state.theme === 'dark') return 'dark'
    if (this.state.theme === 'light') return 'light'
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  // "3 places" / "3 места" — delegates to the shared plural rules.
  pl = (n, key) => pluralize(this.state.lang, n, key)

  persist(data) {
    this.setState({ data })
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => saveData(data), 400)
  }

  L() { return labelsFor(this.state.lang) }

  // Country/city display name in the current language: a curated override
  // (COUNTRY_NAMES / CITY_NAMES, keyed by id) wins for non-English, else the
  // name as authored in data.json.
  pickCountryName(c) {
    const t = COUNTRY_NAMES[c.id]
    if (t && this.state.lang !== 'en' && t[this.state.lang]) return t[this.state.lang]
    return c.name
  }

  pickCityName(ci) {
    const t = CITY_NAMES[ci.id]
    if (t && this.state.lang !== 'en' && t[this.state.lang]) return t[this.state.lang]
    return ci.name
  }

  // All name variants (English base + every localized override) so search can
  // match a query against any language, not just the one currently selected.
  countryNames(c) {
    const t = COUNTRY_NAMES[c.id] || {}
    return [c.name, ...LANG_ORDER.map((lang) => t[lang])].filter(Boolean)
  }

  cityNames(ci) {
    const t = CITY_NAMES[ci.id] || {}
    return [ci.name, ...LANG_ORDER.map((lang) => t[lang])].filter(Boolean)
  }

  // True when the query matches any language variant of the given names.
  matchesQuery(names, query) {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return names.some((n) => n.toLowerCase().indexOf(q) > -1)
  }

  // English/Russian descriptions are optional translations; fall back to the
  // original Armenian text when a translation is absent.
  pickDescription(lm) {
    if (this.state.lang === 'en' && lm.descriptionEn) return lm.descriptionEn
    if (this.state.lang === 'ru' && lm.descriptionRu) return lm.descriptionRu
    return lm.description || ''
  }

  // Edit access is derived from where the page is served, not a client button —
  // anyone can click a UI toggle, so real gating needs a signal outside the page.
  // Locally-run (localhost / 127.0.0.1 / file:) = owner; anywhere else (e.g. the
  // GitHub Pages deployment) = view-only. Not server-enforced security — it just
  // stops accidental edits by guests and matches "I run it locally to edit, I
  // publish a static copy for others to view."
  isOwner() {
    const h = window.location.hostname
    return h === 'localhost' || h === '127.0.0.1' || window.location.protocol === 'file:'
  }

  city() {
    const c = (this.state.data ? this.state.data.countries : []).find((x) => x.id === this.state.countryId)
    if (!c) return null
    const ci = c.cities.find((x) => x.id === this.state.cityId)
    return ci ? { country: c, city: ci } : null
  }

  mutate(fn) {
    const d = JSON.parse(JSON.stringify(this.state.data))
    fn(d)
    this.persist(d)
  }

  slug(name, list) {
    let base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
    let id = base, n = 2
    while (list.some((x) => x.id === id)) { id = base + '-' + n; n++ }
    return id
  }

  // Parses Google's DMS coordinate format, e.g. 39°28'12.0"N 0°22'12.0"W, into [lat, lon].
  parseDMS(str) {
    const re = /(\d+)[°\s]+(\d+)['\s]+([\d.]+)"?\s*([NSns])[,\s]+(\d+)[°\s]+(\d+)['\s]+([\d.]+)"?\s*([EWew])/
    const m = String(str || '').trim().match(re)
    if (!m) return null
    const toDec = (d, mi, s, dir) => {
      let v = Number(d) + Number(mi) / 60 + Number(s) / 3600
      if (/[SWsw]/.test(dir)) v = -v
      return v
    }
    return [toDec(m[1], m[2], m[3], m[4]), toDec(m[5], m[6], m[7], m[8])]
  }

  buildCard(lm, index, listMode, orderedIds, cityId) {
    const visited = !!lm.visited, isOwner = this.isOwner(), L = this.L()
    const point = lm.coords || COORDS[lm.id]
    return {
      id: lm.id, name: lm.name, image: lm.image || '', description: this.pickDescription(lm),
      index: String(index + 1).padStart(2, '0'),
      // -webkit-touch-callout/user-select off so pressing a card to drag it on
      // a phone doesn't trigger the text-selection / copy popover instead.
      cardStyle: 'display:flex; flex-direction:' + (listMode ? 'row' : 'column') +
        '; border:1px solid ' + (visited ? 'var(--seen-edge)' : 'var(--border-soft)') +
        '; border-radius:16px; overflow:hidden; background:' + (visited ? 'var(--seen-bg)' : 'var(--card)') +
        '; opacity:' + (this.state.dragIndex === index ? '0.45' : '1') +
        '; transition:box-shadow .18s ease; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none',
      mediaStyle: 'position:relative; overflow:hidden; flex:0 0 ' + (listMode ? '210px' : '190px') + '; background:var(--image-bg); ' +
        (listMode ? 'align-self:stretch; min-height:150px' : 'width:100%; min-height:0'),
      bodyStyle: 'display:flex; flex-direction:column; gap:8px; padding:' + (listMode ? '16px 20px' : '14px 16px 16px') + '; flex:1 1 auto; min-width:0',
      // A "View on Google Maps" deep link, shown only for places we have coordinates
      // for. Per-place coords entered in the dialog (lm.coords) win over the built-in
      // COORDS table keyed by landmark id. Useful to owners and view-only guests alike.
      hasMapLink: !!point,
      mapUrl: point ? ('https://www.google.com/maps/search/?api=1&query=' + point[0] + ',' + point[1]) : '',
      // Route selection: only places with coordinates can be added. Once the
      // route is full, unpicked places are disabled. routeText shows "✓ n" (the
      // 1-based position == selection order) once picked, else "＋ Route".
      routeFull: !this.state.route.includes(lm.id) && this.state.route.length >= MAX_ROUTE,
      routeText: this.state.route.includes(lm.id) ? ('✓ ' + (this.state.route.indexOf(lm.id) + 1)) : ('＋ ' + L.route),
      routeTitle: this.state.route.includes(lm.id) ? '' : (this.state.route.length >= MAX_ROUTE ? L.routeCapped : L.routeHint),
      routeStyle: 'display:inline-flex; align-items:center; gap:5px; font-size:11.5px; white-space:nowrap; flex:0 0 auto; border-radius:999px; padding:5px 11px; transition:background .12s ease, color .12s ease; ' +
        (this.state.route.includes(lm.id)
          ? 'cursor:pointer; border:1px solid var(--teal); background:var(--teal); color:var(--chip-on-ink)'
          : this.state.route.length >= MAX_ROUTE
            ? 'cursor:not-allowed; border:1px solid var(--chip-off-edge); background:var(--chip-off-bg); color:var(--ink-fainter); opacity:0.6'
            : 'cursor:pointer; border:1px solid var(--chip-off-edge); background:var(--chip-off-bg); color:var(--chip-off-ink)'),
      onToggleRoute: () => this.toggleRoute(lm.id),
      onPreview: () => lm.image && this.setState({ lightbox: { src: lm.image, alt: lm.name } }),
      onEdit: () => this.setState({ dialog: { kind: 'edit-landmark', id: lm.id, title: lm.name, name: lm.name, image: lm.image || '', description: lm.description || '', descriptionEn: lm.descriptionEn || '', descriptionRu: lm.descriptionRu || '', coordsText: lm.coordsText || '' } }),
      onDelete: () => this.askDelete(lm.name, () => this.mutate((d) => {
        const ci = this.findCity(d); ci.landmarks = ci.landmarks.filter((x) => x.id !== lm.id)
      })),
      onToggleVisited: () => this.mutate((d) => {
        const t = this.findCity(d).landmarks.find((x) => x.id === lm.id); t.visited = !t.visited
      }),
      dragTitle: isOwner ? L.drag : L.viewerOrderHint,
      // Position in the currently-displayed order — used by both the native
      // (mouse) drag and the pointer-based (touch) drag to resolve targets.
      pos: index,
      // Native HTML5 drag-and-drop — desktop mouse only; touch never fires these.
      onDragStart: () => this.setState({ dragIndex: index }),
      onDragOver: (e) => {
        e.preventDefault()
        const from = this.state.dragIndex
        if (from === null || from === index) return
        this.reorderLandmark(from, index, orderedIds, cityId, isOwner)
        this.setState({ dragIndex: index })
      },
      onDragEnd: () => this.setState({ dragIndex: null }),
      // Pointer-based drag from the ⠿ handle — this is what makes reordering
      // work on touchscreens, where native drag-and-drop does nothing.
      onHandleDown: (e) => this.startPointerDrag(index, orderedIds, cityId, isOwner, e),
    }
  }

  // Move a landmark from one display position to another. Owners reorder the
  // persisted document; viewers reorder only their own in-memory copy (for
  // Print/PDF), which is never persisted and resets on refresh.
  reorderLandmark(from, to, orderedIds, cityId, isOwner) {
    if (isOwner) {
      this.mutate((d) => {
        const ci = this.findCity(d)
        const [moved] = ci.landmarks.splice(from, 1)
        ci.landmarks.splice(to, 0, moved)
      })
    } else {
      const ids = orderedIds.slice()
      const [moved] = ids.splice(from, 1)
      ids.splice(to, 0, moved)
      this.setState({ viewerOrder: { ...this.state.viewerOrder, [cityId]: ids } })
    }
  }

  // Touch/pen reordering via Pointer Events. Started from the drag handle
  // (which sets touch-action:none so the press doesn't scroll the list). We
  // track the moving item in an instance field to avoid setState races, follow
  // the finger with elementFromPoint over the cards' data-lm-idx markers, and
  // ignore mouse pointers so desktop keeps using native drag-and-drop.
  startPointerDrag(index, orderedIds, cityId, isOwner, e) {
    if (e.pointerType === 'mouse') return
    e.preventDefault()
    this._drag = { from: index, cityId, isOwner, ids: orderedIds.slice() }
    this.setState({ dragIndex: index })
    this._onPtrMove = (ev) => this.pointerDragMove(ev)
    this._onPtrUp = () => this.endPointerDrag()
    window.addEventListener('pointermove', this._onPtrMove, { passive: false })
    window.addEventListener('pointerup', this._onPtrUp)
    window.addEventListener('pointercancel', this._onPtrUp)
  }

  pointerDragMove(e) {
    const d = this._drag
    if (!d) return
    e.preventDefault()
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const card = el && el.closest('[data-lm-idx]')
    if (!card) return
    const to = Number(card.getAttribute('data-lm-idx'))
    if (Number.isNaN(to) || to === d.from) return
    this.reorderLandmark(d.from, to, d.ids, d.cityId, d.isOwner)
    // The viewer path reorders our local id list; keep it in step so successive
    // moves within one drag resolve against the up-to-date order.
    if (!d.isOwner) {
      const [moved] = d.ids.splice(d.from, 1)
      d.ids.splice(to, 0, moved)
    }
    d.from = to
    this.setState({ dragIndex: to })
  }

  endPointerDrag() {
    this._drag = null
    this.setState({ dragIndex: null })
    window.removeEventListener('pointermove', this._onPtrMove)
    window.removeEventListener('pointerup', this._onPtrUp)
    window.removeEventListener('pointercancel', this._onPtrUp)
  }

  findCity(d) {
    return d.countries.find((c) => c.id === this.state.countryId).cities.find((c) => c.id === this.state.cityId)
  }

  // Viewers reorder their own copy for Print/PDF only; it never touches the
  // persisted document order. Owners always see the document order as-is.
  orderedLandmarks(city) {
    if (this.isOwner()) return city.landmarks
    const order = this.state.viewerOrder[city.id]
    if (!order) return city.landmarks
    const byId = new Map(city.landmarks.map((lm) => [lm.id, lm]))
    const out = order.map((id) => byId.get(id)).filter(Boolean)
    city.landmarks.forEach((lm) => { if (!order.includes(lm.id)) out.push(lm) })
    return out
  }

  // The coordinate for a landmark, if any: per-place coords entered in the
  // dialog win over the built-in COORDS table keyed by landmark id.
  pointFor(lm) { return (lm && (lm.coords || COORDS[lm.id])) || null }

  // Toggle a landmark in/out of the directions route. Appending on select is
  // what makes selection order == route order. Adding is ignored once the
  // route is full (Google Maps allows at most MAX_ROUTE points).
  toggleRoute(id) {
    const route = this.state.route.slice()
    const i = route.indexOf(id)
    if (i > -1) route.splice(i, 1)
    else if (route.length >= MAX_ROUTE) return
    else route.push(id)
    this.setState({ route })
  }

  // The selected landmarks, in route order, restricted to this city and to
  // places that actually have coordinates (others can't be placed on a route).
  routePoints(city) {
    if (!city) return []
    const byId = new Map(city.landmarks.map((l) => [l.id, l]))
    return this.state.route.map((id) => byId.get(id)).filter((lm) => this.pointFor(lm))
  }

  // Build a Google Maps directions deep link that follows the selected order:
  // an origin, a destination and the middle points as waypoints. Selection is
  // already capped at MAX_ROUTE, so this stays within Google's route limit.
  directionsUrl(city) {
    const pts = this.routePoints(city).map((lm) => this.pointFor(lm)).slice(0, MAX_ROUTE)
    if (pts.length < 2) return ''
    const enc = (p) => p[0] + ',' + p[1]
    const origin = enc(pts[0])
    const destination = enc(pts[pts.length - 1])
    const waypoints = pts.slice(1, -1).map(enc).join('|')
    let url = 'https://www.google.com/maps/dir/?api=1&travelmode=walking' +
      '&origin=' + encodeURIComponent(origin) + '&destination=' + encodeURIComponent(destination)
    if (waypoints) url += '&waypoints=' + encodeURIComponent(waypoints)
    return url
  }

  openDirections() {
    const sel = this.city()
    const url = sel ? this.directionsUrl(sel.city) : ''
    if (url) window.open(url, '_blank', 'noopener')
  }

  askDelete(name, run) {
    this.setState({ confirm: { message: this.L().deleteQ + ' “' + name + '”?', run } })
  }

  submit() {
    const d0 = this.state.dialog
    if (!d0 || !d0.name || !d0.name.trim()) return
    const name = d0.name.trim(), image = (d0.image || '').trim(), description = (d0.description || '').trim()
    const descriptionEn = (d0.descriptionEn || '').trim(), descriptionRu = (d0.descriptionRu || '').trim()
    // Optional per-place coordinates, pasted from Google Maps in DMS form. When present
    // but unparseable, flag the field and keep the dialog open instead of saving.
    const coordsText = (d0.coordsText || '').trim()
    const coords = coordsText ? this.parseDMS(coordsText) : null
    if (coordsText && !coords) { this.setState({ dialog: { ...d0, coordsError: true } }); return }
    if (d0.kind === 'country') {
      this.mutate((d) => { d.countries.push({ id: this.slug(name, d.countries), name, flag: image, cities: [] }) })
    } else if (d0.kind === 'edit-country') {
      this.mutate((d) => { const c = d.countries.find((x) => x.id === d0.id); c.name = name; c.flag = image })
    } else if (d0.kind === 'city') {
      this.mutate((d) => { const c = d.countries.find((x) => x.id === d0.countryId)
        c.cities.push({ id: this.slug(name, c.cities), name, image, landmarks: [] }) })
    } else if (d0.kind === 'edit-city') {
      this.mutate((d) => { const c = d.countries.find((x) => x.id === d0.countryId)
        const ci = c.cities.find((x) => x.id === d0.id); ci.name = name; ci.image = image })
    } else if (d0.kind === 'landmark') {
      this.mutate((d) => { const ci = this.findCity(d)
        ci.landmarks.push({ id: this.slug(name, ci.landmarks), name, image, description, descriptionEn, descriptionRu, coords, coordsText, day: null, visited: false }) })
    } else if (d0.kind === 'edit-landmark') {
      this.mutate((d) => { const t = this.findCity(d).landmarks.find((x) => x.id === d0.id)
        t.name = name; t.image = image; t.description = description; t.descriptionEn = descriptionEn; t.descriptionRu = descriptionRu; t.coords = coords; t.coordsText = coordsText })
    }
    this.setState({ dialog: null })
  }

  setTheme(v) {
    this.setState({ theme: v })
    try { localStorage.setItem('trips.theme', v) } catch (e) {}
  }

  // Builds a standalone, static, read-only HTML snapshot of the current city —
  // no data source, no edit controls — and downloads it as a file to share.
  shareCity() {
    const sel = this.city()
    if (!sel) return
    const l = this.L(), esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const rows = sel.city.landmarks.map((lm, i) => {
      // Same "View on Google Maps" deep link the live app shows — per-place
      // coords win over the built-in COORDS table, and places we can't locate
      // simply get no link.
      const pt = lm.coords || COORDS[lm.id]
      const mapUrl = pt ? 'https://www.google.com/maps/search/?api=1&query=' + pt[0] + ',' + pt[1] : ''
      return `
      <article style="display:flex;gap:16px;border:1px solid #E4EBDD;border-radius:16px;overflow:hidden;background:#FFFFFF;margin-bottom:18px">
        ${lm.image ? `<img src="${esc(lm.image)}" alt="" style="width:220px;height:160px;object-fit:cover;flex:0 0 auto"/>` : ''}
        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:6px;min-width:0">
          <div style="display:flex;align-items:baseline;gap:10px">
            <h3 style="margin:0;font-family:'Work Sans',sans-serif;font-weight:600;font-size:19px;color:#1B1D18">${esc(lm.name)}</h3>
            <span style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9C9488">${String(i + 1).padStart(2, '0')}</span>
          </div>
          <p style="margin:0;font-size:13.5px;line-height:1.6;color:#7C8474">${esc(this.pickDescription(lm))}</p>
          ${mapUrl ? `<a href="${mapUrl}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:#5FA05F;text-decoration:none;white-space:nowrap;margin-top:2px">📍 ${esc(l.viewOnMap)}</a>` : ''}
        </div>
      </article>`
    }).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(sel.city.name)}</title>
      <style>body{margin:0;background:#F5F6F4;color:#1B1D18;font-family:'Work Sans',system-ui,sans-serif}
      .wrap{max-width:760px;margin:0 auto;padding:40px 24px 80px}</style></head><body>
      <div class="wrap">
        <p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8C9384;margin:0 0 6px">${esc(sel.country.name)} · ${esc(l.share)}</p>
        <h1 style="font-family:'Work Sans',sans-serif;font-weight:600;font-size:38px;margin:0 0 22px">${esc(sel.city.name)}</h1>
        ${rows}
      </div></body></html>`
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = sel.city.id + '-view-only.html'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  renderVals() {
    const s = this.state, L = this.L(), l = L, mode = this.mode()
    const PILL_ON = 'border:none; border-radius:999px; padding:7px 15px; font-size:12.5px; font-weight:500; cursor:pointer; background:var(--pill-on-bg); color:var(--pill-on-ink)'
    const PILL_OFF = 'border:none; border-radius:999px; padding:7px 15px; font-size:12.5px; cursor:pointer; background:none; color:var(--pill-off-ink)'

    const countries = s.data ? s.data.countries : []
    const sel = this.city()
    const isOwner = this.isOwner()

    const stats = (ci) => {
      const total = ci.landmarks.length
      const seen = ci.landmarks.filter((x) => x.visited).length
      return { total, seen, pct: total ? Math.round((seen / total) * 100) + '%' : '0%' }
    }

    const tree = countries.map((c) => ({
      id: c.id, name: c.name, flag: c.flag || '',
      count: this.pl(c.cities.length, 'cities'),
      open: s.openCountry === c.id,
      rowBg: s.openCountry === c.id ? 'var(--row-open)' : 'transparent',
      onClick: () => this.setState({ openCountry: s.openCountry === c.id ? null : c.id }),
      onEdit: () => this.setState({ dialog: { kind: 'edit-country', id: c.id, title: c.name, name: c.name, image: c.flag || '' } }),
      onDelete: () => this.askDelete(c.name, () => this.mutate((d) => { d.countries = d.countries.filter((x) => x.id !== c.id) })),
      onAddCity: () => this.setState({ dialog: { kind: 'city', countryId: c.id, title: l.addCity, name: '', image: '' } }),
      cities: c.cities.map((ci) => {
        const st = stats(ci)
        return {
          id: ci.id, name: ci.name, image: ci.image || '',
          meta: this.pl(st.total, 'places'),
          ink: s.cityId === ci.id ? 'var(--accent)' : 'var(--ink)',
          rowBg: s.cityId === ci.id ? 'var(--accent-tint)' : 'transparent',
          onClick: () => this.setState({ countryId: c.id, cityId: ci.id, view: 'grid', route: [], drawerOpen: false }),
          onEdit: () => this.setState({ dialog: { kind: 'edit-city', id: ci.id, countryId: c.id, title: ci.name, name: ci.name, image: ci.image || '' } }),
          onDelete: () => this.askDelete(ci.name, () => this.mutate((d) => {
            const cc = d.countries.find((x) => x.id === c.id); cc.cities = cc.cities.filter((x) => x.id !== ci.id)
          })),
        }
      }),
    }))

    const chapters = countries.map((c) => ({
      id: c.id, name: this.pickCountryName(c), searchNames: this.countryNames(c), flag: c.flag || '',
      meta: this.pl(c.cities.length, 'cities') + ' · ' + this.pl(c.cities.reduce((n, ci) => n + ci.landmarks.length, 0), 'places'),
      // Overview drill-down: the grid of country cards picks one (onSelect,
      // which also resets the city filter), then only that country's chapter
      // (isSelected) renders its cities — those filtered by the city search box.
      isSelected: s.overviewCountry === c.id,
      onSelect: () => this.setState({ overviewCountry: c.id, cityQuery: '' }),
      // Country card / country-header ⋮ menu (keyed 'country:<id>'). Editing or
      // deleting from it closes the menu as it opens the dialog / confirm.
      menuOpen: s.cardMenuOpen === 'country:' + c.id,
      onToggleMenu: () => this.setState({ cardMenuOpen: s.cardMenuOpen === 'country:' + c.id ? null : 'country:' + c.id }),
      onEdit: () => this.setState({ dialog: { kind: 'edit-country', id: c.id, title: c.name, name: c.name, image: c.flag || '' }, cardMenuOpen: null }),
      onDelete: () => { this.setState({ cardMenuOpen: null }); this.askDelete(c.name, () => this.mutate((d) => { d.countries = d.countries.filter((x) => x.id !== c.id) })) },
      onAddCity: () => this.setState({ dialog: { kind: 'city', countryId: c.id, title: l.addCity, name: '', image: '' } }),
      cities: c.cities
        .filter((ci) => this.matchesQuery(this.cityNames(ci), s.cityQuery))
        .map((ci) => {
          const st = stats(ci)
          return {
            id: ci.id, name: this.pickCityName(ci), image: ci.image || '',
            count: this.pl(st.total, 'places'),
            progress: st.pct,
            onClick: () => this.setState({ countryId: c.id, cityId: ci.id, openCountry: c.id, view: 'grid', route: [] }),
            onEdit: () => this.setState({ dialog: { kind: 'edit-city', id: ci.id, countryId: c.id, title: ci.name, name: ci.name, image: ci.image || '' } }),
            onDelete: () => this.askDelete(ci.name, () => this.mutate((d) => {
              const cc = d.countries.find((x) => x.id === c.id); cc.cities = cc.cities.filter((x) => x.id !== ci.id)
            })),
          }
        }),
    }))
    // The country grid is filtered by the country search box, matched against
    // every language variant of the name (so "sp" finds Spain even in Armenian).
    const chaptersFiltered = chapters.filter((ch) => this.matchesQuery(ch.searchNames, s.countryQuery))

    // Cards render as one flat grid/column (design flattened the old per-day
    // grouping); groupDisplay/groupGap switch between the Cards and List views.
    let landmarks = [], cityVals = null, groupDisplay = 'grid', groupGap = '22px'
    let selectedCountry = { flag: '', name: '', meta: '', onAddCity: () => {}, cities: [], menuOpen: false, onToggleMenu: () => {}, onEdit: () => {}, onDelete: () => {} }
    if (s.overviewCountry) {
      const ch0 = chapters.find((c) => c.isSelected)
      if (ch0) selectedCountry = ch0
    }
    if (sel) {
      const st = stats(sel.city)
      cityVals = {
        name: this.pickCityName(sel.city), image: sel.city.image || '',
        crumb: '← ' + this.pickCountryName(sel.country),
        meta: this.pl(st.total, 'places') + ' · ' + st.seen + ' ' + l.visited,
      }
      const orderedList = this.orderedLandmarks(sel.city)
      const orderedIds = orderedList.map((lm) => lm.id)
      const listMode = s.view === 'list'
      groupDisplay = listMode ? 'flex' : 'grid'
      groupGap = listMode ? '12px' : '22px'
      landmarks = orderedList.map((lm, i) => this.buildCard(lm, i, listMode, orderedIds, sel.city.id))
    }

    const mapped = sel ? sel.city.landmarks.filter((lm) => lm.coords || COORDS[lm.id]).length : 0
    const missing = sel ? sel.city.landmarks.length - mapped : 0
    const routeCount = sel ? this.routePoints(sel.city).length : 0
    const routeReady = routeCount >= 2

    return {
      L, tree, chapters: chaptersFiltered, theme: mode,
      countryQuery: s.countryQuery, onCountryQuery: (e) => this.setState({ countryQuery: e.target.value }),
      cityQuery: s.cityQuery, onCityQuery: (e) => this.setState({ cityQuery: e.target.value }),
      noCountryMatch: chaptersFiltered.length === 0 && s.countryQuery.trim().length > 0,
      // Overview ⋮ menus: which is open, and a click-away backdrop to close it.
      cardMenuOpen: s.cardMenuOpen, closeCardMenu: () => this.setState({ cardMenuOpen: null }),
      themeIcon: mode === 'dark' ? '☾' : '☀',
      toggleTheme: () => this.setTheme(mode === 'dark' ? 'light' : 'dark'),
      showSidebar: true,
      // Mobile drawer: at ≤860px the sidebar becomes an off-canvas panel toggled
      // by the header hamburger; 'drawer-open' slides it in and shows the backdrop.
      drawerOpenClass: s.drawerOpen ? 'drawer-open' : '',
      showDrawerBackdrop: true,
      toggleDrawer: () => this.setState({ drawerOpen: !s.drawerOpen }),
      closeDrawer: () => this.setState({ drawerOpen: false }),
      showOverview: !sel,
      // Overview is two-level: a grid of country cards, then one country's cities.
      hasOverviewCountry: !!s.overviewCountry,
      showCountryGrid: !s.overviewCountry,
      selectedCountry,
      clearOverviewCountry: () => this.setState({ overviewCountry: null, cityQuery: '' }),
      showCity: !!sel, isOwner,
      city: cityVals || { name: '', image: '', crumb: '', meta: '' },
      mapCity: sel ? sel.city : null,
      landmarks, cityEmpty: !!sel && landmarks.length === 0,
      isMap: !!sel && s.view === 'map', isCards: !!sel && s.view !== 'map',
      viewGridStyle: s.view === 'grid' ? PILL_ON : PILL_OFF,
      viewListStyle: s.view === 'list' ? PILL_ON : PILL_OFF,
      viewMapStyle: s.view === 'map' ? PILL_ON : PILL_OFF,
      groupDisplay, groupGap,
      mapNote: missing ? (this.pl(mapped, 'places') + ' ' + l.pinnedSuffix + ' · ' + missing + ' ' + l.needCoords) : l.allPinned,
      overviewSummary: countries.length
        ? countries.map((c) => this.pickCountryName(c)).join(' · ') + ' — ' +
          this.pl(countries.reduce((n, c) => n + c.cities.reduce((m, ci) => m + ci.landmarks.length, 0), 0), 'places')
        : '',
      // Language picker: the button shows the flag + compact code; clicking it
      // opens a menu of the three languages (flag + endonym), the current one
      // highlighted. Picking one sets the language and closes the menu.
      langLabel: LANG_LABEL[s.lang], langFlag: LANG_FLAG[s.lang],
      langMenuOpen: s.langMenuOpen,
      toggleLangMenu: () => this.setState({ langMenuOpen: !s.langMenuOpen }),
      langOptions: LANG_ORDER.map((code) => ({
        code, flag: LANG_FLAG[code], label: LANG_NAME[code],
        style: 'display:flex; align-items:center; gap:8px; border:none; border-radius:8px; padding:8px 10px; font-size:13.5px; cursor:pointer; text-align:left; background:' +
          (code === s.lang ? 'var(--accent-tint)' : 'none') + '; color:var(--ink)',
        onClick: () => {
          this.setState({ lang: code, langMenuOpen: false })
          try { localStorage.setItem('trips.lang', code) } catch (e) {}
        },
      })),
      goHome: () => { this.setState({ cityId: null, countryId: null, route: [], overviewCountry: null, countryQuery: '', cityQuery: '', view: 'grid' }); try { localStorage.removeItem('trips.nav') } catch (e) {} },
      setViewGrid: () => this.setState({ view: 'grid' }),
      setViewList: () => this.setState({ view: 'list' }),
      setViewMap: () => this.setState({ view: 'map' }),
      shareCity: () => this.shareCity(),
      // Directions route: count of picked places (with coords), whether it's
      // routable (2+), and the handlers behind the toolbar button and the FAB.
      routeCount,
      showClearRoute: !!sel && s.view !== 'map' && routeCount > 0,
      clearRoute: () => this.setState({ route: [] }), clearRouteLabel: l.clearRoute,
      routeDisabled: !routeReady,
      routeTitle: !routeReady ? l.routeHint : (routeCount >= MAX_ROUTE ? l.routeCapped : ''),
      routeBtnStyle: routeReady
        ? 'border:1px solid var(--accent); background:var(--accent); color:var(--accent-btn-ink); border-radius:999px; padding:8px 16px; font-size:13px; font-weight:600; cursor:pointer'
        : 'border:1px solid var(--border); background:var(--surface); color:var(--ink-fainter); border-radius:999px; padding:8px 16px; font-size:13px; cursor:not-allowed',
      routeBtnHover: routeReady ? 'background:var(--accent-hover); border-color:var(--accent-hover)' : '',
      routeLabel: l.directions + (routeCount ? ' (' + routeCount + ')' : ''),
      onDirections: () => this.openDirections(),
      // The "Print / PDF" button opens the browser's print dialog. The @media
      // print stylesheet hides the app chrome and lets places flow across pages.
      printCity: () => window.print(),
      addCountry: () => this.setState({ dialog: { kind: 'country', title: l.addCountry, name: '', image: '' } }),
      addLandmark: () => this.setState({ dialog: { kind: 'landmark', title: l.addPlace, name: '', image: '', description: '', descriptionEn: '', descriptionRu: '', coordsText: '' } }),
      dialogOpen: !!s.dialog,
      dialog: s.dialog ? {
        title: s.dialog.title, name: s.dialog.name || '', image: s.dialog.image || '',
        description: s.dialog.description || '',
        descriptionEn: s.dialog.descriptionEn || '', descriptionRu: s.dialog.descriptionRu || '',
        coords: s.dialog.coordsText || '', coordsError: !!s.dialog.coordsError,
        nameLabel: s.dialog.kind.indexOf('country') > -1 ? l.countryName
          : s.dialog.kind.indexOf('city') > -1 ? l.cityName : l.placeName,
        namePlaceholder: s.dialog.kind.indexOf('country') > -1 ? 'France'
          : s.dialog.kind.indexOf('city') > -1 ? 'Madrid' : 'Puerta del Sol',
        imageLabel: s.dialog.kind.indexOf('country') > -1 ? l.flagUrl : l.imageUrl,
        withDescription: s.dialog.kind.indexOf('landmark') > -1,
        hasPreview: !!(s.dialog.image && /^https?:|^data:/.test(s.dialog.image)),
        submitLabel: s.dialog.kind.indexOf('edit') === 0 ? l.save : l.addBtn,
      } : { title: '', name: '', image: '', description: '', descriptionEn: '', descriptionRu: '', coords: '', coordsError: false, nameLabel: '', namePlaceholder: '', imageLabel: '', withDescription: false, hasPreview: false, submitLabel: '' },
      onDialogName: (e) => this.setState({ dialog: { ...s.dialog, name: e.target.value } }),
      // Image is a plain URL typed/pasted by the user — stored as a string, no upload.
      onDialogImage: (e) => this.setState({ dialog: { ...s.dialog, image: e.target.value } }),
      onDialogDescription: (e) => this.setState({ dialog: { ...s.dialog, description: e.target.value } }),
      onDialogDescriptionEn: (e) => this.setState({ dialog: { ...s.dialog, descriptionEn: e.target.value } }),
      onDialogDescriptionRu: (e) => this.setState({ dialog: { ...s.dialog, descriptionRu: e.target.value } }),
      onDialogCoords: (e) => this.setState({ dialog: { ...s.dialog, coordsText: e.target.value, coordsError: false } }),
      submitDialog: () => this.submit(),
      closeDialog: () => this.setState({ dialog: null }),
      confirmOpen: !!s.confirm,
      confirmMessage: s.confirm ? s.confirm.message : '',
      runConfirm: () => { s.confirm.run(); this.setState({ confirm: null }) },
      closeConfirm: () => this.setState({ confirm: null }),
      lightboxOpen: !!s.lightbox,
      lightbox: s.lightbox || { src: '', alt: '' },
      closeLightbox: () => this.setState({ lightbox: null }),
      stop: (e) => e.stopPropagation(),
    }
  }

  render() {
    const V = this.renderVals()
    return (
      <div data-theme={V.theme} data-t="app" style={css('display:flex; flex-direction:column; height:100vh; overflow:hidden; background:var(--paper); color:var(--ink); font-family:var(--sans)')}>
        <header data-t="hdr" className="trips-noprint" style={css('flex:0 0 auto; display:flex; align-items:center; gap:24px; padding:16px 28px; background:var(--surface); border-bottom:1px solid var(--border)')}>
          <button type="button" onClick={V.goHome} style={css('display:flex; align-items:center; gap:10px; border:none; background:none; padding:0; cursor:pointer; text-align:left; flex:0 0 auto')}>
            <svg width="26" height="26" viewBox="0 0 64 64" style={{ flex: '0 0 auto' }}>
              <rect width="64" height="64" rx="14" fill="var(--accent)" />
              <path d="M12 40 Q26 18 32 30 Q38 42 52 22" fill="none" stroke="var(--paper)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="40" r="4" fill="var(--paper)" />
              <circle cx="52" cy="22" r="4" fill="var(--paper)" />
            </svg>
            <span style={css("font-family:var(--sans); font-weight:600; font-size:27px; letter-spacing:-0.01em; color:var(--ink)")}>Tripline</span>
          </button>

          <span style={css('flex:1 1 auto')}></span>

          <El as="button" type="button" onClick={V.toggleTheme} title="Theme" data-t="hdr-theme"
            base="border:1px solid var(--border); background:var(--surface); border-radius:999px; width:38px; height:34px; font-size:14px; color:var(--ink-faint); cursor:pointer; flex:0 0 auto"
            hover="border-color:var(--accent); color:var(--accent)">{V.themeIcon}</El>

          <div data-t="hdr-lang" style={css('position:relative; flex:0 0 auto')}>
            <El as="button" type="button" onClick={V.toggleLangMenu} title="Language"
              base="border:1px solid var(--border); background:var(--surface); border-radius:999px; padding:7px 14px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-faint); cursor:pointer; min-width:56px; display:flex; align-items:center; gap:6px"
              hover="border-color:var(--accent); color:var(--accent)">{V.langFlag} {V.langLabel}</El>
            {V.langMenuOpen && (
              <div style={css('position:absolute; right:0; top:calc(100% + 6px); z-index:20; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:6px; display:flex; flex-direction:column; gap:2px; min-width:150px; box-shadow:0 12px 30px rgba(26,29,22,0.16)')}>
                {V.langOptions.map((lo) => (
                  <button key={lo.code} type="button" onClick={lo.onClick} style={css(lo.style)}>{lo.flag} {lo.label}</button>
                ))}
              </div>
            )}
          </div>
        </header>

        <div data-t="shell" style={css('flex:1 1 auto; display:flex; min-height:0')}>
          <main data-t="app" style={css('flex:1 1 auto; overflow-y:auto; min-width:0; background:var(--paper)')}>
            {V.cardMenuOpen && (
              <div className="trips-noprint" onClick={V.closeCardMenu} style={css('position:fixed; inset:0; z-index:20; background:none')}></div>
            )}
            {V.showOverview && (
              <div style={css('padding:0 0 70px; animation:tripsFade 0.25s ease')}>
                <div data-t="pad" style={css('padding:44px 40px 30px; max-width:760px')}>
                  <p style={css('margin:0 0 10px; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:var(--ink-faint)')}>{V.L.eyebrow}</p>
                  <h1 style={css("margin:0 0 14px; font-family:var(--sans); font-weight:400; font-size:46px; line-height:1.05; letter-spacing:-0.015em; color:var(--ink)")}>{V.L.headline}</h1>
                  <p style={css('margin:0; font-size:15.5px; line-height:1.6; color:var(--ink-muted); text-wrap:pretty')}>{V.overviewSummary}</p>
                </div>

                {V.hasOverviewCountry && (
                  <section data-t="pad" style={css('padding:8px 40px 34px')}>
                    <div data-t="country-hdr" style={css('display:flex; align-items:center; gap:14px; padding-bottom:12px; margin-bottom:20px; border-bottom:1px solid var(--border); flex-wrap:wrap')}>
                      <El as="button" type="button" onClick={V.clearOverviewCountry} base="border:none; background:none; color:var(--ink-faint); font-size:13px; cursor:pointer; padding:0" hover="color:var(--accent)">← {V.L.countries}</El>
                      <img src={V.selectedCountry.flag} alt="" style={css('width:38px; height:26px; object-fit:cover; border-radius:3px; background:var(--image-bg)')} />
                      <h2 style={css("margin:0; font-family:var(--sans); font-weight:400; font-size:26px; color:var(--ink)")}>{V.selectedCountry.name}</h2>
                      <span data-t="country-meta" style={css('font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-faint); white-space:nowrap')}>{V.selectedCountry.meta}</span>
                      <span data-t="country-hdr-spacer" style={css('flex:1 1 auto')}></span>
                      {V.isOwner && (
                        <El as="button" type="button" onClick={V.selectedCountry.onAddCity} className="trips-noprint" base="border:1px solid var(--accent); background:var(--accent); color:var(--accent-btn-ink); border-radius:999px; padding:7px 16px; font-size:12.5px; font-weight:600; cursor:pointer; white-space:nowrap" hover="background:var(--accent-hover); border-color:var(--accent-hover)">+ {V.L.addCity}</El>
                      )}
                      {V.isOwner && (
                        <div className="trips-noprint" style={css('position:relative')}>
                          <El as="button" type="button" onClick={V.selectedCountry.onToggleMenu} title="More" base="display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border:1px solid var(--border-soft); border-radius:8px; background:var(--surface); color:var(--ink-faint); cursor:pointer; font-size:15px" hover="border-color:var(--accent); color:var(--accent)">⋮</El>
                          {V.selectedCountry.menuOpen && (
                            <div style={css('position:absolute; top:36px; right:0; z-index:21; min-width:130px; border:1px solid var(--border-soft); border-radius:10px; background:var(--surface); box-shadow:0 10px 24px rgba(0,0,0,0.28); overflow:hidden')}>
                              <El as="button" type="button" onClick={V.selectedCountry.onEdit} base="display:block; width:100%; text-align:left; padding:9px 14px; border:none; background:none; color:var(--ink); font-size:13px; cursor:pointer" hover="background:var(--row-hover)">✎ {V.L.edit}</El>
                              <El as="button" type="button" onClick={V.selectedCountry.onDelete} base="display:block; width:100%; text-align:left; padding:9px 14px; border:none; background:none; color:#c5695a; font-size:13px; cursor:pointer" hover="background:var(--row-hover)">✕ {V.L.delete}</El>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <El as="input" type="text" value={V.cityQuery} onChange={V.onCityQuery} placeholder="Search cities" base="width:100%; max-width:320px; box-sizing:border-box; padding:9px 14px; margin-bottom:18px; border:1px solid var(--border); border-radius:999px; background:var(--field); color:var(--ink); font-size:14px; outline:none" focus="border-color:var(--accent)" />
                    <div style={css('display:grid; grid-template-columns:repeat(auto-fill, minmax(268px, 1fr)); gap:22px')}>
                      {V.selectedCountry.cities.map((ci) => (
                        <El key={ci.id} base="position:relative; border:1px solid var(--border-soft); border-radius:16px; overflow:hidden; background:var(--card); transition:transform 0.18s ease, box-shadow 0.18s ease" hover="transform:translateY(-3px); box-shadow:0 14px 30px rgba(26,29,22,0.18)">
                          <button type="button" onClick={ci.onClick} style={css('display:flex; flex-direction:column; text-align:left; width:100%; padding:0; border:none; background:none; cursor:pointer')}>
                            <span style={css('display:block; position:relative; aspect-ratio:4/3; overflow:hidden; min-height:0; background:var(--image-bg)')}>
                              <img src={ci.image} alt="" style={css('width:100%; height:100%; object-fit:cover; display:block')} />
                              <span style={css('position:absolute; left:12px; bottom:12px; background:rgba(26,29,22,0.72); color:#ffffff; border-radius:999px; padding:4px 10px; font-size:11px; letter-spacing:0.06em; text-transform:uppercase')}>{ci.count}</span>
                            </span>
                            <span style={css('display:flex; flex-direction:column; gap:5px; padding:14px 16px 17px')}>
                              <span style={css("font-family:var(--sans); font-weight:600; font-size:22px; line-height:1.15; color:var(--ink)")}>{ci.name}</span>
                              <span style={css('height:3px; border-radius:3px; background:var(--image-bg); display:block; overflow:hidden')}>
                                <span style={css('display:block; height:100%; width:' + ci.progress + '; background:var(--teal)')}></span>
                              </span>
                            </span>
                          </button>
                          {V.isOwner && (
                            <div className="trips-noprint" style={css('position:absolute; top:9px; right:9px; display:flex; gap:5px')}>
                              <El as="button" type="button" onClick={ci.onEdit} title="Edit" base="display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border:1px solid var(--border-soft); border-radius:8px; background:var(--surface); color:var(--ink-faint); cursor:pointer; font-size:12px" hover="background:var(--accent-hover); color:#ffffff; border-color:var(--accent-hover)">✎</El>
                              <El as="button" type="button" onClick={ci.onDelete} title="Delete" base="display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; border:1px solid var(--border-soft); border-radius:8px; background:var(--surface); color:var(--ink-faint); cursor:pointer; font-size:12px" hover="background:#b3543e; color:#ffffff; border-color:#b3543e">✕</El>
                            </div>
                          )}
                        </El>
                      ))}
                    </div>
                  </section>
                )}

                {V.showCountryGrid && (
                  <div data-t="pad" style={css('padding:8px 40px 34px')}>
                    <div style={css('display:flex; align-items:center; gap:12px; margin-bottom:18px')}>
                      <El as="input" type="text" value={V.countryQuery} onChange={V.onCountryQuery} placeholder="Search countries" base="flex:1 1 auto; max-width:320px; box-sizing:border-box; padding:9px 14px; border:1px solid var(--border); border-radius:999px; background:var(--field); color:var(--ink); font-size:14px; outline:none" focus="border-color:var(--accent)" />
                      <span style={css('flex:1 1 auto')}></span>
                      {V.isOwner && (
                        <El as="button" type="button" onClick={V.addCountry} className="trips-noprint" base="border:1px solid var(--accent); background:var(--accent); color:var(--accent-btn-ink); border-radius:999px; padding:9px 16px; font-size:12.5px; font-weight:600; cursor:pointer; flex:0 0 auto; white-space:nowrap" hover="background:var(--accent-hover); border-color:var(--accent-hover)">+ {V.L.addCountry}</El>
                      )}
                    </div>
                    {V.noCountryMatch && <p style={css('color:var(--ink-faint); font-style:italic')}>{V.L.noResults}</p>}
                    <div style={css('display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:18px')}>
                      {V.chapters.map((ch) => (
                        <El key={ch.id} base="position:relative; display:flex; align-items:center; border:1px solid var(--border-soft); border-radius:16px; background:var(--card); transition:transform 0.18s ease, box-shadow 0.18s ease" hover="transform:translateY(-3px); box-shadow:0 14px 30px rgba(26,29,22,0.14)">
                          <button type="button" onClick={ch.onSelect} style={css('display:flex; align-items:center; gap:14px; text-align:left; width:100%; padding:14px 16px; border:none; background:none; cursor:pointer')}>
                            <img src={ch.flag} alt="" style={css('width:48px; height:34px; object-fit:cover; border-radius:5px; background:var(--image-bg); flex:0 0 auto')} />
                            <span style={css('flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:3px')}>
                              <span style={css("font-family:var(--sans); font-weight:600; font-size:19px; color:var(--ink); line-height:1.25")}>{ch.name}</span>
                              <span style={css('font-size:12px; color:var(--ink-faint)')}>{ch.meta}</span>
                            </span>
                          </button>
                        </El>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {V.showCity && (
              <div style={css('animation:tripsFade 0.25s ease')}>
                <div data-t="hero" style={css('position:relative; height:280px; background:var(--image-bg); overflow:hidden')}>
                  <img src={V.city.image} alt="" style={css('width:100%; height:100%; object-fit:cover; display:block')} />
                  <div style={css('position:absolute; inset:0; background:linear-gradient(to top, rgba(26,29,22,0.85) 0%, rgba(26,29,22,0.24) 55%, rgba(26,29,22,0.05) 100%)')}></div>
                  <div data-t="hero-in" style={css('position:absolute; left:40px; right:40px; bottom:24px; display:flex; align-items:flex-end; gap:20px')}>
                    <div style={css('flex:1 1 auto; min-width:0')}>
                      <El as="button" type="button" onClick={V.goHome} className="trips-noprint" base="border:none; background:none; padding:0; color:rgba(255,255,255,0.8); font-size:11.5px; letter-spacing:0.14em; text-transform:uppercase; cursor:pointer; margin-bottom:8px" hover="color:#ffffff">{V.city.crumb}</El>
                      <h1 data-t="hero-title" style={css("margin:0; font-family:var(--sans); font-weight:400; font-size:52px; line-height:1; color:#ffffff; letter-spacing:-0.02em")}>{V.city.name}</h1>
                    </div>
                    <span style={css('font-size:13px; letter-spacing:0.06em; text-transform:uppercase; color:#ffffff; opacity:0.85')}>{V.city.meta}</span>
                  </div>
                </div>

                <div data-t="pad toolbar" style={css('display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:16px 40px; border-bottom:1px solid var(--border); background:var(--paper); position:sticky; top:0; z-index:4')}>
                  <div data-t="toolbar-view" className="trips-noprint" style={css('display:flex; gap:4px; padding:3px; background:var(--paper); border:1px solid var(--border-soft); border-radius:999px')}>
                    <button type="button" onClick={V.setViewGrid} style={css(V.viewGridStyle)}>{V.L.grid}</button>
                    <button type="button" onClick={V.setViewList} data-t="view-list-btn" style={css(V.viewListStyle)}>{V.L.list}</button>
                    <button type="button" onClick={V.setViewMap} style={css(V.viewMapStyle)}>{V.L.map}</button>
                  </div>
                  <span data-t="toolbar-spacer" style={css('flex:1 1 auto')}></span>
                  <div data-t="toolbar-actions" style={css('display:flex; align-items:center; gap:10px; flex-wrap:wrap')}>
                    {V.showClearRoute && (
                      <El as="button" type="button" onClick={V.clearRoute} className="trips-noprint" base="border:1px solid var(--border); background:var(--surface); border-radius:999px; padding:8px 16px; font-size:13px; color:var(--ink-muted); cursor:pointer" hover="border-color:#b3543e; color:#b3543e">{V.clearRouteLabel}</El>
                    )}
                    {V.isCards && (
                      <El as="button" type="button" onClick={V.onDirections} disabled={V.routeDisabled} title={V.routeTitle} className="trips-noprint" base={V.routeBtnStyle} hover={V.routeBtnHover}>🧭 {V.routeLabel}</El>
                    )}
                    <El as="button" type="button" onClick={V.shareCity} className="trips-noprint" base="border:1px solid var(--border); background:var(--surface); border-radius:999px; padding:8px 16px; font-size:13px; color:var(--ink-muted); cursor:pointer" hover="border-color:var(--accent); color:var(--accent)">{V.L.share}</El>
                    <El as="button" type="button" onClick={V.printCity} className="trips-noprint" base="border:1px solid var(--border); background:var(--surface); border-radius:999px; padding:8px 16px; font-size:13px; color:var(--ink-muted); cursor:pointer" hover="border-color:var(--accent); color:var(--accent)">{V.L.pdf}</El>
                    {V.isOwner && (
                      <El as="button" type="button" onClick={V.addLandmark} className="trips-noprint" base="border:1px solid var(--accent); background:var(--accent); color:var(--accent-btn-ink); border-radius:999px; padding:8px 18px; font-size:13px; font-weight:600; cursor:pointer" hover="background:var(--accent-hover); border-color:var(--accent-hover)">{V.L.addPlace}</El>
                    )}
                  </div>
                </div>

                <div data-t="pad city-row" style={css('display:flex; align-items:flex-start; gap:32px; padding:28px 40px 70px')}>
                  <div style={css('flex:1 1 auto; min-width:0')}>
                    {V.isMap && (
                      <CityMap L={V.L} pl={this.pl} mode={V.theme} city={V.mapCity} />
                    )}

                    {V.isCards && (
                      <div style={css('display:' + V.groupDisplay + '; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); flex-direction:column; gap:' + V.groupGap)}>
                        {V.landmarks.map((lm) => (
                          <article key={lm.id} data-t="card" data-lm-idx={lm.pos} draggable onDragStart={lm.onDragStart} onDragOver={lm.onDragOver} onDragEnd={lm.onDragEnd} style={css(lm.cardStyle)}>
                            <div style={css(lm.mediaStyle)}>
                              <img src={lm.image} alt={lm.name} onClick={lm.onPreview} style={css('width:100%; height:100%; object-fit:cover; display:block; cursor:zoom-in')} />
                              {V.isOwner && (
                                <div className="trips-noprint" style={css('position:absolute; top:9px; right:9px; display:flex; gap:5px')}>
                                  <El as="button" type="button" onClick={lm.onEdit} title="Edit" base="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border:none; border-radius:999px; background:#ffffff; color:#26291f; font-size:12px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.18); transition:transform .12s ease, color .12s ease" hover="color:var(--accent-hover); transform:scale(1.08)">✎</El>
                                  <El as="button" type="button" onClick={lm.onDelete} title="Delete" base="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border:none; border-radius:999px; background:#ffffff; color:#26291f; font-size:12px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.18); transition:transform .12s ease, color .12s ease" hover="color:#b3543e; transform:scale(1.08)">✕</El>
                                </div>
                              )}
                            </div>
                            <div style={css(lm.bodyStyle)}>
                              <div style={css('display:flex; align-items:baseline; gap:10px')}>
                                <h4 style={css("margin:0; font-family:var(--sans); font-weight:400; font-size:19.5px; line-height:1.2; flex:1 1 auto; color:var(--ink)")}>{lm.name}</h4>
                                <span style={css('font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-fainter); flex:0 0 auto')}>{lm.index}</span>
                              </div>
                              <p style={css('margin:0; font-size:13.5px; line-height:1.6; color:var(--ink-muted); text-wrap:pretty')}>{lm.description}</p>
                              <div style={css('display:flex; align-items:center; flex-wrap:wrap; column-gap:8px; row-gap:4px; margin-top:2px')}>
                                <span className="trips-noprint" onPointerDown={lm.onHandleDown} title={lm.dragTitle} style={css('display:inline-flex; align-items:center; gap:6px; font-size:11px; color:var(--ink-fainter); cursor:grab; white-space:nowrap; touch-action:none; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none; padding:6px 12px; border:1px solid var(--border-soft); border-radius:999px; background:var(--paper)')}><span style={css('font-size:14px; line-height:1')}>⠿</span> {lm.dragTitle}</span>
                                <span style={css('flex:1 1 auto')}></span>
                                {lm.hasMapLink && (
                                  <button type="button" onClick={lm.onToggleRoute} disabled={lm.routeFull} className="trips-noprint" title={lm.routeTitle} style={css(lm.routeStyle)}>{lm.routeText}</button>
                                )}
                                {lm.hasMapLink && (
                                  <a href={lm.mapUrl} target="_blank" rel="noopener" style={css('display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:var(--accent); text-decoration:none; white-space:nowrap; flex:0 0 auto')}>📍 {V.L.viewOnMap}</a>
                                )}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}

                    {V.cityEmpty && <p style={css('color:var(--ink-faint); font-style:italic; padding:40px 0; text-align:center')}>{V.L.emptyCity}</p>}
                  </div>
                </div>

                {V.showClearRoute && (
                  <button type="button" onClick={V.onDirections} title={V.routeTitle} data-t="route-fab" className="trips-noprint" style={css('display:none; position:fixed; right:18px; bottom:18px; z-index:30; align-items:center; justify-content:center; width:52px; height:52px; border-radius:999px; border:none; background:var(--accent); color:var(--accent-btn-ink); font-size:16px; font-weight:600; cursor:pointer; box-shadow:0 8px 20px rgba(0,0,0,0.28)')}>{V.routeCount}</button>
                )}
              </div>
            )}
          </main>
        </div>

        {V.dialogOpen && (
          <div onClick={V.closeDialog} style={css('position:fixed; inset:0; background:rgba(26,29,22,0.6); display:flex; align-items:center; justify-content:center; padding:24px; z-index:50')}>
            <div onClick={V.stop} style={css('width:100%; max-width:460px; max-height:calc(100vh - 48px); overflow-y:auto; background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:26px 26px 22px; box-shadow:0 26px 60px rgba(26,29,22,0.4)')}>
              <h2 style={css("margin:0 0 18px; font-family:var(--sans); font-weight:400; font-size:26px; color:var(--ink)")}>{V.dialog.title}</h2>
              <label style={css('display:block; margin-bottom:14px')}>
                <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-faint)')}>{V.dialog.nameLabel}</span>
                <El as="input" type="text" value={V.dialog.name} onChange={V.onDialogName} placeholder={V.dialog.namePlaceholder} base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--border-soft); border-radius:11px; background:var(--field); color:var(--ink); font-size:14px; outline:none" focus="border-color:var(--accent)" />
              </label>
              <label style={css('display:block; margin-bottom:14px')}>
                <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-faint)')}>{V.dialog.imageLabel}</span>
                <El as="input" type="url" value={V.dialog.image} onChange={V.onDialogImage} placeholder="https://…" base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--border-soft); border-radius:11px; background:var(--field); color:var(--ink); font-size:14px; outline:none" focus="border-color:var(--accent)" />
              </label>
              {V.dialog.withDescription && (
                <>
                  <label style={css('display:block; margin-bottom:14px')}>
                    <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-faint)')}>{V.L.descriptionHy}</span>
                    <El as="textarea" value={V.dialog.description} onChange={V.onDialogDescription} rows={3} base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--border-soft); border-radius:11px; background:var(--field); color:var(--ink); font-size:14px; line-height:1.55; resize:vertical; outline:none" focus="border-color:var(--accent)" />
                  </label>
                  <label style={css('display:block; margin-bottom:14px')}>
                    <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-faint)')}>{V.L.descriptionEn}</span>
                    <El as="textarea" value={V.dialog.descriptionEn} onChange={V.onDialogDescriptionEn} rows={3} base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--border-soft); border-radius:11px; background:var(--field); color:var(--ink); font-size:14px; line-height:1.55; resize:vertical; outline:none" focus="border-color:var(--accent)" />
                  </label>
                  <label style={css('display:block; margin-bottom:14px')}>
                    <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-faint)')}>{V.L.descriptionRu}</span>
                    <El as="textarea" value={V.dialog.descriptionRu} onChange={V.onDialogDescriptionRu} rows={3} base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--border-soft); border-radius:11px; background:var(--field); color:var(--ink); font-size:14px; line-height:1.55; resize:vertical; outline:none" focus="border-color:var(--accent)" />
                  </label>
                  <label style={css('display:block; margin-bottom:14px')}>
                    <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:var(--ink-faint)')}>{V.L.coordinates}</span>
                    <El as="input" type="text" value={V.dialog.coords} onChange={V.onDialogCoords} placeholder={'39°28\'12.0"N 0°22\'12.0"W'} base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid var(--border-soft); border-radius:11px; background:var(--field); color:var(--ink); font-size:14px; outline:none" focus="border-color:var(--accent)" />
                    {V.dialog.coordsError && (
                      <span style={css('display:block; margin-top:5px; font-size:12px; color:#b3543e')}>{V.L.coordsInvalid}</span>
                    )}
                  </label>
                </>
              )}
              {V.dialog.hasPreview && (
                <div style={css('margin-bottom:16px; border:1px solid var(--border-soft); border-radius:12px; overflow:hidden; background:var(--image-bg)')}>
                  <img src={V.dialog.image} alt="" style={css('width:100%; max-height:170px; object-fit:cover; display:block')} />
                </div>
              )}
              <div style={css('display:flex; justify-content:flex-end; gap:10px')}>
                <El as="button" type="button" onClick={V.closeDialog} base="border:1px solid var(--border); background:none; border-radius:999px; padding:9px 18px; font-size:13.5px; color:var(--ink-muted); cursor:pointer" hover="border-color:var(--ink); color:var(--ink)">{V.L.cancel}</El>
                <El as="button" type="button" onClick={V.submitDialog} base="border:1px solid var(--accent); background:var(--accent); color:var(--accent-btn-ink); border-radius:999px; padding:9px 20px; font-size:13.5px; font-weight:600; cursor:pointer" hover="background:var(--accent-hover); border-color:var(--accent-hover)">{V.dialog.submitLabel}</El>
              </div>
            </div>
          </div>
        )}

        {V.confirmOpen && (
          <div onClick={V.closeConfirm} style={css('position:fixed; inset:0; background:rgba(26,29,22,0.6); display:flex; align-items:center; justify-content:center; padding:24px; z-index:60')}>
            <div onClick={V.stop} style={css('width:100%; max-width:380px; background:var(--surface); border:1px solid var(--border); border-radius:20px; padding:24px; box-shadow:0 26px 60px rgba(26,29,22,0.4)')}>
              <p style={css('margin:0 0 20px; font-size:15px; line-height:1.55; color:var(--ink)')}>{V.confirmMessage}</p>
              <div style={css('display:flex; justify-content:flex-end; gap:10px')}>
                <El as="button" type="button" onClick={V.closeConfirm} base="border:1px solid var(--border); background:none; border-radius:999px; padding:9px 18px; font-size:13.5px; color:var(--ink-muted); cursor:pointer" hover="border-color:var(--ink); color:var(--ink)">{V.L.cancel}</El>
                <El as="button" type="button" onClick={V.runConfirm} base="border:1px solid var(--accent); background:var(--accent); color:var(--accent-btn-ink); border-radius:999px; padding:9px 20px; font-size:13.5px; font-weight:600; cursor:pointer" hover="background:var(--accent-hover); border-color:var(--accent-hover)">{V.L.delete}</El>
              </div>
            </div>
          </div>
        )}

        {V.lightboxOpen && (
          <div onClick={V.closeLightbox} style={css('position:fixed; inset:0; background:rgba(18,20,14,0.92); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:36px; z-index:70; cursor:zoom-out')}>
            <img src={V.lightbox.src} alt={V.lightbox.alt} style={css('max-width:88vw; max-height:80vh; object-fit:contain; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.6)')} />
            <p style={css("margin:0; color:#ffffff; font-family:var(--sans); font-weight:600; font-size:20px")}>{V.lightbox.alt}</p>
          </div>
        )}
      </div>
    )
  }
}
