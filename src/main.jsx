import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import './index.css'

// The browser only looks for a new service worker when the page *navigates* —
// that is, when serviceWorker.register() runs on a fresh load. An installed
// home-screen PWA almost never navigates: switching away and back just resumes
// the suspended page, so nothing ever asks whether a new version was deployed,
// and the app keeps serving the bundle it booted from until it is force-killed
// and relaunched. Ask for the check ourselves whenever the app comes back to
// the foreground (and hourly while it stays open), so returning to it after a
// deploy is enough to pick the new version up.
//
// registerType 'autoUpdate' does the rest: the new worker skips waiting, claims
// this page, and registerSW reloads once on 'activated'. The reload is cheap
// here because App restores the open country/city from localStorage
// ('trips.nav'), so the user lands back where they were.
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return

    let checking = false
    const checkForUpdate = async () => {
      // Skip while backgrounded or offline — update() would only fail, and the
      // visibilitychange listener fires again on the way back in.
      if (checking || document.hidden || navigator.onLine === false) return
      checking = true
      try {
        await registration.update()
      } catch (e) {
        // Offline or the deploy is mid-flight: the next check picks it up.
      } finally {
        checking = false
      }
    }

    document.addEventListener('visibilitychange', checkForUpdate)
    window.addEventListener('online', checkForUpdate)
    // Backgrounded timers are throttled or frozen, which is fine: this only has
    // to cover the app being left open in the foreground for a long time.
    setInterval(checkForUpdate, 60 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
