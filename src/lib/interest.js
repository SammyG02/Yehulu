import { addDays, addMonths, daysBetween } from './dates.js'

// How interest works (matches the Yehulu product):
//   - The annual rate depends on the account type and is spread over 365 days.
//   - A service charge is taken from the interest, not from the balance.
//   - Interest is credited every day, so yesterday's interest earns interest today.
//   - Money starts earning the day after it is deposited. A day's interest is paid
//     on the balance that sat in the account for that whole day, so a withdrawal
//     also stops earning on the day it is taken out.

const DAYS_IN_YEAR = 365
const CENT = 0.005

/** Rates are fractions: { annualRate: 0.40, serviceCharge: 0.10 }. */
export const dailyRate = ({ annualRate, serviceCharge }) =>
  (annualRate * (1 - serviceCharge)) / DAYS_IN_YEAR

/** What a full year of daily crediting works out to. */
export const effectiveAnnualRate = (rates) => (1 + dailyRate(rates)) ** DAYS_IN_YEAR - 1

/**
 * Walks the calendar one day at a time, from the earliest transaction (or fromDate,
 * whichever is first) to endDate.
 *
 * Row fields:
 *   opening    balance at the start of the day (includes all earlier interest)
 *   available  balance after the day's deposits and withdrawals, before its interest
 *   interest   credited at the end of the day on min(opening, available)
 *   balance    end-of-day balance
 */
export function simulateLedger({ transactions, rates, fromDate, endDate }) {
  const rate = dailyRate(rates)
  const flows = new Map()
  for (const txn of transactions) {
    const flow = flows.get(txn.date) ?? { deposits: 0, withdrawals: 0 }
    if (txn.type === 'deposit') flow.deposits += txn.amount
    else flow.withdrawals += txn.amount
    flows.set(txn.date, flow)
  }

  let day = [fromDate, ...flows.keys()].sort()[0]
  let balance = 0
  const rows = []

  while (day <= endDate) {
    const { deposits, withdrawals } = flows.get(day) ?? { deposits: 0, withdrawals: 0 }
    const opening = balance
    const available = opening + deposits - withdrawals
    const earningBalance = Math.min(opening, available)
    const interest = earningBalance > 0 ? earningBalance * rate : 0
    balance = available + interest

    rows.push({ date: day, opening, deposits, withdrawals, available, interest, balance })
    day = addDays(day, 1)
  }

  return rows
}

/** Headline numbers for the dashboard. The ledger must cover today. */
export function summarize(ledger, today) {
  const thisMonth = today.slice(0, 7)
  let interestToDate = 0
  let interestThisMonth = 0
  let deposited = 0
  let withdrawn = 0
  let projectedInterest = 0
  let todayRow = null

  for (const row of ledger) {
    if (row.date < today) {
      interestToDate += row.interest
      if (row.date.startsWith(thisMonth)) interestThisMonth += row.interest
    } else {
      projectedInterest += row.interest
    }
    if (row.date <= today) {
      deposited += row.deposits
      withdrawn += row.withdrawals
    }
    if (row.date === today) todayRow = row
  }

  const last = ledger[ledger.length - 1]
  return {
    balance: todayRow.available,
    interestToday: todayRow.interest,
    depositedToday: todayRow.deposits,
    interestToDate,
    interestThisMonth,
    netSaved: deposited - withdrawn,
    projectedBalance: last.balance,
    projectedInterest,
  }
}

/**
 * The first date the balance would go below zero, or null if it never does.
 * Used to stop withdrawals of money that isn't there.
 */
export function findOverdraft(transactions, rates) {
  if (transactions.length === 0) return null
  const dates = transactions.map(t => t.date).sort()
  const rows = simulateLedger({ transactions, rates, fromDate: dates[0], endDate: dates[dates.length - 1] })
  return rows.find(row => row.available < -CENT)?.date ?? null
}

/**
 * Savings goal planner: when does the balance first reach `target`?
 * Optionally adds `monthlyDeposit` on today's day-of-month, starting next month.
 * Returns null if the goal isn't reached within `maxYears`.
 */
export function planGoal({ transactions, rates, today, target, monthlyDeposit = 0, maxYears = 30 }) {
  const endDate = addDays(today, maxYears * 365)
  const extra = []
  if (monthlyDeposit > 0) {
    for (let month = 1; month <= maxYears * 12; month++) {
      extra.push({ id: `plan-${month}`, type: 'deposit', amount: monthlyDeposit, date: addMonths(today, month) })
    }
  }

  const rows = simulateLedger({ transactions: [...transactions, ...extra], rates, fromDate: today, endDate })
  let interest = 0
  let deposits = 0
  for (const row of rows) {
    if (row.date < today) continue
    interest += row.interest
    deposits += row.deposits - row.withdrawals
    const reached = row.date === today ? row.available >= target : row.balance >= target
    if (reached) {
      return { date: row.date, days: daysBetween(today, row.date), interest, deposits, balance: row.balance }
    }
  }
  return null
}
