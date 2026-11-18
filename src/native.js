import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'

/** Keeps the phone's status bar readable in light and dark theme. */
export function setupNative() {
  const root = document.documentElement
  const apply = () => {
    const dark = root.classList.contains('dark')
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
    if (Capacitor.getPlatform() === 'android') {
      StatusBar.setBackgroundColor({ color: dark ? '#0a0d0b' : '#f7f9f8' }).catch(() => {})
    }
  }
  apply()
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['class'] })
}
