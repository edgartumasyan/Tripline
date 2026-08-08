import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { COORDS } from '../coords.js'

const TILE_URL = {
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
}

// Esri World Imagery — free satellite basemap, no key required. Note the tile
// order is {z}/{y}/{x} (not {x}/{y}) and there are no subdomains.
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// The base tile source for the current theme + basemap choice.
function tileConfig(mode, basemap) {
  if (basemap === 'satellite') {
    return {
      url: SATELLITE_URL,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    }
  }
  return {
    url: TILE_URL[mode] || TILE_URL.light,
    attribution: '© OpenStreetMap, © CARTO',
  }
}

// Leaflet view of a city's landmarks. Pins are numbered by their position in the
// itinerary (pin colours use the page's own CSS variables, so they follow the
// theme automatically). Landmarks with no entry in COORDS are simply left off,
// and the caption says how many.
export default function CityMap({ L: labels, pl, mode, city }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const tilesRef = useRef(null)
  const layerRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [basemap, setBasemap] = useState('map') // 'map' | 'satellite'

  useEffect(() => {
    const map = L.map(elRef.current, { scrollWheelZoom: true })
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
      tilesRef.current = null
      layerRef.current = null
    }
  }, [])

  // Rebuild the tile layer when the theme or the basemap choice changes. We
  // recreate rather than setUrl() so the attribution and tile scheme swap too.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    tilesRef.current?.remove()

    const { url, attribution } = tileConfig(mode, basemap)
    tilesRef.current = L.tileLayer(url, {
      attribution,
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map)
  }, [mode, basemap])

  // Only rebuild the pins when something they depict actually changes —
  // otherwise every unrelated edit would re-fit the viewport under the user.
  const signature = `${city.id}|${city.landmarks.map((lm) => lm.id).join(',')}`
  const cityRef = useRef(city)
  cityRef.current = city

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return

    layer.clearLayers()
    const points = []

    cityRef.current.landmarks.forEach((lm, i) => {
      const point = COORDS[lm.id]
      if (!point) return
      points.push(point)
      const color = 'var(--accent)'
      const icon = L.divIcon({
        className: '',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        html: `<div class="map-pin" style="background:${color}">${i + 1}</div>`,
      })
      // Build the popup as a node rather than an HTML string: place names are
      // user-typed and would otherwise be parsed as markup.
      const popup = document.createElement('strong')
      popup.textContent = lm.name
      L.marker(point, { icon }).addTo(layer).bindPopup(popup)
    })

    map.invalidateSize()
    if (points.length === 1) {
      // A lone located landmark: sit on it, but cap the zoom so we don't slam
      // to street level.
      map.setView(points[0], 14)
    } else if (points.length) {
      // Centre on the city — the centroid of its located places — then grow
      // the bounds symmetrically around that point so every pin stays in view
      // while the city itself stays dead centre.
      const lat = points.reduce((s, p) => s + p[0], 0) / points.length
      const lng = points.reduce((s, p) => s + p[1], 0) / points.length
      const dLat = Math.max(...points.map((p) => Math.abs(p[0] - lat)))
      const dLng = Math.max(...points.map((p) => Math.abs(p[1] - lng)))
      map.fitBounds(
        [
          [lat - dLat, lng - dLng],
          [lat + dLat, lng + dLng],
        ],
        { padding: [50, 50], maxZoom: 15 },
      )
    } else {
      map.setView([41.9, 12.5], 5)
    }
  }, [signature])

  // Re-measure after the container resizes (expand / collapse), or Leaflet
  // renders the tiles against the old dimensions.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.invalidateSize()
    const onKey = (e) => e.key === 'Escape' && setExpanded(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const mapped = city.landmarks.filter((lm) => COORDS[lm.id]).length
  const missing = city.landmarks.length - mapped

  return (
    <div className={`map-wrap${expanded ? ' expanded' : ''}`}>
      <div className="map-canvas" ref={elRef} />
      <div className="map-bar">
        <p className="map-note">
          {missing
            ? `${pl(mapped, 'places')} ${labels.pinnedSuffix} · ${missing} ${labels.needCoords}`
            : labels.allPinned}
        </p>
        <div className="segmented map-basemap trips-noprint">
          {[
            ['map', labels.map],
            ['satellite', labels.satellite],
          ].map(([value, label]) => (
            <button
              className={`pill${basemap === value ? ' on' : ''}`}
              type="button"
              key={value}
              onClick={() => setBasemap(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="map-expand trips-noprint"
          type="button"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? `⤡ ${labels.collapse}` : `⤢ ${labels.expand}`}
        </button>
      </div>
    </div>
  )
}
