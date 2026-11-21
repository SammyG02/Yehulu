import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Capacitor } from '@capacitor/core'
import '@fontsource-variable/manrope'
import './index.css'
// Catches Android's install prompt as early as possible.
import './lib/install.js'
import App from './App.jsx'
import { AuthProvider } from './state/auth.jsx'
import { ConfirmProvider } from './state/confirm.jsx'
import { SavingsProvider } from './state/savings.jsx'
import { ThemeProvider } from './state/theme.jsx'

if (Capacitor.isNativePlatform()) {
  // The native app ships its files inside it, so it needs no service worker.
  import('./native.js').then((m) => m.setupNative())
} else if (import.meta.env.PROD) {
  // No offline copy: remove the old service worker and its cache from phones
  // that still have one.
  navigator.serviceWorker?.getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {})
  window.caches?.keys()
    .then((names) => names.forEach((n) => window.caches.delete(n)))
    .catch(() => {})

  // A home-screen app can stay open for days. When it comes back to the front,
  // see whether a new version is out and reload if so.
  const current = document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src')
  const check = async () => {
    if (!current || !navigator.onLine) return
    try {
      const html = await (await fetch('/', { cache: 'no-store' })).text()
      const latest = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
      if (latest && latest !== current) window.location.reload()
    } catch { /* offline or blocked: try again next time */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ConfirmProvider>
            <SavingsProvider>
              <App />
            </SavingsProvider>
          </ConfirmProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
