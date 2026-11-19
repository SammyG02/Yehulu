import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Shown at the bottom of Settings, so you can tell which version a phone runs.
const version = (() => {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  try { return execSync('git rev-parse --short HEAD').toString().trim() } catch { return 'dev' }
})()

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      // No offline copy: the app always loads fresh from the internet. The
      // worker this builds only deletes the old cache from phones that had one.
      selfDestroying: true,
      // Registered by hand in main.jsx, and only in the browser (not inside the native app).
      injectRegister: false,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Yehulu Savings',
        short_name: 'Yehulu',
        description: 'Track your Yehulu savings and daily compound interest.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f7f9f8',
        theme_color: '#24b663',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Keep the saved copy small: code, styles and the Latin font only.
        globPatterns: ['**/*.{js,css,svg,woff2}'],
        globIgnores: ['**/*{cyrillic,greek,vietnamese,latin-ext}*.woff2'],
        cleanupOutdatedCaches: true,
        // Pages come from the internet when there is one, so a new version
        // shows straight away; the saved page is only used offline.
        navigateFallback: null,
        runtimeCaching: [{
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: { cacheName: 'pages', networkTimeoutSeconds: 4, expiration: { maxEntries: 5 } },
        }],
      },
    }),
  ],
})
