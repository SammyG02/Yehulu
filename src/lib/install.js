// Installing Yehulu as a home-screen app (PWA), on Android and iPhone.
// Android's Chrome fires `beforeinstallprompt` early (often before React
// starts), so it's caught here as soon as the app loads.

import { Capacitor } from '@capacitor/core'

let deferred = null
const listeners = new Set()
const notify = () => listeners.forEach(fn => fn())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // show our own button instead of Chrome's mini bar
    deferred = e
    notify()
  })
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
}

/** Already running as an installed app (or the downloadable app)? */
export const isInstalled = () => typeof window !== 'undefined' && (
  Capacitor.isNativePlatform()
  || window.matchMedia?.('(display-mode: standalone)').matches
  || window.navigator.standalone === true
)

/** iPhone / iPad Safari: installs through Share > Add to Home Screen. */
export const isIOS = () => typeof navigator !== 'undefined' && (
  /iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
)

/** How this device installs: 'prompt' (one tap), 'ios' (steps), or null. */
export const installMethod = () => {
  if (isInstalled()) return null
  if (deferred) return 'prompt'
  if (isIOS()) return 'ios'
  return null
}

/** Opens Chrome's install dialog. Resolves to true if installed. */
export async function promptInstall() {
  if (!deferred) return false
  const e = deferred
  deferred = null
  e.prompt()
  const { outcome } = await e.userChoice
  notify()
  return outcome === 'accepted'
}

export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

const DISMISS_KEY = 'yehuluInstallDismissed'
const DISMISS_DAYS = 30
export const wasDismissed = () => {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_DAYS * 86_400_000 } catch { return false }
}
export const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* fine */ } }
