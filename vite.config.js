import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'
import { savePhotos, prunePhotos, writeData } from './scripts/photos.js'

const DATA_FILE = fileURLToPath(new URL('./src/data.json', import.meta.url))

// Dev-only API that reads and writes src/data.json, so all countries/cities/
// landmarks live in that single JSON file instead of the browser.
//   GET  /api/data  -> current JSON
//   PUT  /api/data  -> save the request body (validated JSON), with any newly
//                      pasted image links downloaded into public/photos/ (see
//                      scripts/photos.js); answers with the data as written,
//                      so the page can pick up the rewritten photo paths
function dataApi() {
  // url -> saved path, so a pasted link is downloaded once however many saves
  // carry it before the page swaps in the rewritten data.
  const photoCache = new Map()
  // Saves now wait on downloads, so a second PUT can arrive mid-way through the
  // first. Run them in order, or the older body could land on disk last — and
  // its prune would delete the photos the newer one just saved.
  let queue = Promise.resolve()
  return {
    name: 'trips-data-api',
    configureServer(server) {
      server.middlewares.use('/api/data', async (req, res) => {
        try {
          if (req.method === 'GET') {
            const text = await fs.readFile(DATA_FILE, 'utf-8')
            res.setHeader('Content-Type', 'application/json')
            res.end(text)
            return
          }
          if (req.method === 'PUT' || req.method === 'POST') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            const body = Buffer.concat(chunks).toString('utf-8')
            const parsed = JSON.parse(body) // throws on invalid JSON
            const log = (msg) => server.config.logger.info('[photos] ' + msg, { timestamp: true })
            const run = queue.then(async () => {
              await savePhotos(parsed, { cache: photoCache, log })
              await writeData(parsed)
              await prunePhotos(parsed, { log })
            })
            queue = run.catch(() => {})
            await run
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(parsed))
            return
          }
          res.statusCode = 405
          res.end('Method Not Allowed')
        } catch (err) {
          res.statusCode = 500
          res.end(String(err))
        }
      })
    },
  }
}

export default defineConfig({
  // Served from https://edgartumasyan.github.io/Tripline/ on GitHub Pages.
  base: '/Tripline/',
  // src/data.json is imported as a module (storage.js) but is also rewritten at
  // runtime by the dataApi PUT above. Without this, every save would change a
  // watched module, trigger an HMR full-page reload, and bounce the user back to
  // the home screen (losing the open city/landmark). The app already holds the
  // saved data in memory, so the reload is pure loss — ignore the file.
  server: { watch: { ignored: ['**/src/data.json'] } },
  plugins: [
    react(),
    dataApi(),
    // Installable, auto-updating PWA. registerType 'autoUpdate' + skipWaiting/
    // clientsClaim means a new deploy is picked up and applied on the next launch
    // (with network) without the manual clear-cache dance on the home-screen app.
    // The service worker is disabled in dev (devOptions.enabled defaults false),
    // so the dataApi middleware above keeps working normally while developing.
    VitePWA({
      registerType: 'autoUpdate',
      // null, not 'auto': main.jsx registers the worker itself via
      // virtual:pwa-register so it can hold the registration and trigger an
      // update check when the app is resumed. The script 'auto' would inject
      // registers once on load and never checks again.
      injectRegister: null,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Tripline',
        short_name: 'Tripline',
        description: 'Travel planning journal',
        theme_color: '#5FA05F',
        background_color: '#F5F6F4',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // 'json' matters: data.json is emitted as its own asset now (see
        // storage.js) rather than inlined into the JS, so it has to be
        // precached explicitly or the app would have no data offline.
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,json}'],
        // The saved photos (public/photos/) are hundreds of MB; precaching them
        // would make installing the app download every one. They load on
        // demand like any page image instead.
        globIgnores: ['photos/**'],
        // data.json is past workbox's 2 MiB default and only grows; over the
        // limit the build fails outright (that's what blocked the deploy of
        // #74), so leave it plenty of room.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
})
