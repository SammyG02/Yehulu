import { useContext, useMemo } from 'react'
import { addDays } from '../lib/dates.js'
import { simulateLedger, summarize } from '../lib/interest.js'
import { toRates } from '../lib/storage.js'
import { SavingsContext, ThemeContext } from './contexts.js'

/** Account, transactions, derived values and every action (see savings.jsx). */
export const useSavings = () => useContext(SavingsContext)

/** Day-by-day ledger from the first transaction through `horizonDays` from today. */
export function useLedger(horizonDays) {
  const { transactions, rates, today } = useSavings()
  return useMemo(
    () => simulateLedger({ transactions, rates, fromDate: today, endDate: addDays(today, horizonDays - 1) }),
    [transactions, rates, today, horizonDays],
  )
}

/** Every account's balance today, by account id. Same figure as the Home balance card. */
export function useAccountBalances() {
  const { accounts, today } = useSavings()
  return useMemo(() => new Map(accounts.map(a => {
    const ledger = simulateLedger({ transactions: a.transactions, rates: toRates(a), fromDate: today, endDate: today })
    return [a.id, summarize(ledger, today).balance]
  })), [accounts, today])
}

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
