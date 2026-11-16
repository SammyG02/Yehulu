import { parseDateKey } from './dates.js'

export const CURRENCY = 'Br'

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const wholeMoney = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

/** "1,234.50". Pass { whole: true } for "1,235". */
export const formatAmount = (value, { whole = false } = {}) =>
  (whole ? wholeMoney : money).format(Math.abs(value) < 0.005 ? 0 : value)

/** "Br 1,234.50" */
export const formatMoney = (value, options) => `${CURRENCY} ${formatAmount(value, options)}`

/** "12.3K", for chart axes. */
export const formatCompact = (value) => compact.format(value)

/** 0.43307 -> "43.31%" */
export const formatPercent = (fraction, digits = 2) => `${(fraction * 100).toFixed(digits)}%`

export const formatDate = (key, options = { day: 'numeric', month: 'short', year: 'numeric' }) =>
  parseDateKey(key).toLocaleDateString(undefined, options)

/** "+Br 1,000.00" / "−Br 250.00" */
export const formatSigned = (value, type) => `${type === 'deposit' ? '+' : '−'}${formatMoney(value)}`

/** 500 -> "1 year, 4 months"; 12 -> "12 days" */
export const formatDuration = (days) => {
  if (days <= 0) return 'today'
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
  const years = Math.floor(days / 365)
  const months = Math.floor((days % 365) / 30.44)
  if (years === 0 && months === 0) return plural(days, 'day')
  return [years && plural(years, 'year'), months && plural(months, 'month')].filter(Boolean).join(', ')
}

export const greeting = (date = new Date()) => {
  const hour = date.getHours()
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}
