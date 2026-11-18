import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Capacitor } from '@capacitor/core'
import '@fontsource-variable/manrope'
import './index.css'
import App from './App.jsx'
import { SavingsProvider } from './state/savings.jsx'
import { ThemeProvider } from './state/theme.jsx'

if (Capacitor.isNativePlatform()) {
  // The native app ships its files inside it, so it needs no service worker.
  import('./native.js').then((m) => m.setupNative())
} else if (import.meta.env.PROD) {
  // Lets the site open offline once it has been visited (and after "Add to Home Screen").
  import('virtual:pwa-register').then((m) => m.registerSW({ immediate: true }))
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <SavingsProvider>
          <App />
        </SavingsProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
