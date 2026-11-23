// Turning phone notifications on and off for this device (web push).
// On iPhone this works only in the home-screen app (iOS 16.4 and later).

import { Capacitor } from '@capacitor/core'
import { isInstalled, isIOS } from './install.js'

const KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

/** 'ok' | 'install-first' (iPhone in Safari) | 'unsupported' | 'not-set-up' */
export function pushSupport() {
  if (Capacitor.isNativePlatform()) return 'unsupported'
  if (!KEY) return 'not-set-up'
  if (isIOS() && !isInstalled()) return 'install-first'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

const toBytes = (base64) => {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

const registration = () => navigator.serviceWorker.register('/push-sw.js', { scope: '/' })

/** This phone's current subscription, or null. */
export async function currentSubscription() {
  if (pushSupport() !== 'ok') return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  return (await reg?.pushManager.getSubscription()) ?? null
}

/**
 * Is this phone getting notifications for the person signed in now? The
 * browser's subscription alone isn't enough: it may belong to someone who
 * used this phone before. The database only shows people their own phones.
 */
export async function isOnForMe(supabase) {
  const sub = await currentSubscription()
  if (!sub) return false
  const { data } = await supabase.from('push_subscriptions').select('endpoint').eq('endpoint', sub.endpoint).maybeSingle()
  return Boolean(data)
}

/**
 * Asks for permission (must follow a tap) and saves this phone for the
 * signed-in person. Throws with a readable message if it can't.
 */
export async function enablePush(supabase) {
  const support = pushSupport()
  if (support === 'install-first') throw new Error('On iPhone, add Yehulu to your Home Screen first, then turn notifications on there.')
  if (support !== 'ok') throw new Error("This browser can't show notifications.")
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked for Yehulu. Allow them in your phone settings, then try again.')
  const reg = await registration()
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(KEY) })
  const json = sub.toJSON()
  const { error } = await supabase.rpc('push_subscribe', { p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth })
  if (error) throw new Error(error.message)
  return sub
}

/** Stops notifications on this phone. */
export async function disablePush(supabase) {
  const sub = await currentSubscription()
  if (!sub) return
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  // Keep the phone subscribed if the database still has it, so turning off
  // can be tried again (otherwise notifications would keep coming silently).
  if (error) throw new Error(`Couldn't turn notifications off: ${error.message}`)
  await sub.unsubscribe().catch(() => {})
}
