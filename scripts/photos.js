// Keeps every photo in data.json as a file in public/photos/ instead of a link to
// somebody else's server. Image hosts do go dead (an images.openai.com link for
// Scuola Grande di San Rocco 404'd within weeks), and a link can't be restored
// once its host drops it — a file committed to the repo can.
//
// savePhotos() walks the data, downloads each remote image (and decodes each
// data: URI) to public/photos/, and rewrites the field to the relative path,
// which resolves against the page at /Tripline/ both in dev and on GitHub Pages.
// The bytes are written exactly as received: no resizing or re-encoding, so the
// saved copy is the original at its original quality.
//
// Used two ways:
//   - by the /api/data PUT in vite.config.js, so a link pasted in the dialog is
//     saved as a file the moment the edit is saved;
//   - from the command line (`npm run photos`) to convert data.json in one go.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const DATA_FILE = path.join(ROOT, 'src/data.json')
const PUBLIC_DIR = path.join(ROOT, 'public')
const PHOTOS = 'photos'

// Some hosts (Tripadvisor, a few CDNs) answer a bare Node fetch with 403 but
// serve a browser happily. Wikimedia is the opposite: its policy wants scripts
// to say who they are, and it answers a script posing as Chrome with a 429
// every time, however slowly it asks.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const HONEST_UA = 'Tripline/1.0 (https://github.com/edgartumasyan/Tripline)'
const userAgent = (url) => /(^|\.)wikimedia\.org$/.test(new URL(url).hostname) ? HONEST_UA : BROWSER_UA

export const isSaved = (src) => typeof src === 'string' && src.startsWith(PHOTOS + '/')

// Name the extension from the bytes, not the URL or Content-Type: half these
// URLs have no extension at all, and some hosts answer a dead image with a 200
// HTML page, which this rejects instead of saving as a .jpg.
function sniff(buf) {
  const b = buf.subarray(0, 12)
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.toString('hex', 0, 8) === '89504e470d0a1a0a') return 'png'
  if (b.toString('ascii', 0, 4) === 'GIF8') return 'gif'
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (b.toString('ascii', 4, 8) === 'ftyp') return 'avif'
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(buf.subarray(0, 256).toString('utf8'))) return 'svg'
  return null
}

// A 429 or the odd 5xx can clear up after a pause; anything else (403, 404)
// won't, so fail fast. Kept to two short retries because the dev server's
// first save of a session waits on this for every link that's still failing.
async function download(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': userAgent(url) }, signal: AbortSignal.timeout(45000) })
    if (res.ok) return Buffer.from(await res.arrayBuffer())
    if (attempt < 2 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt))
      continue
    }
    throw new Error('HTTP ' + res.status)
  }
}

async function fetchBytes(src) {
  if (src.startsWith('data:')) {
    const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(src)
    if (!m) throw new Error('unreadable data: URI')
    return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]))
  }
  return download(src)
}

// Every image-bearing field, with the file name it should be saved under.
// Grouped by country/city so the folder reads like the app; the content hash in
// the name means a replaced photo gets a new URL, so no browser or CDN can keep
// showing the old one from cache.
function slots(data) {
  const out = []
  for (const c of data.countries || []) {
    out.push({ obj: c, key: 'flag', base: `${c.id}/flag`, label: c.name })
    for (const ci of c.cities || []) {
      out.push({ obj: ci, key: 'image', base: `${c.id}/${ci.id}/cover`, label: `${c.name} / ${ci.name}` })
      for (const lm of ci.landmarks || []) {
        out.push({ obj: lm, key: 'image', base: `${c.id}/${ci.id}/${lm.id}`, label: `${c.name} / ${ci.name} / ${lm.name}` })
      }
    }
  }
  return out
}

// Rewrites `data` in place. `cache` maps a source URL to the path it was saved
// under, so the dev server — which gets the same pasted URL back on every save
// until the page picks up the rewritten data — downloads it only once.
// A source that can't be fetched keeps its original link (the edit still
// saves, and the photo still shows while the host lives) and is reported. It's
// cached as a failure too: with retries a dead host can take a minute to give
// up, and every later save would otherwise sit through that again. Restarting
// the dev server clears it.
export async function savePhotos(data, { cache = new Map(), concurrency = 4, log = () => {} } = {}) {
  const todo = slots(data).filter((s) => s.obj[s.key] && !isSaved(s.obj[s.key]))
  const failed = []
  let saved = 0, next = 0
  const worker = async () => {
    while (next < todo.length) {
      const s = todo[next++]
      const src = s.obj[s.key]
      if (cache.has(src)) {
        if (cache.get(src)) s.obj[s.key] = cache.get(src)
        continue
      }
      try {
        const bytes = await fetchBytes(src)
        const ext = sniff(bytes)
        if (!ext) throw new Error('not an image')
        const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 8)
        const rel = `${PHOTOS}/${s.base}-${hash}.${ext}`
        const file = path.join(PUBLIC_DIR, rel)
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, bytes)
        cache.set(src, rel)
        s.obj[s.key] = rel
        saved++
        log(`saved   ${s.label}  →  ${rel}  (${Math.round(bytes.length / 1024)} KB)`)
      } catch (err) {
        cache.set(src, null)
        failed.push({ label: s.label, src, reason: err.message })
        log(`FAILED  ${s.label}  (${err.message})  ${src.slice(0, 100)}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return { saved, failed }
}

// Deletes every file under public/photos/ that data no longer points at — the
// old photo when one is replaced, all of a place's when it's deleted — then any
// folder that leaves empty. Run only after the data has been written, so a
// failed save can never cost a photo.
export async function prunePhotos(data, { log = () => {} } = {}) {
  const used = new Set(slots(data).map((s) => s.obj[s.key]).filter(isSaved))
  const dir = path.join(PUBLIC_DIR, PHOTOS)
  let removed = 0
  const walk = async (abs) => {
    let entries
    try { entries = await fs.readdir(abs, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const full = path.join(abs, e.name)
      if (e.isDirectory()) {
        await walk(full)
        if ((await fs.readdir(full)).length === 0) await fs.rmdir(full)
      } else {
        const rel = path.relative(PUBLIC_DIR, full).split(path.sep).join('/')
        if (!used.has(rel)) { await fs.unlink(full); removed++; log(`deleted ${rel}`) }
      }
    }
  }
  await walk(dir)
  return removed
}

export async function writeData(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2) + '\n')
}

// `npm run photos`: convert everything in data.json, then list what couldn't be
// saved so those places can get a new link.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = JSON.parse(await fs.readFile(DATA_FILE, 'utf-8'))
  const { saved, failed } = await savePhotos(data, { log: console.log })
  await writeData(data)
  const removed = await prunePhotos(data, { log: console.log })
  console.log(`\n${saved} saved, ${removed} unused deleted, ${failed.length} failed`)
  for (const f of failed) console.log(`  ${f.label} — ${f.reason}\n    ${f.src.slice(0, 160)}`)
  process.exitCode = failed.length ? 1 : 0
}
