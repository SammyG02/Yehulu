import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Capacitor } from '@capacitor/core'
import '@fontsource-variable/manrope'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './state/auth.jsx'
import { ConfirmProvider } from './state/confirm.jsx'
import { SavingsProvider } from './state/savings.jsx'
import { ThemeProvider } from './state/theme.jsx'

if (Capacitor.isNativePlatform()) {
  // The native app ships its files inside it, so it needs no service worker.
  import('./native.js').then((m) => m.setupNative())
} else if (import.meta.env.PROD) {
  // Lets the site open offline once it has been visited (and after "Add to Home Screen").
  // A home-screen app can stay open for days, so look for a new version each
  // time it comes back to the front (and hourly); a new one reloads the page.
  import('virtual:pwa-register').then((m) => m.registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => { if (navigator.onLine) registration.update().catch(() => {}) }
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
      setInterval(check, 60 * 60 * 1000)
    },
  }))
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
