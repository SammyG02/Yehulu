// Sending phone notifications (web push). Keys come from Vercel's settings:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (and the same public key as
//   VITE_VAPID_PUBLIC_KEY for the app).

import webpush from 'web-push'
import { rpc } from './app.js'

let ready = false
const setup = () => {
  if (ready) return true
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  webpush.setVapidDetails('https://yehulu-tracking.vercel.app', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  ready = true
  return true
}

/**
 * Sends one notification to some phones. Returns { sent, gone } where `gone`
 * are phones the push service says no longer exist (to forget).
 */
export async function sendToPhones(phones, { title, body, url = '/' }) {
  if (!setup()) throw new Error('Push keys are not set on this server.')
  const payload = JSON.stringify({ title, body, url })
  let sent = 0
  const gone = []
  await Promise.all(phones.map(async (p) => {
    try {
      await webpush.sendNotification({ endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } }, payload, { TTL: 60 * 60 * 12 })
      sent++
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) gone.push(p.endpoint)
    }
  }))
  return { sent, gone }
}

/** Forgets phones the push service says no longer exist (needs CRON_SECRET). */
export async function forgetGone(endpoints) {
  const secret = process.env.CRON_SECRET
  if (!secret) return
  for (const endpoint of endpoints) await rpc('push_forget', { secret, p_endpoint: endpoint }).catch(() => {})
}

/** A request's JSON body, or null if it isn't valid JSON. */
export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  try { return JSON.parse(req.body || '{}') } catch { return null }
}
