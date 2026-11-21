import { useCallback, useEffect, useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase.js'
import { AuthContext } from './contexts.js'

// In the downloadable app, Google sign-in opens in the phone's browser (Google
// doesn't allow it inside apps) and comes back through this link. It must be
// in Supabase > Authentication > URL Configuration > Redirect URLs.
export const NATIVE_REDIRECT = 'yehulu://login'
const RETURN_KEY = 'yehuluReturnTo'
const native = Capacitor.isNativePlatform()

// Google accounts signed in on this device, so you can switch between them
// without signing in again: [{ id, name, email, avatarUrl, tokens }].
const SAVED_KEY = 'yehuluSignIns'
const loadSaved = () => {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY))
    return Array.isArray(list) ? list.filter(a => a?.id && a?.tokens?.refresh_token) : []
  } catch { return [] }
}
const storeSaved = (list) => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(list)) } catch { /* private mode */ } }

const profileOf = (user) => ({
  id: user.id,
  email: user.email,
  name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email,
  avatarUrl: user.user_metadata?.avatar_url ?? null,
})

/**
 * Google sign-in through Supabase. Signing in is optional: signed out, the
 * app keeps everything on the device as before.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  // False until the saved session (or the one coming back from Google) is read.
  const [ready, setReady] = useState(!supabase)
  const [saved, setSaved] = useState(loadSaved)

  const updateSaved = useCallback((change) => {
    setSaved(prev => {
      const next = change(prev)
      storeSaved(next)
      return next
    })
  }, [])

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    // Keep each account's latest tokens: they change every time they refresh.
    const remember = (next) => {
      if (!next?.user) return
      const entry = { ...profileOf(next.user), tokens: { access_token: next.access_token, refresh_token: next.refresh_token } }
      updateSaved(prev => [entry, ...prev.filter(a => a.id !== entry.id)].slice(0, 5))
    }
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      remember(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      remember(next)
      setReady(true)
    })
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [updateSaved])

  /** Leaves for Google and comes back to `returnTo` (default: this page). */
  const signInWithGoogle = useCallback(async (returnTo = window.location.pathname) => {
    if (native) {
      // Open Google in the phone's browser; the app finishes when it comes back.
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
      })
      if (error) throw error
      try { localStorage.setItem(RETURN_KEY, returnTo) } catch { /* fine: lands on Home */ }
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url: data.url, presentationStyle: 'popover' })
      return
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + returnTo, queryParams: { prompt: 'select_account' } },
    })
    if (error) throw error
  }, [])

  // Downloadable app: Google sends the user back to yehulu://login?code=...
  useEffect(() => {
    if (!native || !supabase) return
    let handle = null
    let cancelled = false
    ;(async () => {
      const [{ App }, { Browser }] = await Promise.all([import('@capacitor/app'), import('@capacitor/browser')])
      const listener = await App.addListener('appUrlOpen', async ({ url }) => {
        if (!url?.startsWith(NATIVE_REDIRECT)) return
        Browser.close().catch(() => {})
        const params = new URL(url.replace(/#/, '?')).searchParams
        const code = params.get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) console.error('Sign-in failed:', error.message)
        }
        let back = '/'
        try { back = localStorage.getItem(RETURN_KEY) || '/'; localStorage.removeItem(RETURN_KEY) } catch { /* Home */ }
        if (window.location.pathname !== back) window.history.replaceState(null, '', back)
        window.dispatchEvent(new PopStateEvent('popstate'))
      })
      if (cancelled) listener.remove()
      else handle = listener
    })()
    return () => { cancelled = true; handle?.remove() }
  }, [])

  /** Signs out of this account on this device only, and forgets it here. */
  const signOut = useCallback(async () => {
    const id = session?.user?.id
    await supabase.auth.signOut({ scope: 'local' })
    if (id) updateSaved(prev => prev.filter(a => a.id !== id))
  }, [session?.user?.id, updateSaved])

  /** Opens another account saved on this device. Throws if it has to sign in again. */
  const switchAccount = useCallback(async (id) => {
    const entry = saved.find(a => a.id === id)
    if (!entry) return
    const { error } = await supabase.auth.setSession(entry.tokens)
    if (error) {
      updateSaved(prev => prev.filter(a => a.id !== id))
      throw new Error(`${entry.name} needs to sign in again.`)
    }
  }, [saved, updateSaved])

  const user = session?.user ?? null
  const otherAccounts = useMemo(
    () => saved.filter(a => a.id !== user?.id).map(({ tokens: _tokens, ...profile }) => profile),
    [saved, user?.id],
  )
  const value = useMemo(() => ({
    enabled: Boolean(supabase),
    ready,
    user: user && profileOf(user),
    otherAccounts,
    signInWithGoogle,
    signOut,
    switchAccount,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ready, user?.id, user?.email, otherAccounts, signInWithGoogle, signOut, switchAccount])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
