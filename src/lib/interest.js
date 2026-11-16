// Yehulu interest rules:
//   - 40% annual rate, divided over 365 days
//   - 10% service charge taken from the interest (not the balance)
//   - interest is credited daily, so yesterday's interest earns interest today
export const ANNUAL_RATE = 0.40
export const SERVICE_CHARGE = 0.10
export const DAYS_IN_YEAR = 365

export const DAILY_RATE = (ANNUAL_RATE * (1 - SERVICE_CHARGE)) / DAYS_IN_YEAR
export const EFFECTIVE_ANNUAL_RATE = (1 + DAILY_RATE) ** DAYS_IN_YEAR - 1

// A zero or negative balance earns nothing (no negative interest).
export const dailyInterest = (balance) => (balance > 0 ? balance * DAILY_RATE : 0)

// Dates are local calendar days stored as 'YYYY-MM-DD'. Never use toISOString()
// for this: it converts to UTC and can shift the date by one day.
export const toDateKey = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Noon avoids DST edge cases around midnight.
export const parseDateKey = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

export const addDays = (key, days) => {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

/**
 * Walks the calendar one day at a time from the earliest relevant date to endDate.
 * Each day: apply that day's deposits and withdrawals, then credit interest on the
 * resulting balance. Money compounds from the day it arrives, and no day is counted twice.
 *
 * The starting balance is treated as a deposit made on startDate.
 * Rows always cover fromDate..endDate, even when there is no activity yet.
 */
export function simulateLedger({ startingBalance = 0, startDate, transactions = [], fromDate, endDate }) {
  const flows = new Map()
  const addFlow = (key, field, amount) => {
    const flow = flows.get(key) ?? { deposits: 0, withdrawals: 0 }
    flow[field] += amount
    flows.set(key, flow)
  }

  if (startingBalance > 0 && startDate) addFlow(startDate, 'deposits', startingBalance)
  for (const txn of transactions) {
    addFlow(txn.date, txn.type === 'deposit' ? 'deposits' : 'withdrawals', txn.amount)
  }

  // 'YYYY-MM-DD' strings sort chronologically.
  let day = [fromDate, ...flows.keys()].sort()[0]
  let balance = 0
  const rows = []

  while (day <= endDate) {
    const { deposits, withdrawals } = flows.get(day) ?? { deposits: 0, withdrawals: 0 }
    const opening = balance
    const balanceBeforeInterest = opening + deposits - withdrawals
    const interest = dailyInterest(balanceBeforeInterest)
    balance = balanceBeforeInterest + interest

    rows.push({
      date: day,
      opening,
      deposits,
      withdrawals,
      balanceBeforeInterest,
      dailyInterest: interest,
      balance,
    })
    day = addDays(day, 1)
  }

  return rows
}
