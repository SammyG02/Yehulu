import { useCallback, useEffect, useMemo, useState } from 'react'
import { ThemeContext } from './contexts.js'

const KEY = 'yehuluTheme'
const PREFERENCES = ['system', 'light', 'dark']
const META_COLOR = { light: '#f7f9f8', dark: '#0a0d0b' }

const systemQuery = () => window.matchMedia('(prefers-color-scheme: dark)')
const resolve = (preference) => (preference === 'system' ? (systemQuery().matches ? 'dark' : 'light') : preference)

// Applied synchronously (not in an effect) so components reading CSS
// variables during the same render, like the charts, get the new colours.
const apply = (resolved) => {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', META_COLOR[resolved])
}

const readPreference = () => {
  try {
    const saved = localStorage.getItem(KEY)
    return PREFERENCES.includes(saved) ? saved : 'system'
  } catch {
    return 'system'
  }
}

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(readPreference)
  const [resolved, setResolved] = useState(() => resolve(preference))

  const setPreference = useCallback((next) => {
    try { localStorage.setItem(KEY, next) } catch { /* private mode: theme just won't persist */ }
    const r = resolve(next)
    apply(r)
    setPreferenceState(next)
    setResolved(r)
  }, [])

  // Follow the operating system while set to "system".
  useEffect(() => {
    if (preference !== 'system') return
    const query = systemQuery()
    const onChange = () => {
      const r = resolve('system')
      apply(r)
      setResolved(r)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [preference])

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
