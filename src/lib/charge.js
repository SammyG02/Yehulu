// The daily charge some kinds of Yehulu account have (e.g. Br 10 a day, a
// "Standing Order" on the statement). It's worked out like interest, never
// saved as transactions. On days an imported statement covers only its own
// lines count; the charge continues after them (see simulateLedger).
//
// A person's charges are a history, like rates: [{ from, amount }], each until
// the next one starts. An amount of 0 means it stopped.

import { addDays, daysBetween, isDateKey } from './dates.js'
import { coveredUntil, periodOn } from './interest.js'

export const MAX_CHARGE = 100000

/** A clean charge history, oldest first; [] when there's none. */
export const sanitizeCharges = (list) => {
  if (!Array.isArray(list)) return []
  const byDate = new Map()
  for (const item of list) {
    const raw = item?.amount
    if (!isDateKey(item?.from) || raw === null || raw === '' || typeof raw === 'boolean') continue
    const amount = Math.round(Number(raw) * 100) / 100
    if (amount >= 0 && amount <= MAX_CHARGE) byDate.set(item.from, { from: item.from, amount })
  }
  const sorted = [...byDate.values()].sort((a, b) => a.from.localeCompare(b.from))
  // Drop entries that change nothing (including a 0 before the first charge).
  return sorted.filter((c, i) => c.amount !== (i === 0 ? 0 : sorted[i - 1].amount))
}

/** The charge in force on `date` (0 if none). */
export const chargeOn = (charges, date) => charges.findLast(c => c.from <= date)?.amount ?? 0

/** A rate history with each day's charge in it: what simulateLedger takes. Unchanged if there are no charges. */
export function withCharges(rates, charges) {
  const clean = sanitizeCharges(charges)
  if (!clean.length || !rates.length) return rates
  const starts = [...new Set([...rates.map(r => r.from), ...clean.map(c => c.from)])].sort()
  return starts.map(from => ({ ...periodOn(rates, from), from, dailyCharge: chargeOn(clean, from) }))
}

const RECENT_DAYS = 31
const MIN_LINES = 10
const MAX_PAUSE = 4 // days between two charges (a Sunday, a holiday)

/**
 * A daily charge the imported statements show, still going when they end:
 * { amount, since } or null. Only a suggestion; nothing is switched on by it.
 */
export function chargeFound(transactions) {
  const end = coveredUntil(transactions)
  if (!end) return null
  const lines = transactions.filter(t => t.type === 'withdrawal' && t.noFee && t.ref?.startsWith('y:'))
  const recent = new Map()
  for (const t of lines) if (t.date > addDays(end, -RECENT_DAYS)) recent.set(t.amount, (recent.get(t.amount) ?? 0) + 1)
  const [amount, count] = [...recent].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  if (count < MIN_LINES) return null
  const days = lines.filter(t => t.amount === amount).map(t => t.date).sort().reverse()
  if (daysBetween(days[0], end) > MAX_PAUSE) return null
  let since = days[0]
  for (const day of days) {
    if (daysBetween(day, since) > MAX_PAUSE) break
    since = day
  }
  return { amount, since }
}
