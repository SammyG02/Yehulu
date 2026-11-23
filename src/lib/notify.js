// What each person should be told this morning (the daily notifications job):
// weekly interest summary (Sundays), goals reached, monthly deposit reminders.
// Uses the app's own interest maths, so the numbers match what they see.

import { addDays } from './dates.js'
import { simulateLedger, summarize } from './interest.js'

const br = (n) => `Br ${Math.round(n).toLocaleString('en-US')}`
const fractions = (rates) => rates.map(r => ({ from: r.from, annualRate: Number(r.annual_rate) / 100, serviceCharge: 0.1 }))

/**
 * user: { settings, sent: ['kind|key'], accounts: [{ id, name, goal, rates, my_rates, transactions }] }
 * today: 'YYYY-MM-DD' (Ethiopia)
 * Returns [{ kind, key, title, body, url }]: only what wasn't sent before.
 */
export function planNotifications(user, today) {
  const s = user.settings ?? {}
  const on = (k) => s[k] !== false
  const sent = new Set(user.sent ?? [])
  const out = []
  const add = (n) => { if (!sent.has(`${n.kind}|${n.key}`)) out.push(n) }

  const accounts = (user.accounts ?? []).map(a => {
    const rates = fractions(Array.isArray(a.my_rates) && a.my_rates.length ? a.my_rates : a.rates)
    const transactions = a.transactions.map(t => ({ type: t.type, amount: Number(t.amount), date: t.date, noFee: Boolean(t.no_fee) }))
    if (!transactions.length || !rates.length) return { ...a, balance: 0, week: 0, weekAgo: 0 }
    const ledger = simulateLedger({ transactions, rates, fromDate: today, endDate: today })
    const weekStart = addDays(today, -7)
    const week = ledger.filter(r => r.date >= weekStart && r.date < today).reduce((sum, r) => sum + r.interest, 0)
    // Balance at the end of the day a week ago (0 if the account is newer).
    const weekAgo = ledger.find(r => r.date === addDays(today, -8))?.balance ?? 0
    return { ...a, balance: summarize(ledger, today).balance, week, weekAgo }
  })

  // Weekly summary, on Sundays: this week's interest and today's balance.
  const sunday = new Date(`${today}T00:00:00Z`).getUTCDay() === 0
  if (on('weekly') && sunday) {
    const earning = accounts.filter(a => a.week > 0)
    if (earning.length) {
      const interest = earning.reduce((sum, a) => sum + a.week, 0)
      const balance = earning.reduce((sum, a) => sum + a.balance, 0)
      add({
        kind: 'weekly', key: today, url: '/',
        title: 'Your week in Yehulu',
        body: `You earned ${br(interest)} interest this week${earning.length === 1 ? ` in ${earning[0].name}` : ''}. Balance ${br(balance)}.`,
      })
    }
  }

  for (const a of accounts) {
    const target = Number(a.goal?.target) || 0
    const monthly = Number(a.goal?.monthly) || 0
    // Goal reached: once per account and target, and only if it was crossed in
    // the last week (not a goal passed long before notifications were on).
    if (on('goal') && target > 0 && a.balance >= target && a.weekAgo < target) {
      add({
        kind: 'goal', key: `${a.id}:${target}`, url: '/growth',
        title: 'Goal reached 🎉',
        body: `${a.name} passed your ${br(target)} goal. Balance ${br(a.balance)}.`,
      })
    }
    // Monthly deposit reminder, on the chosen day.
    const day = Number(s.reminder_day) || 1
    if (on('reminder') && monthly > 0 && Number(today.slice(8, 10)) === day) {
      add({
        kind: 'reminder', key: `${a.id}:${today.slice(0, 7)}`, url: '/',
        title: 'Monthly deposit',
        body: `Time for this month's ${br(monthly)} deposit to ${a.name}.`,
      })
    }
  }
  return out
}
