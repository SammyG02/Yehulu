import { useContext, useMemo } from 'react'
import { addDays } from '../lib/dates.js'
import { simulateGroupLedger, simulateLedger, summarize } from '../lib/interest.js'
import { toRates } from '../lib/storage.js'
import { AuthContext, ConfirmContext, SavingsContext, ThemeContext } from './contexts.js'

/** Account, transactions, derived values and every action (see savings.jsx). */
export const useSavings = () => useContext(SavingsContext)

/**
 * Day-by-day ledger from the first transaction through `horizonDays` from
 * today: your own money, or the whole shared account when that's the view.
 */
export function useLedger(horizonDays) {
  const { viewGroups, rates, today } = useSavings()
  return useMemo(
    () => simulateGroupLedger({ groups: viewGroups, rates, fromDate: today, endDate: addDays(today, horizonDays - 1) }),
    [viewGroups, rates, today, horizonDays],
  )
}

/**
 * Every account's balance today, by account id. Same figure as the Home
 * balance card: in a shared account, your own money.
 */
export function useAccountBalances() {
  const { accounts, today, me } = useSavings()
  return useMemo(() => new Map(accounts.map(a => {
    const transactions = a.cloud ? a.transactions.filter(t => t.memberId === me) : a.transactions
    const ledger = simulateLedger({ transactions, rates: toRates(a), fromDate: today, endDate: today })
    return [a.id, summarize(ledger, today).balance]
  })), [accounts, today, me])
}

/**
 * Each shared account's total today (everyone's money), by account id. Built
 * from the anonymous activity list, so it works even when the owner keeps
 * balances private. Each member earns interest on their own money.
 */
export function useAccountTotals() {
  const { accounts, today } = useSavings()
  return useMemo(() => new Map(accounts.filter(a => a.cloud && a.members?.length > 1).map(a => {
    const byMember = new Map()
    for (const t of a.activity ?? []) byMember.set(t.memberKey, [...(byMember.get(t.memberKey) ?? []), t])
    const total = [...byMember.values()].reduce((sum, transactions) => sum
      + summarize(simulateLedger({ transactions, rates: toRates(a), fromDate: today, endDate: today }), today).balance, 0)
    return [a.id, total]
  })), [accounts, today])
}

/**
 * Shared account: the total today, and each member's balance today (for the
 * members you may see). Everyone earns interest on their own money.
 */
export function useMemberBalances() {
  const { account, allTransactions, rates, today } = useSavings()
  return useMemo(() => {
    const balanceOf = (transactions) =>
      summarize(simulateLedger({ transactions, rates, fromDate: today, endDate: today }), today).balance
    const group = (list, key) => {
      const map = new Map()
      for (const item of list) map.set(key(item), [...(map.get(key(item)) ?? []), item])
      return map
    }
    // The total comes from the anonymous list, so it's right even for members
    // who can only see their own transactions.
    const total = [...group(account.activity ?? [], t => t.memberKey).values()].reduce((sum, list) => sum + balanceOf(list), 0)
    const byMember = new Map([...group(allTransactions, t => t.memberId)].map(([id, list]) => [id, balanceOf(list)]))
    return { total, byMember }
  }, [account.activity, allTransactions, rates, today])
}

/** confirm({ title, message, confirmLabel, danger }) → Promise<boolean> (see confirm.jsx). */
export const useConfirm = () => useContext(ConfirmContext)

/** { enabled, ready, user, signInWithGoogle, signOut } (see auth.jsx). */
export const useAuth = () => useContext(AuthContext)

/** { preference, resolved, setPreference } (see theme.jsx). */
export const useTheme = () => useContext(ThemeContext)

const readThemeColors = () => {
  const css = getComputedStyle(document.documentElement)
  const rgb = (name) => `rgb(${css.getPropertyValue(`--${name}`).trim().split(/\s+/).join(', ')})`
  return { brand: rgb('brand'), accent: rgb('accent'), line: rgb('line'), muted: rgb('muted'), ink: rgb('ink') }
}

/**
 * Theme colours as CSS colour strings, for libraries that need real values
 * (Recharts). Re-read whenever the resolved theme changes.
 */
export function useThemeColors() {
  const { resolved } = useTheme()
  return useMemo(() => ({ theme: resolved, ...readThemeColors() }), [resolved])
}
