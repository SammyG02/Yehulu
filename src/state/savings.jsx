import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToday } from '../hooks/useToday.js'
import { SavingsContext } from './contexts.js'
import { formatDate, formatMoney } from '../lib/format.js'
import { findNewOverdraft } from '../lib/interest.js'
import { emptyState, loadState, newId, saveState, STORAGE_KEY, toRates } from '../lib/storage.js'

/**
 * The single source of truth for the app: the account, its transactions, and
 * every action that changes them. Pages read it with useSavings() from
 * hooks.js; nothing else writes to storage.
 */

export function SavingsProvider({ children }) {
  const today = useToday()
  // Read synchronously on first render so a save can never overwrite stored
  // data with an empty initial state.
  const [data, setDataState] = useState(loadState)
  // Always holds the latest data, even between a change and the next render
  // (e.g. right after another tab syncs). Validation reads from here, never
  // from a value captured at render time.
  const dataRef = useRef(data)
  const setData = useCallback((update) => {
    const next = typeof update === 'function' ? update(dataRef.current) : update
    dataRef.current = next
    setDataState(next)
  }, [])
  const [composer, setComposer] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  useEffect(() => saveState(data), [data])

  // Keep several open tabs in sync.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === STORAGE_KEY) setData(loadState()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [setData])

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

  /**
   * Checks a change against the latest data. Only a change that creates or
   * deepens an overdraft is rejected; an overdraft that already exists in the
   * history doesn't block anything else.
   */
  const newOverdraft = useCallback((nextTransactions) => {
    const current = dataRef.current
    return findNewOverdraft(current.transactions, nextTransactions, toRates(current.account))
  }, [])
  const overdraftError = useCallback((nextTransactions) => {
    const date = newOverdraft(nextTransactions)
    return date ? `Not enough money. The balance would go below zero on ${formatDate(date)}.` : null
  }, [newOverdraft])

  const label = (txn) => `${txn.type === 'deposit' ? 'Deposit' : 'Withdrawal'} of ${formatMoney(txn.amount)}`

  /** Returns an error message, or null on success. */
  const addTransaction = useCallback((txn) => {
    const record = { id: newId(), ...txn }
    const error = overdraftError([...dataRef.current.transactions, record])
    if (error) return error
    setData(d => ({ ...d, transactions: [...d.transactions, record] }))
    showToast(`${label(txn)} added`)
    return null
  }, [setData, overdraftError, showToast])

  /** Returns an error message, or null on success. */
  const updateTransaction = useCallback((id, changes) => {
    const apply = (list) => list.map(t => (t.id === id ? { ...t, ...changes } : t))
    const error = overdraftError(apply(dataRef.current.transactions))
    if (error) return error
    setData(d => ({ ...d, transactions: apply(d.transactions) }))
    showToast('Transaction updated')
    return null
  }, [setData, overdraftError, showToast])

  /** Returns true if deleted. */
  const deleteTransaction = useCallback((txn) => {
    const remaining = dataRef.current.transactions.filter(t => t.id !== txn.id)
    const overdraft = newOverdraft(remaining)
    if (overdraft && !window.confirm(
      `Deleting this leaves the balance below zero on ${formatDate(overdraft)}. Delete it anyway?`,
    )) return false
    setData(d => ({ ...d, transactions: d.transactions.filter(t => t.id !== txn.id) }))
    showToast(`${label(txn)} deleted`, {
      label: 'Undo',
      onClick: () => setData(d => ({ ...d, transactions: [...d.transactions, txn] })),
    })
    return true
  }, [setData, newOverdraft, showToast])

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
  }), [addTransaction, updateTransaction, deleteTransaction, setData, showToast, dismissToast])

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
