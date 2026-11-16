import { useContext, useMemo } from 'react'
import { addDays } from '../lib/dates.js'
import { simulateLedger } from '../lib/interest.js'
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
