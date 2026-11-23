// POST /api/push/activity  { "transaction_id": "..." }
// Called by the app right after someone adds money to a shared account, with
// their sign-in (Authorization: Bearer <access token>). The database checks
// it's real, theirs and just made, and who may see it (push_activity), and
// records it so nobody hears about it twice.

import { send } from '../_lib/app.js'
import { forgetGone, readBody, sendToPhones } from '../_lib/push.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const PUBLIC_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, null)
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' })
  const token = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '')?.[1]
  const body = readBody(req)
  if (!body) return send(res, 400, { error: 'Bad request.' })
  const txn = body.transaction_id
  if (!token || typeof txn !== 'string' || !/^[0-9a-f-]{36}$/i.test(txn)) return send(res, 400, { error: 'Missing sign-in or transaction.' })

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/push_activity`, {
    method: 'POST',
    headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ txn }),
  })
  if (!r.ok) return send(res, r.status === 401 ? 401 : 502, { error: 'Could not check that transaction.' })
  const who = await r.json()
  if (!who?.phones?.length) return send(res, 200, { sent: 0 })
  try {
    const { sent, gone } = await sendToPhones(who.phones, { title: who.title, body: who.body, url: who.url })
    await forgetGone(gone)
    return send(res, 200, { sent })
  } catch (err) {
    return send(res, 500, { error: `Couldn't send: ${err.message}` })
  }
}
