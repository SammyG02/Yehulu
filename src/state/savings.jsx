import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useToday } from '../hooks/useToday.js'
import { AuthContext, SavingsContext } from './contexts.js'
import { cloudApi, fetchAccounts } from '../lib/cloud.js'
import { toDateKey } from '../lib/dates.js'
import { formatDate, formatMoney } from '../lib/format.js'
import { findNewOverdraft, periodOn } from '../lib/interest.js'
import {
  emptyAccount, emptyState, loadState, MAX_ACCOUNTS, newId, sanitizeRates, saveState, STORAGE_KEY, toRates,
} from '../lib/storage.js'
import { supabase } from '../lib/supabase.js'

/**
 * The single source of truth for the app: every saving account, which one is
 * open, and every action that changes them. Pages read it with useSavings()
 * from hooks.js; nothing else writes to storage.
 *
 * Signed out, accounts live on the device (localStorage). Signed in, they live
 * in Supabase and can be shared: changes show at once and are saved in the
 * background; if saving fails, the app reloads from the server and says so.
 *
 * `account`, `goal`, `transactions` and `rates` are always the open account's.
 * In a shared account `transactions` are the signed-in person's own (their
 * balance and interest); `allTransactions` are every one they may see.
 */

const activeOf = (state) => state.accounts.find(a => a.id === state.activeId) ?? state.accounts[0]

/** Applies `fn` to one account (the open one unless `id` is given). */
const withAccount = (state, fn, id = state.activeId) => ({
  ...state,
  accounts: state.accounts.map(a => (a.id === id ? fn(a) : a)),
})

// Each member earns interest on their own money, so balance checks only look
// at one member's transactions. On the device there are no members (null).
const memberOf = (txn) => txn.memberId ?? null
const ofMember = (list, memberId) => list.filter(t => memberOf(t) === memberId)

const CLOUD_ACTIVE_KEY = 'yehuluCloudActive'
const readCloudActive = () => { try { return localStorage.getItem(CLOUD_ACTIVE_KEY) } catch { return null } }
const writeCloudActive = (id) => { try { localStorage.setItem(CLOUD_ACTIVE_KEY, id) } catch { /* ignore */ } }

const api = supabase ? cloudApi(supabase) : null

// Remembers that this device's accounts were already copied for a person, so
// the upload offer doesn't make duplicates.
const uploadedKey = (userId) => `yehuluUploaded:${userId}`
const wasUploaded = (userId) => { try { return Boolean(userId && localStorage.getItem(uploadedKey(userId))) } catch { return false } }
const markUploaded = (userId) => { try { localStorage.setItem(uploadedKey(userId), '1') } catch { /* ignore */ } }

export function SavingsProvider({ children }) {
  const today = useToday()
  const auth = useContext(AuthContext)
  const userId = auth?.user?.id ?? null
  const cloudMode = Boolean(userId)

  // Device data. Read synchronously on first render so a save can never
  // overwrite stored data with an empty initial state.
  const [localData, setLocalData] = useState(loadState)
  // Signed-in data: null until loaded.
  const [cloudData, setCloudData] = useState(null)
  const [cloudError, setCloudError] = useState(null)

  const data = cloudMode && cloudData ? cloudData : localData
  // Always holds the latest data of the current mode, even between a change
  // and the next render. Validation reads from here.
  const dataRef = useRef(data)
  dataRef.current = data
  const modeRef = useRef(cloudMode)
  modeRef.current = cloudMode

  const setData = useCallback((update) => {
    const next = typeof update === 'function' ? update(dataRef.current) : update
    dataRef.current = next
    if (modeRef.current) setCloudData(next)
    else setLocalData(next)
  }, [])

  const [composer, setComposer] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  useEffect(() => saveState(localData), [localData])

  // Keep several open tabs in sync (device data).
  useEffect(() => {
    const onStorage = (e) => { if (e.key === STORAGE_KEY) setLocalData(loadState()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => () => clearTimeout(toastTimer.current), [])

  const showToast = useCallback((message, action = null) => {
    clearTimeout(toastTimer.current)
    setToast({ id: Date.now(), message, action })
    toastTimer.current = setTimeout(() => setToast(null), action ? 6000 : 3000)
  }, [])

  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current)
    setToast(null)
  }, [])

  // ---- cloud loading -------------------------------------------------------

  /** Reloads everything from Supabase, keeping the open account if it still exists. */
  const reload = useCallback(async () => {
    if (!api || !userId) return
    try {
      const accounts = await fetchAccounts(supabase, userId)
      setCloudError(null)
      setCloudData(prev => {
        const wanted = prev?.activeId ?? readCloudActive()
        const activeId = accounts.some(a => a.id === wanted) ? wanted : accounts[0]?.id ?? null
        const next = { version: 4, activeId, accounts }
        if (modeRef.current) dataRef.current = next
        return next
      })
      return accounts
    } catch (err) {
      setCloudError(err.message)
      return null
    }
  }, [userId])

  /** Copies every device account that has something in it to Supabase. */
  const uploadLocal = useCallback(async () => {
    const local = loadState()
    const worth = local.accounts.filter(a => a.transactions.length > 0 || a.goal.target)
    for (const a of worth) {
      await api.createAccount({
        id: newId(),
        name: a.name,
        rates: a.rates,
        goal: a.goal,
        // Fresh ids: old saves may have ids the database won't accept.
        transactions: a.transactions.map(t => ({ ...t, id: newId() })),
      }, userId)
    }
    markUploaded(userId)
    return worth.length
  }, [userId])

  // Load on sign-in. A first sign-in with nothing in the cloud uploads this
  // device's accounts, or starts one empty account (unless joining a friend's).
  useEffect(() => {
    if (!userId) {
      setCloudData(null)
      setCloudError(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const accounts = await reload()
      if (cancelled || !accounts || accounts.length > 0) return
      try {
        const uploaded = await uploadLocal()
        if (uploaded === 0 && !window.location.pathname.startsWith('/join/')) {
          await api.createAccount(emptyAccount(toDateKey(new Date()), { id: newId() }), userId)
        }
        if (cancelled) return
        await reload()
        if (uploaded) showToast(`${uploaded} account${uploaded === 1 ? '' : 's'} uploaded from this device`)
      } catch (err) {
        if (!cancelled) setCloudError(err.message)
      }
    })()
    return () => { cancelled = true }
  }, [userId, reload, uploadLocal, showToast])

  // Coming back to the app: the live connection may have dropped while the
  // phone slept, so fetch the latest.
  useEffect(() => {
    if (!api || !userId) return
    const onVisible = () => { if (document.visibilityState === 'visible') reload() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [userId, reload])

  // Live updates: when anyone changes a shared account, reload (debounced).
  useEffect(() => {
    if (!api || !userId) return
    let timer
    const later = () => { clearTimeout(timer); timer = setTimeout(reload, 500) }
    const channel = supabase.channel(`yehulu-${userId}`)
    for (const table of ['accounts', 'account_members', 'rates', 'transactions']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, later)
    }
    channel.subscribe()
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [userId, reload])

  /** Runs a cloud save in the background. On failure: say so, then reload. */
  const remote = useCallback((run) => {
    if (!modeRef.current || !api) return
    Promise.resolve()
      .then(run)
      .catch((err) => {
        showToast(`Couldn't save: ${err.message}`)
        reload()
      })
  }, [showToast, reload])

  // ---- derived -------------------------------------------------------------

  const cloudStatus = !auth?.enabled ? 'off'
    : !auth.ready ? 'loading'
      : !cloudMode ? 'off'
        : cloudError && !cloudData ? 'error'
          : !cloudData ? 'loading'
            : cloudData.accounts.length > 0 ? 'ready' : 'empty'

  // While the cloud loads, `data` is the device's; the app shows a loader then.
  const account = (data.accounts.length ? activeOf(data) : null) ?? localData.accounts[0]
  const me = cloudMode ? userId : null
  const mine = useMemo(
    () => (account.cloud ? ofMember(account.transactions, me) : account.transactions),
    [account, me],
  )
  const isOwner = !account.cloud || account.role === 'owner'
  // A shared account: more than one member (or the chance to invite some).
  const shared = Boolean(account.cloud && account.members?.length > 1)
  const canEdit = useCallback((txn) => !account.cloud || isOwner || txn.memberId === me, [account.cloud, isOwner, me])
  const memberName = useCallback((id) => {
    if (id === me) return 'You'
    return account.members?.find(m => m.id === id)?.name ?? 'Former member'
  }, [account.members, me])
  const rates = useMemo(() => toRates(account), [account])
  const currentRate = useMemo(() => periodOn(account.rates, today), [account.rates, today])

  // ---- transactions --------------------------------------------------------

  /**
   * Checks a change against the latest data, for one member. Only a change
   * that creates or deepens an overdraft is rejected; one that already exists
   * in the history doesn't block anything else.
   */
  const newOverdraft = useCallback((memberId, nextList) => {
    const current = activeOf(dataRef.current)
    return findNewOverdraft(ofMember(current.transactions, memberId), ofMember(nextList, memberId), toRates(current))
  }, [])
  const overdraftError = useCallback((memberId, nextList) => {
    const date = newOverdraft(memberId, nextList)
    return date ? `Not enough money. The balance would go below zero on ${formatDate(date)}.` : null
  }, [newOverdraft])

  const label = (txn) => `${txn.type === 'deposit' ? 'Deposit' : 'Withdrawal'} of ${formatMoney(txn.amount)}`

  /** Returns an error message, or null on success. `txn.memberId`: whose money (owner only). */
  const addTransaction = useCallback((txn) => {
    const current = activeOf(dataRef.current)
    const memberId = current.cloud ? (txn.memberId ?? userId) : null
    const record = { ...txn, id: newId() }
    if (current.cloud) record.memberId = memberId
    else delete record.memberId
    const error = overdraftError(memberId, [...current.transactions, record])
    if (error) return error
    setData(d => withAccount(d, a => ({ ...a, transactions: [...a.transactions, record] })))
    remote(() => api.addTransaction(current.id, record))
    showToast(`${label(txn)} added`)
    return null
  }, [userId, setData, overdraftError, remote, showToast])

  /** Returns an error message, or null on success. */
  const updateTransaction = useCallback((id, changes) => {
    const current = activeOf(dataRef.current)
    const original = current.transactions.find(t => t.id === id)
    if (!original) return 'This transaction no longer exists.'
    // Whose money it is never changes on edit.
    const allowed = { ...changes }
    delete allowed.memberId
    const apply = (list) => list.map(t => (t.id === id ? { ...t, ...allowed } : t))
    const error = overdraftError(memberOf(original), apply(current.transactions))
    if (error) return error
    setData(d => withAccount(d, a => ({ ...a, transactions: apply(a.transactions) })))
    remote(() => api.updateTransaction(id, { ...original, ...allowed }))
    showToast('Transaction updated')
    return null
  }, [setData, overdraftError, remote, showToast])

  /** Returns true if deleted. */
  const deleteTransaction = useCallback((txn) => {
    const current = activeOf(dataRef.current)
    const remaining = current.transactions.filter(t => t.id !== txn.id)
    const overdraft = newOverdraft(memberOf(txn), remaining)
    if (overdraft && !window.confirm(
      `Deleting this leaves the balance below zero on ${formatDate(overdraft)}. Delete it anyway?`,
    )) return false
    setData(d => withAccount(d, a => ({ ...a, transactions: a.transactions.filter(t => t.id !== txn.id) })))
    remote(() => api.deleteTransaction(txn.id))
    showToast(`${label(txn)} deleted`, {
      label: 'Undo',
      // Back into the account it came from, even if another one is open now.
      onClick: () => {
        setData(d => withAccount(d, a => ({ ...a, transactions: [...a.transactions, txn] }), current.id))
        remote(() => api.addTransaction(current.id, txn))
      },
    })
    return true
  }, [setData, newOverdraft, remote, showToast])

  // ---- rates and goal ------------------------------------------------------

  /**
   * Replaces the rate history (owner only). If the new rates would push anyone
   * below zero where they weren't before, asks first. Returns true if saved.
   */
  const changeRates = useCallback((nextRates, message = 'Rate saved') => {
    const current = activeOf(dataRef.current)
    const next = sanitizeRates(nextRates)
    if (next.length === 0) return false
    const memberIds = [...new Set(current.transactions.map(memberOf))]
    const overdraft = memberIds
      .map(m => {
        const list = ofMember(current.transactions, m)
        return findNewOverdraft(list, list, toRates(current), toRates({ rates: next }))
      })
      .filter(Boolean)
      .sort()[0]
    if (overdraft && !window.confirm(
      `With this rate a balance goes below zero on ${formatDate(overdraft)}. Save anyway?`,
    )) return false
    setData(d => withAccount(d, a => ({ ...a, rates: next })))
    remote(() => api.setRates(current.id, next))
    showToast(message)
    return true
  }, [setData, remote, showToast])

  // The goal planner saves as you type: send to the cloud once typing pauses.
  const goalTimer = useRef(null)
  const updateGoal = useCallback((goal) => {
    const current = activeOf(dataRef.current)
    setData(d => withAccount(d, a => ({ ...a, goal })))
    if (!current.cloud) return
    clearTimeout(goalTimer.current)
    goalTimer.current = setTimeout(() => remote(() => api.setGoal(current.id, userId, goal)), 700)
  }, [userId, setData, remote])

  // ---- accounts ------------------------------------------------------------

  /** Creates an account and opens it. Returns its id, or null if there are too many. */
  const addAccount = useCallback(({ name, annualRate }) => {
    if (dataRef.current.accounts.length >= MAX_ACCOUNTS) return null
    const created = emptyAccount(today, { name, annualRate })
    const cloud = modeRef.current
    const shown = cloud
      ? { ...created, cloud: true, role: 'owner', ownerId: userId, membersSeeAll: true, inviteCode: null, activity: [],
          members: [{ id: userId, role: 'owner', name: auth?.user?.name ?? 'You', avatarUrl: auth?.user?.avatarUrl ?? null }] }
      : created
    setData(d => ({ ...d, activeId: created.id, accounts: [...d.accounts, shown] }))
    if (cloud) {
      writeCloudActive(created.id)
      remote(() => api.createAccount(created, userId))
    }
    showToast(`${name} created`)
    return created.id
  }, [today, userId, auth?.user?.name, auth?.user?.avatarUrl, setData, remote, showToast])

  /** Deletes an account (owner only, never the last one). Returns true if deleted. */
  const deleteAccount = useCallback((id) => {
    const { accounts } = dataRef.current
    const target = accounts.find(a => a.id === id)
    if (!target || accounts.length < 2) return false
    if (target.cloud && target.role !== 'owner') return false
    setData(d => {
      const rest = d.accounts.filter(a => a.id !== id)
      return { ...d, accounts: rest, activeId: d.activeId === id ? rest[0].id : d.activeId }
    })
    if (target.cloud) remote(() => api.deleteAccount(id))
    showToast(`${target.name} deleted`)
    return true
  }, [setData, remote, showToast])

  const renameAccount = useCallback((name, id) => {
    const target = id ?? dataRef.current.activeId
    setData(d => withAccount(d, a => ({ ...a, name }), target))
    if (activeOf({ ...dataRef.current, activeId: target })?.cloud) remote(() => api.renameAccount(target, name))
    showToast('Name saved')
  }, [setData, remote, showToast])

  const switchAccount = useCallback((id) => {
    setData(d => (d.accounts.some(a => a.id === id) ? { ...d, activeId: id } : d))
    if (modeRef.current) writeCloudActive(id)
  }, [setData])

  // ---- sharing (signed in) -------------------------------------------------

  const setMembersSeeAll = useCallback((value) => {
    const current = activeOf(dataRef.current)
    setData(d => withAccount(d, a => ({ ...a, membersSeeAll: value })))
    remote(() => api.setMembersSeeAll(current.id, value))
  }, [setData, remote])

  /** Turns the invite link on (new code) or off. Returns the code, or null. */
  const setInvite = useCallback(async (enabled) => {
    const current = activeOf(dataRef.current)
    try {
      const code = await api.setInvite(current.id, enabled)
      setData(d => withAccount(d, a => ({ ...a, inviteCode: code ?? null }), current.id))
      return code ?? null
    } catch (err) {
      showToast(`Couldn't change the invite link: ${err.message}`)
      return null
    }
  }, [setData, showToast])

  const removeMember = useCallback((memberId) => {
    const current = activeOf(dataRef.current)
    const member = current.members?.find(m => m.id === memberId)
    setData(d => withAccount(d, a => ({
      ...a,
      members: a.members.filter(m => m.id !== memberId),
      transactions: a.transactions.filter(t => t.memberId !== memberId),
    })))
    remote(async () => { await api.removeMember(current.id, memberId); await reload() })
    showToast(`${member?.name ?? 'Member'} removed`)
  }, [setData, remote, reload, showToast])

  /** Leaves a shared account (members only). */
  const leaveAccount = useCallback(() => {
    const current = activeOf(dataRef.current)
    if (!current.cloud || current.role === 'owner') return false
    setData(d => {
      const rest = d.accounts.filter(a => a.id !== current.id)
      return { ...d, accounts: rest, activeId: rest[0]?.id ?? null }
    })
    remote(async () => { await api.removeMember(current.id, userId); await reload() })
    showToast(`You left ${current.name}`)
    return true
  }, [userId, setData, remote, reload, showToast])

  /** Joins with an invite code and opens that account. Throws a readable error. */
  const joinAccount = useCallback(async (code) => {
    const id = await api.joinAccount(code)
    writeCloudActive(id)
    await reload()
    setCloudData(d => (d ? { ...d, activeId: id } : d))
    return id
  }, [reload])

  const invitePreview = useCallback((code) => api.invitePreview(code), [])

  const actions = useMemo(() => ({
    addTransaction,
    updateTransaction,
    deleteTransaction,
    updateGoal,
    renameAccount,
    addAccount,
    deleteAccount,
    switchAccount,
    changeRates,
    setMembersSeeAll,
    setInvite,
    removeMember,
    leaveAccount,
    joinAccount,
    invitePreview,
    uploadLocal: async () => {
      const count = await uploadLocal()
      await reload()
      showToast(count ? `${count} account${count === 1 ? '' : 's'} uploaded` : 'Nothing to upload')
    },
    reload,
    replaceAll: (next) => {
      setLocalData(next)
      showToast('Backup restored')
    },
    reset: () => {
      setLocalData(emptyState())
      showToast('All data on this device deleted')
    },
    openComposer: (type = 'deposit') => setComposer({ mode: 'new', type }),
    editTransaction: (txn) => setComposer({ mode: 'edit', txn }),
    closeComposer: () => setComposer(null),
    showToast,
    dismissToast,
  }), [addTransaction, updateTransaction, deleteTransaction, updateGoal, renameAccount, addAccount, deleteAccount,
    switchAccount, changeRates, setMembersSeeAll, setInvite, removeMember, leaveAccount, joinAccount, invitePreview,
    uploadLocal, reload, showToast, dismissToast])

  const value = useMemo(() => ({
    today,
    data,
    localData,
    cloudMode,
    localUploaded: wasUploaded(userId),
    cloudStatus,
    cloudError,
    me,
    isOwner,
    shared,
    canEdit,
    memberName,
    accounts: data.accounts,
    account,
    goal: account.goal,
    transactions: mine,
    allTransactions: account.transactions,
    rates,
    currentRate,
    composer,
    toast,
    actions,
  }), [today, data, localData, cloudMode, userId, cloudStatus, cloudError, me, isOwner, shared, canEdit, memberName, account, mine, rates, currentRate,
    composer, toast, actions])

  return <SavingsContext.Provider value={value}>{children}</SavingsContext.Provider>
}
