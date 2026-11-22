// POST /api/push/goal  { "account_id", "target", "this_phone" }
// Called by the app when your own deposit takes you past your goal, with your
// sign-in. The phone you're using celebrates in the app; this tells your
// other phones and records it (push_goal), so the 9:00 job won't repeat it.

import { send } from '../_lib/app.js'
import { sendToPhones } from '../_lib/push.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const PUBLIC_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, null)
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' })
  const token = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '')?.[1]
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}
  const target = Number(body.target)
  if (!token || typeof body.account_id !== 'string' || !(target > 0)) return send(res, 400, { error: 'Missing sign-in, account or goal.' })

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/push_goal`, {
    method: 'POST',
    headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ acc: body.account_id, target, this_phone: typeof body.this_phone === 'string' ? body.this_phone : null }),
  })
  if (!r.ok) return send(res, r.status === 401 ? 401 : 502, { error: 'Could not check that goal.' })
  const found = await r.json()
  if (!found?.phones?.length) return send(res, 200, { sent: 0 })
  const { sent } = await sendToPhones(found.phones, {
    title: 'Goal reached 🎉',
    body: `${found.name} passed your Br ${Math.round(target).toLocaleString('en-US')} goal.`,
    url: '/growth',
  })
  return send(res, 200, { sent })
}
