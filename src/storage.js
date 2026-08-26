// '?url' rather than a plain import on purpose: importing the JSON inlines all
// ~430 KB of it into the main JS chunk, where it was the single largest thing in
// the bundle. As a URL, Vite emits it as its own content-hashed asset that is
// fetched at runtime and precached by the service worker (see globPatterns in
// vite.config.js), so offline still works and editing data no longer
// invalidates the app's JS.
import dataUrl from './data.json?url'

// All data lives in src/data.json, served and persisted by the dev-server API
// in vite.config.js. No browser storage is used.
const API = '/api/data'

// Build a URL-friendly id from a name, keeping it unique within `existing`.
export function makeId(name, existing = []) {
  const base =
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  let id = base
  let n = 2
  const taken = new Set(existing.map((e) => e.id))
  while (taken.has(id)) {
    id = `${base}-${n++}`
  }
  return id
}

// Load the data. In dev that means the writable dev-server API, which serves the
// live src/data.json; in a build it means the emitted data.json asset. The API
// is only tried under DEV because it is a dev-server middleware — in production
// the request could only ever 404.
export async function loadData() {
  if (import.meta.env.DEV) {
    try {
      const res = await fetch(API)
      if (res.ok) return await res.json()
    } catch {
      // Dev server gone mid-session; fall through to the built asset.
    }
  }
  const res = await fetch(dataUrl)
  if (!res.ok) throw new Error(`Could not load data.json: HTTP ${res.status}`)
  return await res.json()
}

// Persist the full dataset back to src/data.json via the dev API.
export async function saveData(data) {
  try {
    await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  } catch {
    // dev API unavailable (e.g. production preview); change stays in memory only
  }
}
