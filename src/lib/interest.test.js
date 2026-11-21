import { test } from 'node:test'
import assert from 'node:assert/strict'
import { simulateLedger, summarize, findOverdraft, findNewOverdraft, dailyRate, effectiveAnnualRate, planGoal } from './interest.js'
import { addDays } from './dates.js'

const TODAY = '2026-11-16'
const RATES = { annualRate: 0.40, serviceCharge: 0.10 }
const g = 1 + dailyRate(RATES)

const deposit = (daysFromToday, amount) => ({ id: `d${daysFromToday}`, type: 'deposit', amount, date: addDays(TODAY, daysFromToday) })
const withdrawal = (daysFromToday, amount) => ({ id: `w${daysFromToday}`, type: 'withdrawal', amount, date: addDays(TODAY, daysFromToday) })

const run = (transactions, { days = 30, rates = RATES } = {}) => {
  const ledger = simulateLedger({ transactions, rates, fromDate: TODAY, endDate: addDays(TODAY, days - 1) })
  return { ledger, summary: summarize(ledger, TODAY) }
}

const near = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 0.005, `${label}: got ${actual}, expected ${expected}`)

// A separate, plain model of Yehulu's rules (as read from real statements), to
// check the engine against: each day, interest = round(closing x rate / 365),
// charge = round(interest x 10%), all in whole santim. Events: [day, amount]
// with day counted from today. Returns the balance on the morning of `until`.
const bank = (events, until, { annualRate = 0.4, serviceCharge = 0.1 } = {}) => {
  const round = (x) => Math.round(x)
  let cents = 0
  for (let day = Math.min(...events.map(e => e[0])); day < until; day++) {
    for (const [d, amount] of events) if (d === day) cents += Math.round(amount * 100)
    const gross = cents > 0 ? round(cents * annualRate / 365) : 0
    cents += gross - round(gross * serviceCharge)
  }
  for (const [d, amount] of events) if (d === until) cents += Math.round(amount * 100)
  return cents / 100
}

test('rate: 40% minus 10% fee, compounded daily, is about 43.31% a year', () => {
  near(dailyRate(RATES), 0.36 / 365, 'daily rate')
  near(effectiveAnnualRate(RATES), 0.433075, 'effective annual')
})

test('a deposit earns interest on the day it is made, credited overnight', () => {
  const { ledger, summary } = run([deposit(0, 10000)])
  assert.equal(summary.balance, 10000)
  // 10,000 x 40% / 365 = 10.958... -> 10.96; charge 10% = 1.096 -> 1.10.
  assert.equal(ledger[0].grossInterest, 10.96)
  assert.equal(ledger[0].serviceCharge, 1.1)
  assert.equal(summary.interestToday, 9.86)
  assert.equal(ledger[1].opening, 10009.86)
})

test('real statement day: 131,258.46 earns 143.84, charge 14.38', () => {
  const { ledger } = run([deposit(0, 131258.46)])
  assert.equal(ledger[0].grossInterest, 143.84)
  assert.equal(ledger[0].serviceCharge, 14.38)
  assert.equal(ledger[0].balance, 131387.92)
})

test('interest compounds: yesterday\'s interest earns interest', () => {
  // Deposited 90 days ago -> 90 days of interest so far (the deposit day counts).
  const { summary } = run([deposit(-90, 10000)])
  assert.equal(summary.balance, bank([[-90, 10000]], 0))
  assert.ok(Math.abs(summary.balance - 10000 * g ** 90) < 0.5, 'close to smooth compounding')
})

test('each deposit compounds from its own day (no double counting)', () => {
  const { summary } = run([deposit(-90, 10000), deposit(-30, 10000)])
  assert.equal(summary.balance, bank([[-90, 10000], [-30, 10000]], 0))
})

test('withdrawn money stops earning on the day it is taken out', () => {
  const { ledger } = run([deposit(-10, 10000), withdrawal(0, 4000)])
  const today = ledger.find(r => r.date === TODAY)
  near(today.interest, today.available * dailyRate(RATES), 'interest on what stayed all day')
})

test('the projection is exactly the horizon length and future deposits land on their date', () => {
  const { ledger, summary } = run([deposit(0, 5000), deposit(10, 1000)], { days: 30 })
  const upcoming = ledger.filter(r => r.date >= TODAY)
  assert.equal(upcoming.length, 30)
  assert.equal(upcoming[9].deposits, 0)
  assert.equal(upcoming[10].deposits, 1000)
  // The last row's balance includes that day's interest.
  assert.equal(summary.projectedBalance, bank([[0, 5000], [10, 1000]], 30))
})

test('the account rate is used, including zero', () => {
  const { summary } = run([deposit(-30, 1000)], { rates: { annualRate: 0, serviceCharge: 0.1 } })
  assert.equal(summary.balance, 1000)
  const higher = run([deposit(-30, 1000)], { rates: { annualRate: 0.5, serviceCharge: 0 } })
  assert.equal(higher.summary.balance, bank([[-30, 1000]], 0, { annualRate: 0.5, serviceCharge: 0 }))
})

test('interest to date and net saved', () => {
  const { summary } = run([deposit(-20, 1000), withdrawal(-5, 200)])
  near(summary.netSaved, 800, 'net saved')
  // The 200 withdrawal pays a 0.2% fee (Br 0.40).
  near(summary.feesPaid, 0.4, 'fees')
  near(summary.balance - summary.netSaved + summary.feesPaid, summary.interestToDate, 'balance = saved + interest - fees')
})

test('overdrafts are detected, including future ones', () => {
  assert.equal(findOverdraft([deposit(-5, 100), withdrawal(-1, 50)], RATES), null)
  assert.equal(findOverdraft([deposit(-5, 100), withdrawal(-1, 500)], RATES), addDays(TODAY, -1))
  assert.equal(findOverdraft([withdrawal(-6, 10), deposit(-5, 100)], RATES), addDays(TODAY, -6))
})

test('interest this month only counts credited days in the current month', () => {
  const { ledger, summary } = run([deposit(-40, 10000)])
  const expected = ledger.filter(r => r.date < TODAY && r.date.startsWith('2026-11')).reduce((a, r) => a + r.interest, 0)
  near(summary.interestThisMonth, expected, 'this month')
  assert.ok(summary.interestThisMonth < summary.interestToDate)
})

test('goal planner: already reached, reached by interest alone, and with monthly top-ups', () => {
  const txns = [deposit(-10, 10000)]
  assert.equal(planGoal({ transactions: txns, rates: RATES, today: TODAY, target: 5000 }).days, 0)

  // 10,000 -> 20,000 by interest alone at 36%/365: about 693 days of compounding.
  const alone = planGoal({ transactions: txns, rates: RATES, today: TODAY, target: 20000 })
  assert.ok(alone.days > 650 && alone.days < 720, `days ${alone.days}`)
  assert.ok(alone.balance >= 20000)

  const faster = planGoal({ transactions: txns, rates: RATES, today: TODAY, target: 20000, monthlyDeposit: 1000 })
  assert.ok(faster.days < alone.days / 2, `with top-ups ${faster.days} vs ${alone.days}`)
  assert.ok(faster.deposits >= 1000)

  assert.equal(planGoal({ transactions: [], rates: RATES, today: TODAY, target: 1000 }), null)
})

test('a shared account: everyone earns on their own money, and the days add up', async () => {
  const { simulateGroupLedger } = await import('./interest.js')
  const rates = [{ from: '2026-01-01', annualRate: 0.4, serviceCharge: 0.1 }]
  const a = [{ id: 'a1', type: 'deposit', amount: 1000, date: '2026-03-01' }]
  const b = [
    { id: 'b1', type: 'deposit', amount: 5000, date: '2026-03-10' },
    { id: 'b2', type: 'withdrawal', amount: 1000, date: '2026-04-01' },
  ]
  const endDate = '2026-05-01'
  const group = simulateGroupLedger({ groups: [a, b], rates, fromDate: endDate, endDate })
  const alone = (t) => simulateLedger({ transactions: t, rates, fromDate: '2026-03-01', endDate })
  const [la, lb] = [alone(a), alone(b)]
  assert.equal(group.length, la.length)
  assert.equal(group[0].date, '2026-03-01')
  for (const i of [0, 9, 31, group.length - 1]) {
    assert.ok(Math.abs(group[i].balance - (la[i].balance + lb[i].balance)) < 1e-9, group[i].date)
    assert.ok(Math.abs(group[i].interest - (la[i].interest + lb[i].interest)) < 1e-9, group[i].date)
  }
  // Same as one person when only one has transactions.
  assert.deepEqual(simulateGroupLedger({ groups: [a, []], rates, fromDate: endDate, endDate }), simulateLedger({ transactions: a, rates, fromDate: endDate, endDate }))
})

test('interest by month: every month since the first deposit, newest first, matching the totals', async () => {
  const { interestByMonth } = await import('./interest.js')
  const rates = [{ from: '2026-01-01', annualRate: 0.4, serviceCharge: 0.1 }]
  const today = '2026-11-19'
  const ledger = simulateLedger({
    transactions: [
      { id: 'a', type: 'deposit', amount: 100000, date: '2026-09-20' },
      { id: 'b', type: 'withdrawal', amount: 20000, date: '2026-10-10' },
    ],
    rates, fromDate: today, endDate: '2026-12-31',
  })
  const months = interestByMonth(ledger, today)
  assert.deepEqual(months.map(m => m.month), ['2026-11', '2026-10', '2026-09'])
  assert.deepEqual(months.map(m => m.current), [true, false, false])
  const summary = summarize(ledger, today)
  const total = months.reduce((s, m) => s + m.interest, 0)
  assert.ok(Math.abs(total - summary.interestToDate) < 1e-9)
  assert.ok(Math.abs(months[0].interest - summary.interestThisMonth) < 1e-9)
  // October's closing balance is the balance on Oct 31.
  assert.equal(months[1].balance, ledger.find(r => r.date === '2026-10-31').balance)
  assert.deepEqual(interestByMonth([], today), [])
})

// Checked by hand with a separate calculation (2026-11-19): 200,000 on Oct 5,
// 5,000 out on Oct 20 (Br 10 fee), 100,000 on Nov 5, at 40% minus the 10% charge.
test('worked example: 200k, then 5k out, then 100k in, gives Br 305,301.38 on Nov 19', () => {
  const rates = [{ from: '2026-10-01', annualRate: 0.4, serviceCharge: 0.1 }]
  const transactions = [
    { id: 1, type: 'deposit', amount: 200000, date: '2026-10-05' },
    { id: 2, type: 'withdrawal', amount: 5000, date: '2026-10-20' },
    { id: 3, type: 'deposit', amount: 100000, date: '2026-11-05' },
  ]
  const today = '2026-11-19'
  const ledger = simulateLedger({ transactions, rates, fromDate: today, endDate: today })
  const at = (d) => Math.round(ledger.find(r => r.date === d).balance * 100) / 100
  assert.equal(at('2026-10-06'), 200394.71)
  assert.equal(at('2026-10-20'), 198164.67)
  assert.equal(at('2026-11-05'), 301413.73)
  const s = summarize(ledger, today)
  assert.equal(Math.round(s.balance * 100) / 100, 305301.38)
  assert.equal(Math.round(s.interestToDate * 100) / 100, 10311.38)
  assert.equal(s.feesPaid, 10)
  assert.equal(s.netSaved, 295000)
})

// Editing recalculates the whole history as if the transaction had always been
// that way. Expected values checked by hand with a separate calculation.
test('worked example: edits and deletes recalculate everything, and fees follow the final amount', () => {
  const rates = [{ from: '2026-10-01', annualRate: 0.4, serviceCharge: 0.1 }]
  const today = '2026-11-19'
  const base = [
    { id: 'd1', type: 'deposit', amount: 200000, date: '2026-10-05' },
    { id: 'w1', type: 'withdrawal', amount: 5000, date: '2026-10-20' },
    { id: 'd2', type: 'deposit', amount: 100000, date: '2026-11-05' },
  ]
  const edit = (list, id, changes) => list.map(t => (t.id === id ? { ...t, ...changes } : t))
  const result = (list) => {
    const s = summarize(simulateLedger({ transactions: list, rates, fromDate: today, endDate: today }), today)
    return [Math.round(s.balance * 100) / 100, Math.round(s.interestToDate * 100) / 100, s.feesPaid]
  }
  assert.deepEqual(result(edit(base, 'w1', { amount: 8000 })), [302205.17, 10221.17, 16])
  assert.deepEqual(result(edit(base, 'w1', { date: '2026-11-10' })), [305407.09, 10417.09, 10])
  assert.deepEqual(result(edit(base, 'd2', { amount: 50000, date: '2026-11-01' })), [254806.84, 9816.84, 10])
  assert.deepEqual(result(base.filter(t => t.id !== 'w1')), [310461.75, 10461.75, 0])
  // Editing a withdrawal again and again: one fee, on the final amount.
  const thrice = [6000, 7000, 8000].reduce((list, amount) => edit(list, 'w1', { amount }), base)
  assert.equal(result(thrice)[2], 16)
  // Edits that would push the balance below zero are caught (the app refuses them).
  assert.equal(findNewOverdraft(base, edit(base, 'd1', { amount: 3000 }), rates), '2026-10-20')
  assert.equal(findNewOverdraft(base, edit(base, 'w1', { amount: 250000 }), rates), '2026-10-20')
})
