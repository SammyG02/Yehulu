// GET or POST /api/chinka/v1/goal - the savings-goal calculator.
//
// "If I have X, save Y a month at Z%, when do I reach my target?" Worked out
// with Yehulu's own interest code (daily interest on the closing balance,
// 10% charge, rounded to the santim, compounding).
//
//   target    (required) the goal, in Birr
//   amount    money to start with (default 0)
//   monthly   added every month from next month (default 0)
//   rate      annual rate in % (default 40)
//   account   a Yehulu account id: start from the user's real balance, history and rates there
//   by        a date (YYYY-MM-DD): also says how much a month is needed to get there by then
//
// Same access key and limits as /data. See docs/chinka-api.md.

import { addMonths, daysBetween } from '../../../src/lib/dates.js'
import { withCharges } from '../../../src/lib/charge.js'
import { planGoal, simulateLedger, summarize } from '../../../src/lib/interest.js'
import { admit, rpc, send, todayInAddis } from '../../_lib/app.js'

const MAX_YEARS = 50
const round2 = (x) => Math.round(x * 100) / 100
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))

/** 1 year, 4 months and 12 days, from `from` to `to`. */
function duration(from, to) {
  let months = 0
  while (addMonths(from, months + 1) <= to) months++
  const days = daysBetween(addMonths(from, months), to)
  const years = Math.floor(months / 12)
  const parts = [[years, 'year'], [months % 12, 'month'], [days, 'day']].filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`)
  return { days: daysBetween(from, to), years, months: months % 12, extra_days: days, text: parts.join(', ') || 'today' }
}

const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v))

export default async function handler(req, res) {
  const key = await admit(req, res, ['GET', 'POST'])
  if (!key) return

  const input = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {}) : req.query ?? {}
  const target = num(input.target)
  const amount = num(input.amount) ?? 0
  const monthly = num(input.monthly) ?? 0
  const by = input.by
  const problems = []
  if (!(target > 0)) problems.push('target must be more than 0')
  if (!(amount >= 0)) problems.push('amount must be 0 or more')
  if (!(monthly >= 0)) problems.push('monthly must be 0 or more')
  if (input.rate !== undefined && !(num(input.rate) >= 0 && num(input.rate) <= 100)) problems.push('rate must be 0 to 100')
  if (by !== undefined && !isDate(by)) problems.push('by must be a date like 2027-06-30')
  if ([target, amount, monthly].some(v => v > 1e12)) problems.push('amounts are too large')
  if (problems.length) return send(res, 400, { error: problems.join('; ') })

  const today = todayInAddis()
  let transactions = amount > 0 ? [{ id: 'start', type: 'deposit', amount: round2(amount), date: today }] : []
  let rates = [{ from: today, annualRate: (num(input.rate) ?? 40) / 100, serviceCharge: 0.1 }]

  // Start from a real Yehulu account: the user's money there, at their rates.
  if (input.account) {
    let data
    try { data = await rpc('app_read', { access_key: key }) } catch { return send(res, 502, { error: 'Yehulu is unavailable. Try again shortly.' }) }
    if (!data) return send(res, 401, { error: 'This access key is not valid or was disconnected by the user.' })
    const acc = data.accounts.find(a => a.id === input.account)
    if (!acc) return send(res, 404, { error: 'No such account for this key.' })
    const uid = data.user?.id
    const own = acc.members.find(m => m.id === uid)?.rates
    const list = Array.isArray(own) && own.length ? own : acc.rates
    if (list.length) rates = list.map(r => ({ from: r.from, annualRate: Number(r.annual_rate) / 100, serviceCharge: 0.1 }))
    if (input.rate !== undefined) rates = [...rates.filter(r => r.from < today), { from: today, annualRate: num(input.rate) / 100, serviceCharge: 0.1 }]
    rates = withCharges(rates, acc.members.find(m => m.id === uid)?.charges)
    transactions = [
      ...acc.transactions.filter(t => t.member_id === uid).map(t => ({ id: t.id, type: t.type, amount: Number(t.amount), date: t.date, noFee: Boolean(t.no_fee), ref: t.ref, source: t.source })),
      ...transactions,
    ]
  }

  const startBalance = transactions.length
    ? summarize(simulateLedger({ transactions, rates, fromDate: today, endDate: today }), today).balance
    : 0
  const plan = planGoal({ transactions, rates, today, target, monthlyDeposit: monthly, maxYears: MAX_YEARS })

  // Balance at each yearly anniversary until the goal (or for 10 years).
  const years = plan ? Math.min(MAX_YEARS, Math.ceil(plan.days / 365)) : 10
  const extra = monthly > 0 ? Array.from({ length: years * 12 }, (_, i) => ({ id: `m${i}`, type: 'deposit', amount: monthly, date: addMonths(today, i + 1) })) : []
  const ledger = simulateLedger({ transactions: [...transactions, ...extra], rates, fromDate: today, endDate: addMonths(today, years * 12) })
  const yearly = Array.from({ length: years }, (_, i) => {
    const date = addMonths(today, (i + 1) * 12)
    return { year: i + 1, date, balance: ledger.find(r => r.date === date)?.balance ?? null }
  })

  // How much a month to reach it by a date (to the Birr).
  let byDate
  if (by) {
    const reaches = (m) => {
      const p = planGoal({ transactions, rates, today, target, monthlyDeposit: m, maxYears: MAX_YEARS })
      return p && p.date <= by
    }
    if (by < today) byDate = { by, possible: false, reason: 'that date has passed' }
    else if (reaches(0)) byDate = { by, possible: true, monthly_needed: 0 }
    else {
      let lo = 0
      let hi = Math.max(target, 1)
      if (!reaches(hi)) byDate = { by, possible: false, reason: 'not reachable by then with monthly deposits (the first one is next month)' }
      else {
        while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (reaches(mid)) hi = mid; else lo = mid }
        byDate = { by, possible: true, monthly_needed: hi }
      }
    }
  }

  return send(res, 200, {
    version: 1,
    currency: 'ETB',
    today,
    input: { target, start_balance: round2(startBalance), monthly, rate: round2(rates.at(-1).annualRate * 100), account: input.account ?? null },
    reached: Boolean(plan),
    goal: plan
      ? {
        date: plan.date,
        takes: duration(today, plan.date),
        // Money put in from today on (the starting amount and the monthly deposits).
        deposits_from_today: round2(plan.deposits),
        interest_from_today: round2(plan.interest),
        balance_then: round2(plan.balance),
      }
      : { reason: `not reached within ${MAX_YEARS} years` },
    yearly,
    by: byDate,
    note: 'Assumes the rate stays the same and nothing is withdrawn. Yehulu adds interest every day after a 10% service charge.',
  })
}

export { duration }
