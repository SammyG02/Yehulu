// Linking a name-only member (whose money the owner typed in) to the real
// person who later joined: their history moves over, without counting
// anything twice.

import { daysBetween } from './dates.js'

const MATCH_DAYS = 3

/**
 * guestTxns: the name-only member's transactions; memberTxns: the real
 * member's. An entry "looks the same" as one the real member already has if
 * it's the same statement line, or the same kind and amount within 3 days
 * (each of theirs matches at most one).
 * Returns { move: [...guestTxns to move], doubles: [{ guest, member }] }.
 */
export function planLink(guestTxns, memberTxns) {
  const used = new Set()
  const move = []
  const doubles = []
  const sorted = [...guestTxns].sort((a, b) => a.date.localeCompare(b.date))
  for (const g of sorted) {
    const sameLine = g.ref && memberTxns.find(m => !used.has(m.id) && m.ref === g.ref)
    const near = sameLine ?? memberTxns
      .filter(m => !used.has(m.id) && m.type === g.type && Math.abs(m.amount - g.amount) < 0.005
        && Math.abs(daysBetween(m.date, g.date)) <= MATCH_DAYS)
      .sort((a, b) => Math.abs(daysBetween(a.date, g.date)) - Math.abs(daysBetween(b.date, g.date)))[0]
    if (near) {
      used.add(near.id)
      doubles.push({ guest: g, member: near })
    } else {
      move.push(g)
    }
  }
  return { move, doubles }
}
