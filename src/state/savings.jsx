import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useToday } from '../hooks/useToday.js'
import { addDays } from '../lib/dates.js'
import { formatDate, formatMoney } from '../lib/format.js'
import { findOverdraft, simulateLedger } from '../lib/interest.js'
import { emptyState, loadState, newId, saveState, STORAGE_KEY, toRates } from '../lib/storage.js'

/**
 * The single source of truth for the app: the account, its transactions, and
 * every action that changes them. Pages read from here; nothing else writes
 * to storage.
 */
const SavingsContext = createContext(null)

export function SavingsProvider({ children }) {
  const today = useToday()
  // Read synchronously on first render so a save can never overwrite stored
  // data with an empty initial state.
  const [data, setData] = useState(loadState)
  const [composer, setComposer] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  useEffect(() => saveState(data), [data])

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === STORAGE_KEY) setData(loadState()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const rates = useMemo(() => toRates(data.account), [data.account])

  const showToast = useCallback((message, action = null) => {
    clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), message, action })
    toastTimer.current = setTimeout(() => setToast(null), action ? 6000 : 3000)
  }, [])

  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current)
    setToast(null)
  }, [])

  const overdraftError = useCallback((transactions) => {
    const date = findOverdraft(transactions, rates)
    return date ? `Not enough money. The balance would go below zero on ${formatDate(date)}.` : null
  }, [rates])

  const label = (txn) => `${txn.type === 'deposit' ? 'Deposit' : 'Withdrawal'} of ${formatMoney(txn.amount)}`

  /** Returns an error message, or null on success. */
  const addTransaction = useCallback((txn) => {
    const record = { id: newId(), ...txn }
    const error = overdraftError([...data.transactions, record])
    if (error) return error
    setData(d => ({ ...d, transactions: [...d.transactions, record] }))
    showToast(`${label(txn)} added`)
    return null
  }, [data.transactions, overdraftError, showToast])

  /** Returns an error message, or null on success. */
  const updateTransaction = useCallback((id, changes) => {
    const next = data.transactions.map(t => (t.id === id ? { ...t, ...changes } : t))
    const error = overdraftError(next)
    if (error) return error
    setData(d => ({ ...d, transactions: next }))
    showToast('Transaction updated')
    return null
  }, [data.transactions, overdraftError, showToast])

  /** Returns true if deleted. */
  const deleteTransaction = useCallback((txn) => {
    const remaining = data.transactions.filter(t => t.id !== txn.id)
    const overdraft = findOverdraft(remaining, rates)
    if (overdraft && !window.confirm(
      `Without this deposit the balance goes below zero on ${formatDate(overdraft)}. Delete it anyway?`,
    )) return false
    setData(d => ({ ...d, transactions: d.transactions.filter(t => t.id !== txn.id) }))
    showToast(`${label(txn)} deleted`, {
      label: 'Undo',
      onClick: () => setData(d => ({ ...d, transactions: [...d.transactions, txn] })),
    })
    return true
  }, [data.transactions, rates, showToast])

  const actions = useMemo(() => ({
    addTransaction,
    updateTransaction,
    deleteTransaction,
    updateGoal: (goal) => setData(d => ({ ...d, goal })),
    updateAccount: (account) => {
      setData(d => ({ ...d, account }))
      showToast('Account saved')
    },
    replaceAll: (next) => {
      setData(next)
      showToast('Backup restored')
    },
    reset: () => {
      setData(emptyState())
      showToast('All data deleted')
    },
    openComposer: (type = 'deposit') => setComposer({ mode: 'new', type }),
    editTransaction: (txn) => setComposer({ mode: 'edit', txn }),
    closeComposer: () => setComposer(null),
    showToast,
    dismissToast,
  }), [addTransaction, updateTransaction, deleteTransaction, showToast, dismissToast])

  const value = useMemo(() => ({
    today,
    data,
    account: data.account,
    goal: data.goal,
    transactions: data.transactions,
    rates,
    composer,
    toast,
    actions,
  }), [today, data, rates, composer, toast, actions])

  return <SavingsContext.Provider value={value}>{children}</SavingsContext.Provider>
}

export const useSavings = () => useContext(SavingsContext)

/** Day-by-day ledger from the first transaction through `horizonDays` from today. */
export function useLedger(horizonDays) {
  const { transactions, rates, today } = useSavings()
  return useMemo(
    () => simulateLedger({ transactions, rates, fromDate: today, endDate: addDays(today, horizonDays - 1) }),
    [transactions, rates, today, horizonDays],
  )
}
