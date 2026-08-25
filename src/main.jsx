import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// The service-worker registration vite-plugin-pwa injects only *registers* the
// worker. With skipWaiting + clientsClaim a new deploy activates right away and
// claims this tab, but the tab keeps running the JS bundle it booted from — so a
// fresh deploy stays invisible (missing new buttons, old data) until the app is
// killed and relaunched, which an installed home-screen PWA rarely really does.
// Reload once when a new worker takes control. Guarded on there already being a
// controller, since controllerchange also fires on the very first registration
// (no stale bundle to escape there — reloading would just be a wasted flash).
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
