import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

const DATA_FILE = fileURLToPath(new URL('./src/data.json', import.meta.url))

// Dev-only API that reads and writes src/data.json, so all countries/cities/
// landmarks live in that single JSON file instead of the browser.
//   GET  /api/data  -> current JSON
//   PUT  /api/data  -> overwrite with the request body (validated JSON)
function dataApi() {
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
            await fs.writeFile(DATA_FILE, JSON.stringify(parsed, null, 2) + '\n')
            res.statusCode = 204
            res.end()
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
      injectRegister: 'auto',
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
})
