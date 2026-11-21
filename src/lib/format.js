import { parseDateKey } from './dates.js'

export const CURRENCY = 'Br'

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const wholeMoney = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })

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

/**
 * What someone typed into an amount box, cleaned up: digits and at most one
 * decimal point with two decimals, no leading zeros, no commas. "1,2a3.456" → "123.45".
 */
export const cleanAmountInput = (text) => {
  let s = String(text).replace(/[^\d.]/g, '')
  const dot = s.indexOf('.')
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  return s.replace(/^0+(?=\d)/, '')
}

/** A cleaned amount with thousands separators, keeping what's typed after the point. "200000.5" → "200,000.5". */
export const groupAmountInput = (raw) => {
  const [whole, decimals] = String(raw).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return decimals === undefined ? grouped : `${grouped}.${decimals}`
}

/** An amount without "Br" (for bubbles and tables): 2,004.00 */
export const plain = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
