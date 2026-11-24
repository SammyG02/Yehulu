import { useContext, useMemo } from 'react'
import { addDays } from '../lib/dates.js'
import { simulateGroupLedger, simulateLedger, summarize } from '../lib/interest.js'
import { chargesOf, plainRatesOf, ratesOf, toRates } from '../lib/storage.js'
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
    const ledger = simulateLedger({ transactions, rates: ratesOf(a, me), fromDate: today, endDate: today })
    return [a.id, summarize(ledger, today).balance]
  })), [accounts, today, me])
}

/**
 * Each shared account's total today (everyone's money), by account id. Built
 * from the anonymous activity list, so it works even when the owner keeps
 * balances private. Each member earns interest on their own money.
 */
// One person's balance from the anonymous activity list, at their own rate.
const activityBalance = (transactions, account, today) => summarize(simulateLedger({
  transactions,
  rates: transactions[0]?.rates ? toRates({ rates: transactions[0].rates }) : toRates(account),
  fromDate: today,
  endDate: today,
}), today).balance

/**
 * The whole account's balance today. The anonymous list has no daily charges,
 * so what they take is subtracted for the people whose money you can see.
 */
function accountTotal(account, today) {
  const byKey = new Map()
  for (const t of account.activity ?? []) byKey.set(t.memberKey, [...(byKey.get(t.memberKey) ?? []), t])
  const total = [...byKey.values()].reduce((sum, list) => sum + activityBalance(list, account, today), 0)
  return (account.members ?? []).reduce((sum, m) => {
    const transactions = account.transactions.filter(t => t.memberId === m.id)
    if (!transactions.length || !chargesOf(account, m.id).length) return sum
    const at = (rates) => summarize(simulateLedger({ transactions, rates, fromDate: today, endDate: today }), today).balance
    return sum + at(ratesOf(account, m.id)) - at(plainRatesOf(account, m.id))
  }, total)
}

export function useAccountTotals() {
  const { accounts, today } = useSavings()
  return useMemo(() => new Map(accounts.filter(a => a.cloud && a.members?.length > 1).map(a => {
    return [a.id, accountTotal(a, today)]
  })), [accounts, today])
}

/**
 * Shared account: the total today, and each member's balance today (for the
 * members you may see). Everyone earns interest on their own money.
 */
export function useMemberBalances() {
  const { account, allTransactions, today } = useSavings()
  return useMemo(() => {
    const group = (list, key) => {
      const map = new Map()
      for (const item of list) map.set(key(item), [...(map.get(key(item)) ?? []), item])
      return map
    }
    // The total comes from the anonymous list, so it's right even for members
    // who can only see their own transactions. Each person earns their own rate.
    const total = accountTotal(account, today)
    const byMember = new Map([...group(allTransactions, t => t.memberId)].map(([id, list]) => [id,
      summarize(simulateLedger({ transactions: list, rates: ratesOf(account, id), fromDate: today, endDate: today }), today).balance,
    ]))
    return { total, byMember }
  }, [account, allTransactions, today])
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
