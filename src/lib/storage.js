import { isDateKey, toDateKey } from './dates.js'

export const STORAGE_KEY = 'yehuluSavings'
const SCHEMA_VERSION = 2

// Rates are stored as percentages (40 means 40%) so they display exactly as typed.
export const DEFAULT_ACCOUNT = { name: 'My savings', annualRate: 40, serviceCharge: 10 }

export const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

export const EMPTY_GOAL = { target: null, monthly: 0 }

export const emptyState = () => ({
  version: SCHEMA_VERSION,
  account: { ...DEFAULT_ACCOUNT },
  goal: { ...EMPTY_GOAL },
  transactions: [],
})

/** Account rates as fractions, the form the interest maths uses. */
export const toRates = (account) => ({
  annualRate: account.annualRate / 100,
  serviceCharge: account.serviceCharge / 100,
})

const clampPercent = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback
}

export const sanitizeAccount = (account) => ({
  name: String(account?.name ?? '').trim().slice(0, 40) || DEFAULT_ACCOUNT.name,
  annualRate: clampPercent(account?.annualRate, DEFAULT_ACCOUNT.annualRate),
  serviceCharge: clampPercent(account?.serviceCharge, DEFAULT_ACCOUNT.serviceCharge),
})

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
 * Version 1 had a separate "root capital" with no date. It becomes an
 * "Opening balance" deposit on the first transaction's date (or today).
 */
export function migrate(raw, today) {
  if (!raw || typeof raw !== 'object') return emptyState()

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

  return {
    version: SCHEMA_VERSION,
    account: sanitizeAccount(raw.account),
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
