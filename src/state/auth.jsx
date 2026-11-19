import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { AuthContext } from './contexts.js'

/**
 * Google sign-in through Supabase. Signing in is optional: signed out, the
 * app keeps everything on the device as before.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  // False until the saved session (or the one coming back from Google) is read.
  const [ready, setReady] = useState(!supabase)

  useEffect(() => {
    if (!supabase) return
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
    })
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [])

  /** Leaves for Google and comes back to `returnTo` (default: this page). */
  const signInWithGoogle = useCallback(async (returnTo = window.location.pathname) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + returnTo, queryParams: { prompt: 'select_account' } },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(() => supabase.auth.signOut(), [])

  const user = session?.user ?? null
  const value = useMemo(() => ({
    enabled: Boolean(supabase),
    ready,
    user: user && {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email,
      avatarUrl: user.user_metadata?.avatar_url ?? null,
    },
    signInWithGoogle,
    signOut,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ready, user?.id, user?.email, signInWithGoogle, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
