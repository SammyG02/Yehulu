// GET /api/push/daily - the 9:00 (Ethiopia) notifications job, run by Vercel
// Cron (see vercel.json). Vercel sends Authorization: Bearer <CRON_SECRET>.
// Works out each person's weekly summary, goals reached and reminders, sends
// them once, and records what was sent.

import { planNotifications } from '../../src/lib/notify.js'
import { rpc, send, todayInAddis } from '../_lib/app.js'
import { sendToPhones } from '../_lib/push.js'

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: 'Not allowed.' })

  const today = todayInAddis()
  let users
  try {
    users = await rpc('push_due', { secret })
  } catch (err) {
    return send(res, 502, { error: `Couldn't read who to notify (${err.message}).` })
  }

  const marks = []
  let notifications = 0
  let phones = 0
  for (const user of users ?? []) {
    const list = planNotifications(user, today)
    for (const n of list) {
      const { sent, gone } = await sendToPhones(user.phones ?? [], n)
      phones += sent
      notifications++
      if (sent > 0) marks.push({ user_id: user.user_id, kind: n.kind, key: n.key })
      for (const endpoint of gone) await rpc('push_forget', { secret, p_endpoint: endpoint }).catch(() => {})
    }
  }
  if (marks.length) await rpc('push_mark', { secret, sent: marks })
  return send(res, 200, { today, people: users?.length ?? 0, notifications, delivered: phones })
}
