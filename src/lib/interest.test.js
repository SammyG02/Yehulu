import { test } from 'node:test'
import assert from 'node:assert/strict'
import { simulateLedger, summarize, findOverdraft, dailyRate, effectiveAnnualRate, planGoal } from './interest.js'
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

test('rate: 40% minus 10% fee, compounded daily, is about 43.31% a year', () => {
  near(dailyRate(RATES), 0.36 / 365, 'daily rate')
  near(effectiveAnnualRate(RATES), 0.433075, 'effective annual')
})

test('a deposit earns nothing on the day it is made', () => {
  const { ledger, summary } = run([deposit(0, 10000)])
  assert.equal(summary.balance, 10000)
  assert.equal(summary.interestToday, 0)
  near(ledger[1].interest, 10000 * dailyRate(RATES), 'first interest is the next day')
})

test('interest compounds: yesterday\'s interest earns interest', () => {
  // Deposited 90 days ago -> earned on 89 full days so far.
  const { summary } = run([deposit(-90, 10000)])
  near(summary.balance, 10000 * g ** 89, 'balance after 89 interest days')
})

test('each deposit compounds only from its own next day (no double counting)', () => {
  const { summary } = run([deposit(-90, 10000), deposit(-30, 10000)])
  near(summary.balance, 10000 * g ** 89 + 10000 * g ** 29, 'two deposits')
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
  near(summary.projectedBalance, 5000 * g ** 29 + 1000 * g ** 19, 'projected end balance')
})

test('the account rate is used, including zero', () => {
  const { summary } = run([deposit(-30, 1000)], { rates: { annualRate: 0, serviceCharge: 0.1 } })
  assert.equal(summary.balance, 1000)
  const higher = run([deposit(-30, 1000)], { rates: { annualRate: 0.5, serviceCharge: 0 } })
  near(higher.summary.balance, 1000 * (1 + 0.5 / 365) ** 29, '50% account')
})

test('interest to date and net saved', () => {
  const { summary } = run([deposit(-20, 1000), withdrawal(-5, 200)])
  near(summary.netSaved, 800, 'net saved')
  near(summary.balance - summary.netSaved, summary.interestToDate, 'balance = saved + interest')
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
