import bundled from './data.json'

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

// Load the data from the dev API. Falls back to the JSON bundled at build time
// (e.g. in a production preview where the dev API isn't running).
export async function loadData() {
  try {
    const res = await fetch(API)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch {
    return structuredClone(bundled)
  }
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
