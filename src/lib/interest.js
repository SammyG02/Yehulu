import { addDays, addMonths, daysBetween } from './dates.js'

// How interest works (matches the Yehulu product):
//   - The annual rate depends on the account type and is spread over 365 days.
//     It can change over time: each day uses the rate in effect that day.
//   - A service charge is taken from the interest, not from the balance.
//   - Interest is credited every day, so yesterday's interest earns interest today.
//   - Every withdrawal pays a 0.2% fee, taken on the withdrawal's date. The fee
//     belongs to the withdrawal itself, so editing it recalculates its one fee;
//     deposits and edits never add a fee of their own.
//   - Money starts earning the day after it is deposited. A day's interest is paid
//     on the balance that sat in the account for that whole day, so a withdrawal
//     also stops earning on the day it is taken out.

const DAYS_IN_YEAR = 365

/** Fee on each withdrawal, as a fraction (0.2%). */
export const WITHDRAWAL_FEE_RATE = 0.002

/** The fee for withdrawing `amount`, rounded to the santim. */
export const withdrawalFee = (amount) => Math.round(amount * WITHDRAWAL_FEE_RATE * 100) / 100
const CENT = 0.005

/**
 * `rates` everywhere below is either one rate, { annualRate: 0.40, serviceCharge: 0.10 }
 * (fractions), or a rate history: [{ from: 'YYYY-MM-DD', annualRate, serviceCharge }, ...].
 */
const asSchedule = (rates) => (Array.isArray(rates)
  ? [...rates].sort((a, b) => a.from.localeCompare(b.from))
  : [{ from: '0000-01-01', ...rates }])

/**
 * The period in effect on `date`: the latest one starting on or before it.
 * Dates before the first period use the first period, so an old deposit
 * added later still earns interest.
 */
export const periodOn = (rates, date) => {
  const schedule = asSchedule(rates)
  let current = schedule[0]
  for (const period of schedule) {
    if (period.from <= date) current = period
    else break
  }
  return current
}

/** Net daily rate of one period, after the service charge. */
export const dailyRate = ({ annualRate, serviceCharge }) =>
  (annualRate * (1 - serviceCharge)) / DAYS_IN_YEAR

/** What a full year of daily crediting works out to, for one period. */
export const effectiveAnnualRate = (rates) => (1 + dailyRate(rates)) ** DAYS_IN_YEAR - 1

/**
 * Walks the calendar one day at a time, from the earliest transaction (or fromDate,
 * whichever is first) to endDate.
 *
 * Row fields:
 *   opening    balance at the start of the day (includes all earlier interest)
 *   fees       withdrawal fees taken that day
 *   available  balance after the day's deposits, withdrawals and fees, before its interest
 *   interest   credited at the end of the day on min(opening, available)
 *   balance    end-of-day balance
 */
export function simulateLedger({ transactions, rates, fromDate, endDate }) {
  const schedule = asSchedule(rates)
  const dailyRates = schedule.map(dailyRate)
  let period = 0
  const flows = new Map()
  for (const txn of transactions) {
    const flow = flows.get(txn.date) ?? { deposits: 0, withdrawals: 0, fees: 0 }
    if (txn.type === 'deposit') {
      flow.deposits += txn.amount
    } else {
      flow.withdrawals += txn.amount
      flow.fees += withdrawalFee(txn.amount)
    }
    flows.set(txn.date, flow)
  }

  let day = [fromDate, ...flows.keys()].sort()[0]
  let balance = 0
  const rows = []

  while (day <= endDate) {
    // Days only move forward, so the current period can only move forward too.
    while (period + 1 < schedule.length && schedule[period + 1].from <= day) period++
    const rate = dailyRates[period]
    const { deposits, withdrawals, fees } = flows.get(day) ?? { deposits: 0, withdrawals: 0, fees: 0 }
    const opening = balance
    const available = opening + deposits - withdrawals - fees
    const earningBalance = Math.min(opening, available)
    const interest = earningBalance > 0 ? earningBalance * rate : 0
    balance = available + interest

    rows.push({ date: day, opening, deposits, withdrawals, fees, available, interest, balance })
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
  let feesPaid = 0
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
      feesPaid += row.fees
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
    feesPaid,
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
 * Checks a change (before -> after). Returns the first date the change pushes
 * the balance below zero where it wasn't before, or makes an already-negative
 * day worse. Returns null if the change is fine.
 *
 * The change can be to the transactions, to the rates (pass `afterRates`), or
 * both. Unlike findOverdraft, an overdraft that already exists does not block
 * unrelated changes, so deposits are always accepted.
 */
export function findNewOverdraft(before, after, rates, afterRates = rates) {
  if (after.length === 0) return null
  // Interest can't make a positive balance negative, so overdrafts can only
  // start on a transaction date: checking up to the last one is enough.
  const dates = [...before, ...after].map(t => t.date).sort()
  const range = { fromDate: dates[0], endDate: dates[dates.length - 1] }
  // Same range for both, so rows line up day by day.
  const old = simulateLedger({ transactions: before, rates, ...range })
  const next = simulateLedger({ transactions: after, rates: afterRates, ...range })
  for (let i = 0; i < next.length; i++) {
    const balance = next[i].available
    if (balance < -CENT && balance < old[i].available - CENT) return next[i].date
  }
  return null
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
    deposits += row.deposits - row.withdrawals - row.fees
    const reached = row.date === today ? row.available >= target : row.balance >= target
    if (reached) {
      return { date: row.date, days: daysBetween(today, row.date), interest, deposits, balance: row.balance }
    }
  }
  return null
}

const SUMMED = ['opening', 'deposits', 'withdrawals', 'fees', 'available', 'interest', 'balance']

/**
 * The whole account's ledger when several people save in it. Everyone earns
 * interest on their own money, so each person's transactions are simulated
 * on their own and the days are added up. `groups` is a list of transaction
 * lists, one per person. Same row fields as simulateLedger.
 */
export function simulateGroupLedger({ groups, rates, fromDate, endDate }) {
  const lists = groups.filter(list => list.length > 0)
  if (lists.length <= 1) return simulateLedger({ transactions: lists[0] ?? [], rates, fromDate, endDate })
  // A shared start date, so every person's rows line up day by day.
  const start = [fromDate, ...lists.flat().map(t => t.date)].sort()[0]
  const ledgers = lists.map(transactions => simulateLedger({ transactions, rates, fromDate: start, endDate }))
  return ledgers[0].map((row, i) => {
    const total = { date: row.date }
    for (const key of SUMMED) total[key] = ledgers.reduce((sum, l) => sum + l[i][key], 0)
    return total
  })
}

/**
 * Interest month by month, newest first, from a ledger that covers today.
 * Only days before today count (today's interest is credited tonight), the
 * same rule as summarize(). `balance` is the balance at the end of the month,
 * or so far for the current month.
 *   [{ month: '2026-11', interest, balance, current }]
 */
export function interestByMonth(ledger, today) {
  const months = new Map()
  for (const row of ledger) {
    if (row.date >= today) break
    const month = row.date.slice(0, 7)
    const entry = months.get(month) ?? { month, interest: 0, balance: 0, current: month === today.slice(0, 7) }
    entry.interest += row.interest
    entry.balance = row.balance
    months.set(month, entry)
  }
  return [...months.values()].reverse()
}
