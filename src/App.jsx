import React from 'react'
import { COORDS } from './coords.js'
import { EN, HY, RU, LANG_ORDER, LANG_LABEL, labelsFor, pluralize } from './i18n.js'
import { loadData, saveData } from './storage.js'
import CityMap from './components/CityMap.jsx'
import './design.css'

// Verbatim port of the Trips.dc.html design component. The markup below mirrors
// the design's <x-dc> template one-to-one: inline style strings are kept as
// authored and turned into React style objects by css(); per-element
// style-hover / style-focus becomes the <El> wrapper. All view-model values are
// computed in renderVals(), a direct port of the design's DCLogic class. The
// map slot delegates to the app's own enhanced CityMap.

const LANGS = { en: EN, hy: HY, ru: RU }

const PAL = {
  light: {
    pillOnBg: '#26291F', pillOnInk: '#FFFFFF', pillOffInk: '#7C8474', chipBg: '#93C193', chipInk: '#FFFFFF',
    chipOffBg: '#FFFFFF', chipOffInk: '#7C8474', chipOffEdge: '#DCE3D6', cardBg: '#FFFFFF', cardEdge: '#E4EBDD',
    seenBg: '#E4EBDD', seenEdge: '#B7DAB7', teal: '#93C193', accent: '#5FA05F', media: '#E4EBDD', pinRing: '#FFFFFF',
  },
  dark: {
    pillOnBg: '#F5F6F4', pillOnInk: '#1B1D18', pillOffInk: '#8C9384', chipBg: '#93C193', chipInk: '#1B1D18',
    chipOffBg: '#292C25', chipOffInk: '#A9AC9E', chipOffEdge: '#3A3E33', cardBg: '#26291F', cardEdge: '#3A3E33',
    seenBg: '#2A3B26', seenEdge: '#456E42', teal: '#93C193', accent: '#93C193', media: '#2B2E26', pinRing: '#1B1D18',
  },
}

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
    nav: 'tree',
    countryId: null, cityId: null, openCountry: 'spain',
    query: '', view: 'grid',
    dialog: null, confirm: null, lightbox: null, dragIndex: null,
  }

  componentDidMount() {
    const savedTheme = localStorage.getItem('trips.theme')
    if (savedTheme) this.setState({ theme: savedTheme })
    const savedLang = localStorage.getItem('trips.lang')
    if (savedLang && LANGS[savedLang]) this.setState({ lang: savedLang })
    loadData().then((d) =>
      this.setState({ data: d, openCountry: d.countries[0]?.id ?? this.state.openCountry }),
    )
    this.applyTheme()
  }

  componentDidUpdate() { this.applyTheme() }

  applyTheme() { document.documentElement.setAttribute('data-theme', this.mode()) }

  mode() {
    if (this.state.theme === 'dark') return 'dark'
    if (this.state.theme === 'light') return 'light'
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  pal() { return PAL[this.mode()] }

  // "3 places" / "3 места" — delegates to the shared plural rules.
  pl = (n, key) => pluralize(this.state.lang, n, key)

  persist(data) {
    this.setState({ data })
    clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => saveData(data), 400)
  }

  L() { return labelsFor(this.state.lang) }

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
  // GitHub Pages deployment) = view-only. This isn't server-enforced security — a
  // determined visitor could still edit the page's JS in devtools — but it stops
  // accidental edits by guests and matches "I run it locally to edit, I publish a
  // static copy for others to view."
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

  buildCard(lm, index, listMode) {
    const p = this.pal(), visited = !!lm.visited
    return {
      id: lm.id, name: lm.name, image: lm.image || '', description: this.pickDescription(lm),
      index: String(index + 1).padStart(2, '0'),
      cardStyle: 'display:flex; flex-direction:' + (listMode ? 'row' : 'column') +
        '; border:1px solid ' + (visited ? p.seenEdge : p.cardEdge) + '; border-radius:16px; overflow:hidden; background:' +
        (visited ? p.seenBg : p.cardBg) + '; opacity:' + (this.state.dragIndex === index ? '0.45' : '1') + '; transition:box-shadow .18s ease',
      mediaStyle: 'position:relative; flex:0 0 ' + (listMode ? '210px' : 'auto') + '; background:' + p.media + '; ' +
        (listMode ? 'align-self:stretch; min-height:150px' : 'aspect-ratio:16/10'),
      imgStyle: 'width:100%; height:100%; object-fit:cover; display:block; cursor:zoom-in',
      bodyStyle: 'display:flex; flex-direction:column; gap:8px; padding:' + (listMode ? '16px 20px' : '14px 16px 16px') + '; flex:1 1 auto; min-width:0',
      // A "View on Google Maps" deep link, shown only for places we have coordinates
      // for. Per-place coords entered in the dialog (lm.coords) win over the built-in
      // COORDS table keyed by landmark id. Useful to owners and view-only guests alike.
      hasMapLink: !!(lm.coords || COORDS[lm.id]),
      mapUrl: (lm.coords || COORDS[lm.id]) ? ('https://www.google.com/maps/search/?api=1&query=' + (lm.coords || COORDS[lm.id])[0] + ',' + (lm.coords || COORDS[lm.id])[1]) : '',
      onPreview: () => lm.image && this.setState({ lightbox: { src: lm.image, alt: lm.name } }),
      onEdit: () => this.setState({ dialog: { kind: 'edit-landmark', id: lm.id, title: lm.name, name: lm.name, image: lm.image || '', description: lm.description || '', descriptionEn: lm.descriptionEn || '', descriptionRu: lm.descriptionRu || '', coordsText: lm.coordsText || '' } }),
      onDelete: () => this.askDelete(lm.name, () => this.mutate((d) => {
        const ci = this.findCity(d); ci.landmarks = ci.landmarks.filter((x) => x.id !== lm.id)
      })),
      onToggleVisited: () => this.mutate((d) => {
        const t = this.findCity(d).landmarks.find((x) => x.id === lm.id); t.visited = !t.visited
      }),
      onDragStart: () => this.setState({ dragIndex: index }),
      onDragOver: (e) => {
        e.preventDefault()
        const from = this.state.dragIndex
        if (from === null || from === index) return
        this.setState({ dragIndex: index })
        this.mutate((d) => {
          const ci = this.findCity(d)
          const [moved] = ci.landmarks.splice(from, 1)
          ci.landmarks.splice(index, 0, moved)
        })
      },
      onDragEnd: () => this.setState({ dragIndex: null }),
    }
  }

  findCity(d) {
    return d.countries.find((c) => c.id === this.state.countryId).cities.find((c) => c.id === this.state.cityId)
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
    const rows = sel.city.landmarks.map((lm, i) => `
      <article style="display:flex;gap:16px;border:1px solid #E4EBDD;border-radius:16px;overflow:hidden;background:#FFFFFF;margin-bottom:18px">
        ${lm.image ? `<img src="${esc(lm.image)}" alt="" style="width:220px;height:160px;object-fit:cover;flex:0 0 auto"/>` : ''}
        <div style="padding:16px 20px;display:flex;flex-direction:column;gap:6px;min-width:0">
          <div style="display:flex;align-items:baseline;gap:10px">
            <h3 style="margin:0;font-family:'Work Sans',sans-serif;font-weight:600;font-size:19px;color:#1B1D18">${esc(lm.name)}</h3>
            <span style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9C9488">${String(i + 1).padStart(2, '0')}</span>
          </div>
          <p style="margin:0;font-size:13.5px;line-height:1.6;color:#7C8474">${esc(this.pickDescription(lm))}</p>
        </div>
      </article>`).join('')
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
    const s = this.state, L = this.L(), l = L, p = this.pal(), mode = this.mode()
    const PILL_ON = 'border:none; border-radius:999px; padding:7px 15px; font-size:12.5px; font-weight:500; cursor:pointer; background:' + p.pillOnBg + '; color:' + p.pillOnInk
    const PILL_OFF = 'border:none; border-radius:999px; padding:7px 15px; font-size:12.5px; cursor:pointer; background:none; color:' + p.pillOffInk

    const countries = s.data ? s.data.countries : []
    const sel = this.city()
    const q = s.query.trim().toLowerCase()
    const isSearching = q.length > 1

    const stats = (ci) => {
      const total = ci.landmarks.length
      const seen = ci.landmarks.filter((x) => x.visited).length
      return { total, seen, pct: total ? Math.round((seen / total) * 100) + '%' : '0%' }
    }

    const tree = countries.map((c) => ({
      id: c.id, name: c.name, flag: c.flag || '',
      count: this.pl(c.cities.length, 'cities'),
      open: s.openCountry === c.id,
      rowBg: s.openCountry === c.id ? (mode === 'dark' ? '#2B2E26' : '#E4EBDD') : 'transparent',
      onClick: () => this.setState({ openCountry: s.openCountry === c.id ? null : c.id }),
      onEdit: () => this.setState({ dialog: { kind: 'edit-country', id: c.id, title: c.name, name: c.name, image: c.flag || '' } }),
      onDelete: () => this.askDelete(c.name, () => this.mutate((d) => { d.countries = d.countries.filter((x) => x.id !== c.id) })),
      onAddCity: () => this.setState({ dialog: { kind: 'city', countryId: c.id, title: l.addCity, name: '', image: '' } }),
      cities: c.cities.map((ci) => {
        const st = stats(ci)
        return {
          id: ci.id, name: ci.name, image: ci.image || '',
          meta: this.pl(st.total, 'places'),
          ink: s.cityId === ci.id ? p.accent : (mode === 'dark' ? '#F5F6F4' : '#26291F'),
          rowBg: s.cityId === ci.id ? (mode === 'dark' ? '#3D4235' : '#E4EBDD') : 'transparent',
          onClick: () => this.setState({ countryId: c.id, cityId: ci.id, query: '', view: 'grid' }),
          onEdit: () => this.setState({ dialog: { kind: 'edit-city', id: ci.id, countryId: c.id, title: ci.name, name: ci.name, image: ci.image || '' } }),
          onDelete: () => this.askDelete(ci.name, () => this.mutate((d) => {
            const cc = d.countries.find((x) => x.id === c.id); cc.cities = cc.cities.filter((x) => x.id !== ci.id)
          })),
        }
      }),
    }))

    const chapters = countries.map((c) => ({
      id: c.id, name: c.name, flag: c.flag || '',
      meta: this.pl(c.cities.length, 'cities') + ' · ' + this.pl(c.cities.reduce((n, ci) => n + ci.landmarks.length, 0), 'places'),
      onAddCity: () => this.setState({ dialog: { kind: 'city', countryId: c.id, title: l.addCity, name: '', image: '' } }),
      cities: c.cities.map((ci) => {
        const st = stats(ci)
        return {
          id: ci.id, name: ci.name, image: ci.image || '',
          count: this.pl(st.total, 'places'),
          progress: st.pct,
          onClick: () => this.setState({ countryId: c.id, cityId: ci.id, openCountry: c.id, view: 'grid' }),
        }
      }),
    }))

    let results = []
    if (isSearching) {
      countries.forEach((c) => c.cities.forEach((ci) => ci.landmarks.forEach((lm) => {
        const hay = (lm.name + ' ' + (lm.description || '') + ' ' + (lm.descriptionEn || '') + ' ' + (lm.descriptionRu || '')).toLowerCase()
        if (hay.indexOf(q) === -1) return
        results.push({
          id: c.id + ci.id + lm.id, name: lm.name, image: lm.image || '',
          where: ci.name + ' · ' + c.name,
          snippet: this.pickDescription(lm).slice(0, 150),
          onClick: () => this.setState({ countryId: c.id, cityId: ci.id, openCountry: c.id, query: '' }),
        })
      })))
      results = results.slice(0, 40)
    }

    let groups = [], cityVals = null
    if (sel) {
      const st = stats(sel.city)
      cityVals = {
        name: sel.city.name, image: sel.city.image || '',
        crumb: '← ' + sel.country.name,
        meta: this.pl(st.total, 'places') + ' · ' + st.seen + ' ' + l.visited,
      }
      const items = sel.city.landmarks.map((lm, i) => ({ lm, i }))
      const listMode = s.view === 'list'
      const shell = { display: listMode ? 'flex' : 'grid', gap: listMode ? '12px' : '22px' }
      groups = [{ title: '', showTitle: false, count: '', display: shell.display, gap: shell.gap,
        items: items.map((x) => this.buildCard(x.lm, x.i, listMode)) }]
    }

    const mapped = sel ? sel.city.landmarks.filter((lm) => COORDS[lm.id]).length : 0
    const missing = sel ? sel.city.landmarks.length - mapped : 0

    return {
      L, tree, chapters, results,
      theme: mode, tealBar: p.teal,
      themeIcon: mode === 'dark' ? '☾' : '☀',
      toggleTheme: () => this.setTheme(mode === 'dark' ? 'light' : 'dark'),
      query: s.query, isSearching, noResults: isSearching && results.length === 0,
      resultsTitle: l.results + ' “' + s.query.trim() + '”',
      showSidebar: s.nav === 'tree',
      // Tags the sidebar while a city is open so the ≤860px breakpoint can hide it
      // (the hero + city content take over the full width on phones).
      sidebarInCityClass: (!isSearching && !!sel) ? 'in-city' : '',
      showOverview: !isSearching && !sel,
      showCity: !isSearching && !!sel,
      isOwner: this.isOwner(), notOwner: !this.isOwner(),
      city: cityVals || { name: '', image: '', crumb: '', meta: '' },
      mapCity: sel ? sel.city : null,
      groups, cityEmpty: !!sel && groups.every((g) => g.items.length === 0),
      isMap: !!sel && s.view === 'map', isCards: !!sel && s.view !== 'map',
      mapNote: missing ? (this.pl(mapped, 'places') + ' ' + l.pinnedSuffix + ' · ' + missing + ' ' + l.needCoords) : l.allPinned,
      overviewSummary: countries.length
        ? countries.map((c) => c.name).join(' · ') + ' — ' +
          this.pl(countries.reduce((n, c) => n + c.cities.reduce((m, ci) => m + ci.landmarks.length, 0), 0), 'places')
        : '',
      langLabel: LANG_LABEL[s.lang],
      cycleLang: () => {
        const next = LANG_ORDER[(LANG_ORDER.indexOf(s.lang) + 1) % LANG_ORDER.length]
        this.setState({ lang: next })
        try { localStorage.setItem('trips.lang', next) } catch (e) {}
      },
      navTreeStyle: s.nav === 'tree' ? PILL_ON : PILL_OFF,
      navOverviewStyle: s.nav === 'overview' ? PILL_ON : PILL_OFF,
      setNavTree: () => this.setState({ nav: 'tree' }),
      setNavOverview: () => this.setState({ nav: 'overview' }),
      goHome: () => this.setState({ cityId: null, countryId: null, query: '' }),
      onQuery: (e) => this.setState({ query: e.target.value }),
      clearQuery: () => this.setState({ query: '' }),
      viewGridStyle: s.view === 'grid' ? PILL_ON : PILL_OFF,
      viewListStyle: s.view === 'list' ? PILL_ON : PILL_OFF,
      viewMapStyle: s.view === 'map' ? PILL_ON : PILL_OFF,
      setViewGrid: () => this.setState({ view: 'grid' }),
      setViewList: () => this.setState({ view: 'list' }),
      setViewMap: () => this.setState({ view: 'map' }),
      shareCity: () => this.shareCity(),
      // The "Print / PDF" button opens the browser's print dialog, from which
      // the user can print on paper or save as PDF. The @media print stylesheet
      // hides the app chrome (toolbar, sidebar, header) and lets the city's
      // places flow across pages.
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
          : s.dialog.kind.indexOf('city') > -1 ? 'Barcelona' : 'Sagrada Família',
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
      <div data-theme={V.theme} data-t="app" style={css('display:flex; flex-direction:column; height:100vh; overflow:hidden; background:#F5F6F4')}>
        <header data-t="hdr" className="trips-noprint" style={css('flex:0 0 auto; display:flex; align-items:center; gap:24px; padding:16px 28px; background:#FFFFFF; border-bottom:1px solid #DCE3D6')}>
          <button type="button" onClick={V.goHome} style={css('display:flex; align-items:center; gap:10px; border:none; background:none; padding:0; cursor:pointer; text-align:left')}>
            <svg width="26" height="26" viewBox="0 0 64 64" style={{ flex: '0 0 auto' }}>
              <rect width="64" height="64" rx="14" fill="#5FA05F" />
              <path d="M12 40 Q26 18 32 30 Q38 42 52 22" fill="none" stroke="#F5F6F4" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="40" r="4" fill="#F5F6F4" />
              <circle cx="52" cy="22" r="4" fill="#F5F6F4" />
            </svg>
            <span data-t="ink" style={css("font-family:'Work Sans',sans-serif; font-weight:600; font-size:27px; letter-spacing:-0.01em; color:#26291F")}>Tripline</span>
            <span style={css('font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#7C8474')}>{V.L.tagline}</span>
          </button>

          <div data-t="search" style={css('flex:1 1 auto; max-width:480px; position:relative')}>
            <El as="input" data-t="input" type="text" value={V.query} onChange={V.onQuery} placeholder={V.L.search}
              base="width:100%; box-sizing:border-box; padding:10px 14px 10px 36px; border:1px solid #DCE3D6; border-radius:999px; background:#FFFFFF; color:#26291F; font-size:14px; outline:none"
              focus="border-color:#5FA05F" />
            <span style={css('position:absolute; left:14px; top:50%; transform:translateY(-50%); font-size:13px; color:#7C8474')}>⌕</span>
          </div>

          <div data-t="panel2" style={css('display:flex; align-items:center; gap:6px; padding:3px; background:#F5F6F4; border-radius:999px; border:1px solid #E4EBDD')}>
            <button type="button" onClick={V.setNavTree} style={css(V.navTreeStyle)}>{V.L.navTree}</button>
            <button type="button" onClick={V.setNavOverview} style={css(V.navOverviewStyle)}>{V.L.navOverview}</button>
          </div>

          <El as="button" data-t="ghost" type="button" onClick={V.toggleTheme} title="Theme"
            base="border:1px solid #DCE3D6; background:#FFFFFF; border-radius:999px; width:38px; height:34px; font-size:14px; color:#7C8474; cursor:pointer"
            hover="border-color:#5FA05F; color:#5FA05F">{V.themeIcon}</El>

          <El as="button" data-t="ghost" type="button" onClick={V.cycleLang} title="Language"
            base="border:1px solid #DCE3D6; background:#FFFFFF; border-radius:999px; padding:7px 14px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#7C8474; cursor:pointer; min-width:56px"
            hover="border-color:#5FA05F; color:#5FA05F">{V.langLabel}</El>
        </header>

        <div data-t="shell" style={css('flex:1 1 auto; display:flex; min-height:0')}>
          {V.showSidebar && (
            <aside data-t="sidebar" className={('trips-noprint ' + V.sidebarInCityClass).trim()} style={css('flex:0 0 288px; border-right:1px solid #C7D0BC; box-shadow:1px 0 0 rgba(0,0,0,0.03); background:#EBEEE6; overflow-y:auto; padding:22px 18px 40px')}>
              <div style={css('display:flex; align-items:baseline; justify-content:space-between; margin-bottom:16px')}>
                <span style={css('font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#7C8474')}>{V.L.countries}</span>
                {V.isOwner && (
                  <button data-t="accent" type="button" onClick={V.addCountry} style={css('border:none; background:none; color:#5FA05F; font-size:12px; cursor:pointer; padding:0')}>{V.L.add}</button>
                )}
              </div>

              <div style={css('display:flex; flex-direction:column; gap:4px')}>
                {V.tree.map((c) => (
                  <div key={c.id} style={css('display:flex; flex-direction:column')}>
                    <El data-t="row" base={'display:flex; align-items:center; gap:8px; border-radius:10px; padding:7px 8px; background:' + c.rowBg} hover="background:#F5F6F4">
                      <button type="button" onClick={c.onClick} style={css('flex:1 1 auto; display:flex; align-items:center; gap:10px; min-width:0; border:none; background:none; padding:0; cursor:pointer; text-align:left')}>
                        <img src={c.flag} alt="" data-t="media" style={css('width:30px; height:21px; object-fit:cover; border-radius:3px; background:#E4EBDD; flex:0 0 auto')} />
                        <span data-t="ink" style={css("flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:'Work Sans',sans-serif; font-weight:600; font-size:17px; color:#26291F")}>{c.name}</span>
                        <span style={css('font-size:11px; color:#7C8474; flex:0 0 auto')}>{c.count}</span>
                      </button>
                      {V.isOwner && (
                        <span data-t="edge" style={css('display:inline-flex; align-items:center; border:1px solid #E4EBDD; border-radius:999px; overflow:hidden')}>
                          <El as="button" type="button" onClick={c.onEdit} title="Edit" base="display:inline-flex; align-items:center; justify-content:center; width:24px; height:22px; border:none; background:none; color:#7C8474; cursor:pointer; font-size:11px" hover="background:#478047; color:#FFFFFF">✎</El>
                          <span data-t="edge" style={css('width:1px; align-self:stretch; background:#E4EBDD')}></span>
                          <El as="button" type="button" onClick={c.onDelete} title="Delete" base="display:inline-flex; align-items:center; justify-content:center; width:24px; height:22px; border:none; background:none; color:#7C8474; cursor:pointer; font-size:11px" hover="background:#B3543E; color:#FFFFFF">✕</El>
                        </span>
                      )}
                    </El>

                    {c.open && (
                      <div data-t="edge" style={css('display:flex; flex-direction:column; gap:2px; margin:4px 0 8px 20px; padding-left:12px; border-left:1px solid #E4EBDD')}>
                        {c.cities.map((ci) => (
                          <El key={ci.id} data-t="row" base={'display:flex; align-items:center; gap:9px; border-radius:11px; padding:6px 8px; background:' + ci.rowBg} hover="background:#F5F6F4">
                            <button type="button" onClick={ci.onClick} style={css('flex:1 1 auto; display:flex; align-items:center; gap:10px; min-width:0; border:none; background:none; padding:0; cursor:pointer; text-align:left')}>
                              <img src={ci.image} alt="" data-t="media" style={css('width:30px; height:30px; object-fit:cover; border-radius:8px; background:#E4EBDD; flex:0 0 auto')} />
                              <span style={css('flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:1px')}>
                                <span style={css('overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13.5px; font-weight:500; color:' + ci.ink)}>{ci.name}</span>
                                <span style={css('font-size:10.5px; color:#8C9384')}>{ci.meta}</span>
                              </span>
                            </button>
                            {V.isOwner && (
                              <span data-t="edge" style={css('display:inline-flex; align-items:center; border:1px solid #E4EBDD; border-radius:999px; overflow:hidden')}>
                                <El as="button" type="button" onClick={ci.onEdit} title="Edit" base="display:inline-flex; align-items:center; justify-content:center; width:21px; height:20px; border:none; background:none; color:#7C8474; cursor:pointer; font-size:10px" hover="background:#478047; color:#FFFFFF">✎</El>
                                <span data-t="edge" style={css('width:1px; align-self:stretch; background:#E4EBDD')}></span>
                                <El as="button" type="button" onClick={ci.onDelete} title="Delete" base="display:inline-flex; align-items:center; justify-content:center; width:21px; height:20px; border:none; background:none; color:#7C8474; cursor:pointer; font-size:10px" hover="background:#B3543E; color:#FFFFFF">✕</El>
                              </span>
                            )}
                          </El>
                        ))}
                        {V.isOwner && (
                          <El as="button" type="button" onClick={c.onAddCity} base="margin-top:6px; display:flex; align-items:center; border:1px solid transparent; background:#E4EBDD; color:#478047; border-radius:11px; padding:7px 10px; font-size:12.5px; font-weight:500; text-align:left; cursor:pointer" hover="background:#DCE3D6; border-color:#B7DAB7">{V.L.addCity}</El>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </aside>
          )}

          <main data-t="app" style={css('flex:1 1 auto; overflow-y:auto; min-width:0; background:#F5F6F4')}>
            {V.isSearching && (
              <div style={css('padding:34px 40px 60px; animation:tripsFade 0.25s ease')}>
                <div style={css('display:flex; align-items:baseline; gap:12px; margin-bottom:22px')}>
                  <h2 data-t="ink" style={css("margin:0; font-family:'Work Sans',sans-serif; font-weight:400; font-size:30px; color:#26291F")}>{V.resultsTitle}</h2>
                  <button data-t="accent" type="button" onClick={V.clearQuery} className="trips-noprint" style={css('border:none; background:none; color:#5FA05F; font-size:13px; cursor:pointer')}>{V.L.clear}</button>
                </div>
                <div style={css('display:flex; flex-direction:column; gap:10px; max-width:900px')}>
                  {V.results.map((r) => (
                    <El key={r.id} as="button" data-t="card" type="button" onClick={r.onClick} base="display:flex; align-items:center; gap:16px; text-align:left; border:1px solid #E4EBDD; background:#FFFFFF; border-radius:14px; padding:12px; cursor:pointer" hover="border-color:#5FA05F">
                      <img src={r.image} alt="" data-t="media" style={css('width:88px; height:64px; object-fit:cover; border-radius:9px; background:#E4EBDD; flex:0 0 auto')} />
                      <span style={css('flex:1 1 auto; min-width:0; display:flex; flex-direction:column; gap:4px')}>
                        <span data-t="ink" style={css("font-family:'Work Sans',sans-serif; font-weight:600; font-size:19px; color:#26291F")}>{r.name}</span>
                        <span style={css('font-size:12px; letter-spacing:0.06em; text-transform:uppercase; color:#7C8474')}>{r.where}</span>
                        <span style={css('font-size:13px; color:#7C8474; line-height:1.5; overflow:hidden; display:block; max-height:40px')}>{r.snippet}</span>
                      </span>
                    </El>
                  ))}
                </div>
                {V.noResults && <p style={css('color:#7C8474; font-style:italic')}>{V.L.noResults}</p>}
              </div>
            )}

            {V.showOverview && (
              <div style={css('padding:0 0 70px; animation:tripsFade 0.25s ease')}>
                <div data-t="pad" style={css('padding:44px 40px 30px; max-width:760px')}>
                  <p style={css('margin:0 0 10px; font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:#7C8474')}>{V.L.eyebrow}</p>
                  <h1 data-t="ink" style={css("margin:0 0 14px; font-family:'Work Sans',sans-serif; font-weight:400; font-size:46px; line-height:1.05; letter-spacing:-0.015em; color:#26291F")}>{V.L.headline}</h1>
                  <p style={css('margin:0; font-size:15.5px; line-height:1.6; color:#7C8474; text-wrap:pretty')}>{V.overviewSummary}</p>
                </div>

                {V.chapters.map((ch) => (
                  <section key={ch.id} data-t="pad" style={css('padding:8px 40px 34px')}>
                    <div data-t="edge" style={css('display:flex; align-items:center; gap:14px; padding-bottom:12px; margin-bottom:20px; border-bottom:1px solid #DCE3D6')}>
                      <img src={ch.flag} alt="" data-t="media" style={css('width:38px; height:26px; object-fit:cover; border-radius:3px; background:#E4EBDD')} />
                      <h2 data-t="ink" style={css("margin:0; font-family:'Work Sans',sans-serif; font-weight:400; font-size:26px; color:#26291F")}>{ch.name}</h2>
                      <span style={css('font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#7C8474')}>{ch.meta}</span>
                      <span style={css('flex:1 1 auto')}></span>
                      {V.isOwner && (
                        <El as="button" data-t="ghost" type="button" onClick={ch.onAddCity} className="trips-noprint" base="border:1px solid #DCE3D6; background:#FFFFFF; border-radius:999px; padding:6px 14px; font-size:12.5px; color:#7C8474; cursor:pointer" hover="border-color:#5FA05F; color:#5FA05F">{V.L.addCity}</El>
                      )}
                    </div>
                    <div style={css('display:grid; grid-template-columns:repeat(auto-fill, minmax(268px, 1fr)); gap:22px')}>
                      {ch.cities.map((ci) => (
                        <El key={ci.id} as="button" data-t="card" type="button" onClick={ci.onClick} base="display:flex; flex-direction:column; text-align:left; padding:0; border:1px solid #E4EBDD; border-radius:16px; overflow:hidden; background:#FFFFFF; cursor:pointer; transition:transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease" hover="transform:translateY(-3px); box-shadow:0 14px 30px rgba(26,29,22,0.18)">
                          <span data-t="media" style={css('display:block; position:relative; aspect-ratio:4/3; background:#E4EBDD')}>
                            <img src={ci.image} alt="" style={css('width:100%; height:100%; object-fit:cover; display:block')} />
                            <span style={css('position:absolute; left:12px; bottom:12px; display:flex; gap:6px')}>
                              <span style={css('background:rgba(26,29,22,0.72); color:#FFFFFF; border-radius:999px; padding:4px 10px; font-size:11px; letter-spacing:0.06em; text-transform:uppercase')}>{ci.count}</span>
                            </span>
                          </span>
                          <span style={css('display:flex; flex-direction:column; gap:5px; padding:14px 16px 17px')}>
                            <span data-t="ink" style={css("font-family:'Work Sans',sans-serif; font-weight:600; font-size:22px; line-height:1.15; color:#26291F")}>{ci.name}</span>
                            <span data-t="rule" style={css('height:3px; border-radius:3px; background:#E4EBDD; display:block; overflow:hidden')}>
                              <span style={css('display:block; height:100%; width:' + ci.progress + '; background:' + V.tealBar)}></span>
                            </span>
                          </span>
                        </El>
                      ))}
                    </div>
                  </section>
                ))}

                {V.isOwner && (
                  <div data-t="pad" style={css('padding:4px 40px')}>
                    <El as="button" data-t="dashed" type="button" onClick={V.addCountry} className="trips-noprint" base="border:1px dashed #DCE3D6; background:none; border-radius:14px; padding:16px 22px; font-size:13.5px; color:#7C8474; cursor:pointer" hover="border-color:#5FA05F; color:#5FA05F">{V.L.addCountry}</El>
                  </div>
                )}
              </div>
            )}

            {V.showCity && (
              <div style={css('animation:tripsFade 0.25s ease')}>
                <div data-t="hero" style={css('position:relative; height:280px; background:#E4EBDD; overflow:hidden')}>
                  <img src={V.city.image} alt="" style={css('width:100%; height:100%; object-fit:cover; display:block')} />
                  <div style={css('position:absolute; inset:0; background:linear-gradient(to top, rgba(26,29,22,0.85) 0%, rgba(26,29,22,0.24) 55%, rgba(26,29,22,0.05) 100%)')}></div>
                  <div data-t="hero-in" style={css('position:absolute; left:40px; right:40px; bottom:24px; display:flex; align-items:flex-end; gap:20px')}>
                    <div style={css('flex:1 1 auto; min-width:0')}>
                      <El as="button" type="button" onClick={V.goHome} className="trips-noprint" base="border:none; background:none; padding:0; color:rgba(255,255,255,0.8); font-size:11.5px; letter-spacing:0.14em; text-transform:uppercase; cursor:pointer; margin-bottom:8px" hover="color:#FFFFFF">{V.city.crumb}</El>
                      <h1 data-t="hero-title" style={css("margin:0; font-family:'Work Sans',sans-serif; font-weight:400; font-size:52px; line-height:1; color:#FFFFFF; letter-spacing:-0.02em")}>{V.city.name}</h1>
                    </div>
                    <div style={css('flex:0 0 auto; display:flex; align-items:center; gap:10px; color:#FFFFFF')}>
                      <span style={css('font-size:13px; letter-spacing:0.06em; text-transform:uppercase; opacity:0.85')}>{V.city.meta}</span>
                    </div>
                  </div>
                </div>

                <div data-t="pad toolbar" style={css('display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:16px 40px; border-bottom:1px solid #DCE3D6; background:#F5F6F4; position:sticky; top:0; z-index:4')}>
                  <div data-t="panel" className="trips-noprint" style={css('display:flex; gap:4px; padding:3px; background:#F5F6F4; border:1px solid #E4EBDD; border-radius:999px')}>
                    <button type="button" onClick={V.setViewGrid} style={css(V.viewGridStyle)}>{V.L.grid}</button>
                    <button type="button" onClick={V.setViewList} style={css(V.viewListStyle)}>{V.L.list}</button>
                    <button type="button" onClick={V.setViewMap} style={css(V.viewMapStyle)}>{V.L.map}</button>
                  </div>
                  <span style={css('flex:1 1 auto')}></span>
                  <El as="button" data-t="ghost" type="button" onClick={V.shareCity} className="trips-noprint" base="border:1px solid #DCE3D6; background:#FFFFFF; border-radius:999px; padding:8px 16px; font-size:13px; color:#7C8474; cursor:pointer" hover="border-color:#5FA05F; color:#5FA05F">{V.L.share}</El>
                  <El as="button" data-t="ghost" type="button" onClick={V.printCity} className="trips-noprint" base="border:1px solid #DCE3D6; background:#FFFFFF; border-radius:999px; padding:8px 16px; font-size:13px; color:#7C8474; cursor:pointer" hover="border-color:#5FA05F; color:#5FA05F">{V.L.pdf}</El>
                  {V.isOwner && (
                    <button data-t="accentbtn" type="button" onClick={V.addLandmark} className="trips-noprint" style={css('border:1px solid #5FA05F; background:#5FA05F; color:#FFFFFF; border-radius:999px; padding:8px 18px; font-size:13px; font-weight:500; cursor:pointer')}>{V.L.addPlace}</button>
                  )}
                </div>

                <div data-t="pad city-row" style={css('display:flex; align-items:flex-start; gap:32px; padding:28px 40px 70px')}>
                  <div style={css('flex:1 1 auto; min-width:0')}>
                    {V.isMap && (
                      <CityMap L={V.L} pl={this.pl} mode={V.theme} city={V.mapCity} />
                    )}

                    {V.isCards && (
                      <div style={css('display:flex; flex-direction:column; gap:34px')}>
                        {V.groups.map((g, gi) => (
                          <section key={gi}>
                            {g.showTitle && (
                              <div style={css('display:flex; align-items:baseline; gap:12px; margin-bottom:16px')}>
                                <h3 data-t="ink" style={css("margin:0; font-family:'Work Sans',sans-serif; font-weight:400; font-size:22px; color:#26291F")}>{g.title}</h3>
                                <span data-t="rule" style={css('flex:1 1 auto; height:1px; background:#DCE3D6')}></span>
                                <span style={css('font-size:11.5px; letter-spacing:0.1em; text-transform:uppercase; color:#7C8474')}>{g.count}</span>
                              </div>
                            )}

                            <div style={css('display:' + g.display + '; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); flex-direction:column; gap:' + g.gap)}>
                              {g.items.map((lm) => (
                                <article key={lm.id} data-t="card" draggable={V.isOwner} onDragStart={V.isOwner ? lm.onDragStart : undefined} onDragOver={V.isOwner ? lm.onDragOver : undefined} onDragEnd={V.isOwner ? lm.onDragEnd : undefined} style={css(lm.cardStyle)}>
                                  <div data-t="media" style={css(lm.mediaStyle)}>
                                    <img src={lm.image} alt={lm.name} onClick={lm.onPreview} style={css(lm.imgStyle)} />
                                    {V.isOwner && (
                                      <div className="trips-noprint" style={css('position:absolute; top:9px; right:9px; display:flex; gap:5px')}>
                                        <El as="button" type="button" onClick={lm.onEdit} title="Edit" base="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border:none; border-radius:999px; background:#FFFFFF; color:#26291F; font-size:12px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.18); transition:transform .12s ease, color .12s ease" hover="color:#478047; transform:scale(1.08)">✎</El>
                                        <El as="button" type="button" onClick={lm.onDelete} title="Delete" base="display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border:none; border-radius:999px; background:#FFFFFF; color:#26291F; font-size:12px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.18); transition:transform .12s ease, color .12s ease" hover="color:#B3543E; transform:scale(1.08)">✕</El>
                                      </div>
                                    )}
                                  </div>
                                  <div style={css(lm.bodyStyle)}>
                                    <div style={css('display:flex; align-items:baseline; gap:10px')}>
                                      <h4 data-t="ink" style={css("margin:0; font-family:'Work Sans',sans-serif; font-weight:400; font-size:19.5px; line-height:1.2; flex:1 1 auto; color:#26291F")}>{lm.name}</h4>
                                      <span style={css('font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#8C9384; flex:0 0 auto')}>{lm.index}</span>
                                    </div>
                                    <p style={css('margin:0; font-size:13.5px; line-height:1.6; color:#7C8474; text-wrap:pretty')}>{lm.description}</p>
                                    <div className="trips-noprint" style={css('display:flex; align-items:center; gap:8px; margin-top:2px')}>
                                      {V.isOwner && <span style={css('font-size:11px; color:#8C9384; cursor:grab; white-space:nowrap')}>⠿ {V.L.drag}</span>}
                                      <span style={css('flex:1 1 auto')}></span>
                                      {lm.hasMapLink && (
                                        <El as="a" href={lm.mapUrl} target="_blank" rel="noopener" base="display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:#5FA05F; text-decoration:none; white-space:nowrap; flex:0 0 auto" hover="color:#478047">📍 {V.L.viewOnMap}</El>
                                      )}
                                    </div>
                                  </div>
                                </article>
                              ))}
                            </div>
                          </section>
                        ))}
                      </div>
                    )}

                    {V.cityEmpty && <p style={css('color:#7C8474; font-style:italic; padding:40px 0; text-align:center')}>{V.L.emptyCity}</p>}
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        {V.dialogOpen && (
          <div onClick={V.closeDialog} style={css('position:fixed; inset:0; background:rgba(26,29,22,0.6); display:flex; align-items:center; justify-content:center; padding:24px; z-index:50')}>
            <div data-t="panel" onClick={V.stop} style={css('width:100%; max-width:460px; max-height:calc(100vh - 48px); overflow-y:auto; background:#FFFFFF; border:1px solid #DCE3D6; border-radius:20px; padding:26px 26px 22px; box-shadow:0 26px 60px rgba(26,29,22,0.4)')}>
              <h2 data-t="ink" style={css("margin:0 0 18px; font-family:'Work Sans',sans-serif; font-weight:400; font-size:26px; color:#26291F")}>{V.dialog.title}</h2>
              <label style={css('display:block; margin-bottom:14px')}>
                <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#7C8474')}>{V.dialog.nameLabel}</span>
                <El as="input" data-t="input" type="text" value={V.dialog.name} onChange={V.onDialogName} placeholder={V.dialog.namePlaceholder} base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #E4EBDD; border-radius:11px; background:#FFFFFF; color:#26291F; font-size:14px; outline:none" focus="border-color:#5FA05F" />
              </label>
              <label style={css('display:block; margin-bottom:14px')}>
                <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#7C8474')}>{V.dialog.imageLabel}</span>
                <El as="input" data-t="input" type="url" value={V.dialog.image} onChange={V.onDialogImage} placeholder="https://…" base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #E4EBDD; border-radius:11px; background:#FFFFFF; color:#26291F; font-size:14px; outline:none" focus="border-color:#5FA05F" />
              </label>
              {V.dialog.withDescription && (
                <>
                  <label style={css('display:block; margin-bottom:14px')}>
                    <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#7C8474')}>{V.L.descriptionHy}</span>
                    <El as="textarea" data-t="input" value={V.dialog.description} onChange={V.onDialogDescription} rows={3} base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #E4EBDD; border-radius:11px; background:#FFFFFF; color:#26291F; font-size:14px; line-height:1.55; resize:vertical; outline:none" focus="border-color:#5FA05F" />
                  </label>
                  <label style={css('display:block; margin-bottom:14px')}>
                    <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#7C8474')}>{V.L.descriptionEn}</span>
                    <El as="textarea" data-t="input" value={V.dialog.descriptionEn} onChange={V.onDialogDescriptionEn} rows={3} base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #E4EBDD; border-radius:11px; background:#FFFFFF; color:#26291F; font-size:14px; line-height:1.55; resize:vertical; outline:none" focus="border-color:#5FA05F" />
                  </label>
                  <label style={css('display:block; margin-bottom:14px')}>
                    <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#7C8474')}>{V.L.descriptionRu}</span>
                    <El as="textarea" data-t="input" value={V.dialog.descriptionRu} onChange={V.onDialogDescriptionRu} rows={3} base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #E4EBDD; border-radius:11px; background:#FFFFFF; color:#26291F; font-size:14px; line-height:1.55; resize:vertical; outline:none" focus="border-color:#5FA05F" />
                  </label>
                  <label style={css('display:block; margin-bottom:14px')}>
                    <span style={css('display:block; margin-bottom:6px; font-size:12px; letter-spacing:0.08em; text-transform:uppercase; color:#7C8474')}>{V.L.coordinates}</span>
                    <El as="input" data-t="input" type="text" value={V.dialog.coords} onChange={V.onDialogCoords} placeholder={'39°28\'12.0"N 0°22\'12.0"W'} base="width:100%; box-sizing:border-box; padding:10px 12px; border:1px solid #E4EBDD; border-radius:11px; background:#FFFFFF; color:#26291F; font-size:14px; outline:none" focus="border-color:#5FA05F" />
                    {V.dialog.coordsError && (
                      <span style={css('display:block; margin-top:5px; font-size:12px; color:#B3543E')}>{V.L.coordsInvalid}</span>
                    )}
                  </label>
                </>
              )}
              {V.dialog.hasPreview && (
                <div data-t="media" style={css('margin-bottom:16px; border:1px solid #E4EBDD; border-radius:12px; overflow:hidden; background:#E4EBDD')}>
                  <img src={V.dialog.image} alt="" style={css('width:100%; max-height:170px; object-fit:cover; display:block')} />
                </div>
              )}
              <div style={css('display:flex; justify-content:flex-end; gap:10px')}>
                <El as="button" data-t="ghost" type="button" onClick={V.closeDialog} base="border:1px solid #DCE3D6; background:none; border-radius:999px; padding:9px 18px; font-size:13.5px; color:#7C8474; cursor:pointer" hover="border-color:#26291F; color:#26291F">{V.L.cancel}</El>
                <button data-t="accentbtn" type="button" onClick={V.submitDialog} style={css('border:1px solid #5FA05F; background:#5FA05F; color:#FFFFFF; border-radius:999px; padding:9px 20px; font-size:13.5px; font-weight:500; cursor:pointer')}>{V.dialog.submitLabel}</button>
              </div>
            </div>
          </div>
        )}

        {V.confirmOpen && (
          <div onClick={V.closeConfirm} style={css('position:fixed; inset:0; background:rgba(26,29,22,0.6); display:flex; align-items:center; justify-content:center; padding:24px; z-index:60')}>
            <div data-t="panel" onClick={V.stop} style={css('width:100%; max-width:380px; background:#FFFFFF; border:1px solid #DCE3D6; border-radius:20px; padding:24px; box-shadow:0 26px 60px rgba(26,29,22,0.4)')}>
              <p data-t="ink" style={css('margin:0 0 20px; font-size:15px; line-height:1.55; color:#26291F')}>{V.confirmMessage}</p>
              <div style={css('display:flex; justify-content:flex-end; gap:10px')}>
                <El as="button" data-t="ghost" type="button" onClick={V.closeConfirm} base="border:1px solid #DCE3D6; background:none; border-radius:999px; padding:9px 18px; font-size:13.5px; color:#7C8474; cursor:pointer" hover="border-color:#26291F; color:#26291F">{V.L.cancel}</El>
                <button data-t="accentbtn" type="button" onClick={V.runConfirm} style={css('border:1px solid #5FA05F; background:#5FA05F; color:#FFFFFF; border-radius:999px; padding:9px 20px; font-size:13.5px; font-weight:500; cursor:pointer')}>{V.L.delete}</button>
              </div>
            </div>
          </div>
        )}

        {V.lightboxOpen && (
          <div onClick={V.closeLightbox} style={css('position:fixed; inset:0; background:rgba(18,20,14,0.92); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:36px; z-index:70; cursor:zoom-out')}>
            <img src={V.lightbox.src} alt={V.lightbox.alt} style={css('max-width:88vw; max-height:80vh; object-fit:contain; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,0.6)')} />
            <p style={css("margin:0; color:#FFFFFF; font-family:'Work Sans',sans-serif; font-weight:600; font-size:20px")}>{V.lightbox.alt}</p>
          </div>
        )}
      </div>
    )
  }
}
