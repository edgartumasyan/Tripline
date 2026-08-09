import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { COORDS } from '../coords.js'

// Esri World Imagery — free satellite basemap, no key required. Note the tile
// order is {z}/{y}/{x} (not {x}/{y}) and there are no subdomains. Satellite is
// the only basemap; it's theme-agnostic, so the page theme doesn't affect it.
const SATELLITE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

// Leaflet view of a city's landmarks. Pins are numbered by their position in the
// itinerary (pin colours use the page's own CSS variables, so they follow the
// theme automatically). Landmarks with no entry in COORDS are simply left off,
// and the caption says how many.
export default function CityMap({ L: labels, pl, city }) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const map = L.map(elRef.current, { scrollWheelZoom: true })
    mapRef.current = map
    L.tileLayer(SATELLITE_URL, {
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      maxZoom: 19,
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
    }
  }, [])

  // Only rebuild the pins when something they depict actually changes —
  // otherwise every unrelated edit would re-fit the viewport under the user.
  const signature = `${city.id}|${city.landmarks
    .map((lm) => lm.id + (lm.visited ? '1' : '0'))
    .join(',')}`
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
      // Visited places take the teal pin; still-to-visit ones stay accent green.
      const color = lm.visited ? 'var(--teal)' : 'var(--accent)'
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
