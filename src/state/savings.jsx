import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useToday } from '../hooks/useToday.js'
import { SavingsContext } from './contexts.js'
import { formatDate, formatMoney } from '../lib/format.js'
import { findNewOverdraft, periodOn } from '../lib/interest.js'
import {
  emptyAccount, emptyState, loadState, MAX_ACCOUNTS, newId, sanitizeRates, saveState, STORAGE_KEY, toRates,
} from '../lib/storage.js'

/**
 * The single source of truth for the app: every saving account, which one is
 * open, and every action that changes them. Pages read it with useSavings()
 * from hooks.js; nothing else writes to storage.
 *
 * `account`, `goal`, `transactions` and `rates` are always the open account's,
 * so pages don't need to know there are several.
 */

const activeOf = (state) => state.accounts.find(a => a.id === state.activeId) ?? state.accounts[0]

/** Applies `fn` to one account (the open one unless `id` is given). */
const withAccount = (state, fn, id = state.activeId) => ({
  ...state,
  accounts: state.accounts.map(a => (a.id === id ? fn(a) : a)),
})

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

  // The whole rate history (fractions) for the maths, and today's rate
  // (percentages) for display.
  const account = activeOf(data)
  const rates = useMemo(() => toRates(account), [account])
  const currentRate = useMemo(() => periodOn(account.rates, today), [account.rates, today])

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
    const current = activeOf(dataRef.current)
    return findNewOverdraft(current.transactions, nextTransactions, toRates(current))
  }, [])
  const overdraftError = useCallback((nextTransactions) => {
    const date = newOverdraft(nextTransactions)
    return date ? `Not enough money. The balance would go below zero on ${formatDate(date)}.` : null
  }, [newOverdraft])

  const label = (txn) => `${txn.type === 'deposit' ? 'Deposit' : 'Withdrawal'} of ${formatMoney(txn.amount)}`

  /** Returns an error message, or null on success. */
  const addTransaction = useCallback((txn) => {
    const record = { id: newId(), ...txn }
    const error = overdraftError([...activeOf(dataRef.current).transactions, record])
    if (error) return error
    setData(d => withAccount(d, a => ({ ...a, transactions: [...a.transactions, record] })))
    showToast(`${label(txn)} added`)
    return null
  }, [setData, overdraftError, showToast])

  /** Returns an error message, or null on success. */
  const updateTransaction = useCallback((id, changes) => {
    const apply = (list) => list.map(t => (t.id === id ? { ...t, ...changes } : t))
    const error = overdraftError(apply(activeOf(dataRef.current).transactions))
    if (error) return error
    setData(d => withAccount(d, a => ({ ...a, transactions: apply(a.transactions) })))
    showToast('Transaction updated')
    return null
  }, [setData, overdraftError, showToast])

  /**
   * Replaces the rate history. If the new rates would push the history below
   * zero where it wasn't before, asks first. Returns true if saved.
   */
  const changeRates = useCallback((nextRates, message = 'Rate saved') => {
    const current = activeOf(dataRef.current)
    const next = sanitizeRates(nextRates)
    if (next.length === 0) return false
    const overdraft = findNewOverdraft(
      current.transactions, current.transactions, toRates(current), toRates({ rates: next }),
    )
    if (overdraft && !window.confirm(
      `With this rate the balance goes below zero on ${formatDate(overdraft)}. Save anyway?`,
    )) return false
    setData(d => withAccount(d, a => ({ ...a, rates: next })))
    showToast(message)
    return true
  }, [setData, showToast])

  /** Returns true if deleted. */
  const deleteTransaction = useCallback((txn) => {
    const { activeId } = dataRef.current
    const remaining = activeOf(dataRef.current).transactions.filter(t => t.id !== txn.id)
    const overdraft = newOverdraft(remaining)
    if (overdraft && !window.confirm(
      `Deleting this leaves the balance below zero on ${formatDate(overdraft)}. Delete it anyway?`,
    )) return false
    setData(d => withAccount(d, a => ({ ...a, transactions: a.transactions.filter(t => t.id !== txn.id) })))
    showToast(`${label(txn)} deleted`, {
      label: 'Undo',
      // Back into the account it came from, even if another one is open now.
      onClick: () => setData(d => withAccount(d, a => ({ ...a, transactions: [...a.transactions, txn] }), activeId)),
    })
    return true
  }, [setData, newOverdraft, showToast])

  /** Creates an account and opens it. Returns its id, or null if there are too many. */
  const addAccount = useCallback(({ name, annualRate }) => {
    if (dataRef.current.accounts.length >= MAX_ACCOUNTS) return null
    const created = emptyAccount(today, { name, annualRate })
    setData(d => ({ ...d, activeId: created.id, accounts: [...d.accounts, created] }))
    showToast(`${name} created`)
    return created.id
  }, [today, setData, showToast])

  /** Deletes an account (never the last one). Returns true if deleted. */
  const deleteAccount = useCallback((id) => {
    const { accounts } = dataRef.current
    const target = accounts.find(a => a.id === id)
    if (!target || accounts.length < 2) return false
    setData(d => {
      const rest = d.accounts.filter(a => a.id !== id)
      return { ...d, accounts: rest, activeId: d.activeId === id ? rest[0].id : d.activeId }
    })
    showToast(`${target.name} deleted`)
    return true
  }, [setData, showToast])

  const actions = useMemo(() => ({
    addTransaction,
    updateTransaction,
    deleteTransaction,
    updateGoal: (goal) => setData(d => withAccount(d, a => ({ ...a, goal }))),
    renameAccount: (name, id) => {
      setData(d => withAccount(d, a => ({ ...a, name }), id))
      showToast('Name saved')
    },
    addAccount,
    deleteAccount,
    switchAccount: (id) => setData(d => (d.accounts.some(a => a.id === id) ? { ...d, activeId: id } : d)),
    changeRates,
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
  }), [addTransaction, updateTransaction, deleteTransaction, addAccount, deleteAccount, changeRates, setData, showToast, dismissToast])

  const value = useMemo(() => ({
    today,
    data,
    accounts: data.accounts,
    account,
    goal: account.goal,
    transactions: account.transactions,
    rates,
    currentRate,
    composer,
    toast,
    actions,
  }), [today, data, account, rates, currentRate, composer, toast, actions])

  return <SavingsContext.Provider value={value}>{children}</SavingsContext.Provider>
}
