import { isDateKey, toDateKey } from './dates.js'

export const STORAGE_KEY = 'yehuluSavings'
const SCHEMA_VERSION = 3

// Rates are stored as percentages (40 means 40%) so they display exactly as typed.
export const DEFAULT_ACCOUNT_NAME = 'My savings'
// The service charge is fixed by Yehulu at 10% of interest and isn't editable.
export const SERVICE_CHARGE = 10
export const DEFAULT_RATE = { annualRate: 40, serviceCharge: SERVICE_CHARGE }

export const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const EMPTY_GOAL = { target: null, monthly: 0 }

export const emptyState = (today = toDateKey(new Date())) => ({
  version: SCHEMA_VERSION,
  account: { name: DEFAULT_ACCOUNT_NAME, rates: [{ from: today, ...DEFAULT_RATE }] },
  goal: { ...EMPTY_GOAL },
  transactions: [],
})

/** A percentage from 0 to 100, or null. Blank, null and non-numbers are not 0%. */
const toPercent = (value) => {
  let n
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && value.trim() !== '') n = Number(value)
  else return null
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

/**
 * One rate period: { from, annualRate, serviceCharge }, or null if the date or
 * rate is invalid. The service charge is always the fixed 10%.
 */
export const sanitizeRate = (period) => {
  const annualRate = toPercent(period?.annualRate)
  if (!isDateKey(period?.from) || annualRate === null) return null
  return { from: period.from, annualRate, serviceCharge: SERVICE_CHARGE }
}

/**
 * Valid periods sorted by start date. If two start on the same day, the one
 * later in the list wins, so "add a period" can simply append.
 */
export const sanitizeRates = (list) => {
  const byDate = new Map()
  for (const period of Array.isArray(list) ? list : []) {
    const clean = sanitizeRate(period)
    if (clean) byDate.set(clean.from, clean)
  }
  return [...byDate.values()].sort((a, b) => a.from.localeCompare(b.from))
}

/**
 * The account: a name and its rate history. `defaultFrom` dates the single
 * period created from older saves (v1/v2 had one rate and no history) or when
 * the saved history is missing or broken.
 */
export const sanitizeAccount = (account, defaultFrom) => {
  let rates = sanitizeRates(account?.rates)
  if (rates.length === 0) {
    rates = [{
      from: defaultFrom,
      annualRate: toPercent(account?.annualRate) ?? DEFAULT_RATE.annualRate,
      serviceCharge: SERVICE_CHARGE,
    }]
  }
  return {
    name: String(account?.name ?? '').trim().slice(0, 40) || DEFAULT_ACCOUNT_NAME,
    rates,
  }
}

/** One period's percentages as fractions, the form the interest maths uses. */
export const toFraction = ({ from, annualRate, serviceCharge }) => ({
  from,
  annualRate: annualRate / 100,
  serviceCharge: serviceCharge / 100,
})

/** The account's whole rate history as fractions, for simulateLedger and friends. */
export const toRates = (account) => account.rates.map(toFraction)

/** Savings goal: a target balance and an optional monthly top-up. */
export const sanitizeGoal = (goal) => {
  const target = Number(goal?.target)
  const monthly = Number(goal?.monthly)
  return {
    target: target > 0 ? Math.round(target * 100) / 100 : null,
    monthly: monthly > 0 ? Math.round(monthly * 100) / 100 : 0,
  }
}

const DEFAULT_NOTES = new Set(['Deposit', 'Withdrawal'])

const sanitizeTransaction = (txn) => {
  const amount = Math.round(Number(txn?.amount) * 100) / 100
  if (!isDateKey(txn?.date) || !(amount > 0) || !['deposit', 'withdrawal'].includes(txn?.type)) return null
  const note = String(txn.note ?? txn.description ?? '').trim().slice(0, 60)
  return {
    id: txn.id != null ? String(txn.id) : newId(),
    type: txn.type,
    amount,
    date: txn.date,
    note: DEFAULT_NOTES.has(note) ? '' : note,
  }
}

/**
 * Turns anything previously saved (or imported) into the current shape.
 * - v1 had a separate "root capital" with no date. It becomes an "Opening
 *   balance" deposit on the first transaction's date (or today).
 * - v1 and v2 had a single rate. It becomes a rate history with one period
 *   starting on the first transaction's date (or today).
 */
export function migrate(raw, today) {
  if (!raw || typeof raw !== 'object') return emptyState(today)

  const transactions = (Array.isArray(raw.transactions) ? raw.transactions : [])
    .map(sanitizeTransaction)
    .filter(Boolean)

  if (raw.version === undefined) {
    const opening = Math.round(Number(raw.initialBalance) * 100) / 100
    if (opening > 0) {
      const date = isDateKey(raw.startDate)
        ? raw.startDate
        : transactions.map(t => t.date).sort()[0] ?? today
      transactions.unshift({ id: newId(), type: 'deposit', amount: opening, date, note: 'Opening balance' })
    }
  }

  // Older saves had one rate: it applies from the first transaction (or today).
  const firstDate = transactions.map(t => t.date).sort()[0] ?? today
  return {
    version: SCHEMA_VERSION,
    account: sanitizeAccount(raw.account, firstDate),
    goal: sanitizeGoal(raw.goal),
    transactions,
  }
}

export function loadState() {
  try {
    return migrate(JSON.parse(localStorage.getItem(STORAGE_KEY)), toDateKey(new Date()))
  } catch {
    return emptyState()
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage full or blocked (e.g. private mode). The app keeps working in memory.
  }
}

export const exportState = (state) =>
  JSON.stringify({ app: 'yehulu', exportedAt: new Date().toISOString(), ...state }, null, 2)

/** Throws with a readable message if the file isn't a Yehulu backup. */
export function parseBackup(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  if (!raw || !Array.isArray(raw.transactions)) {
    throw new Error("That file doesn't look like a Yehulu backup.")
  }
  return migrate(raw, toDateKey(new Date()))
}
