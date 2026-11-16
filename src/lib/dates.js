// Dates are local calendar days stored as 'YYYY-MM-DD' strings. These sort
// chronologically as plain strings. Never use toISOString() for them: it
// converts to UTC and can shift the date by a day.

export const toDateKey = (date) => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Noon avoids daylight-saving edge cases around midnight.
export const parseDateKey = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

export const addDays = (key, days) => {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

export const isDateKey = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && toDateKey(parseDateKey(value)) === value

/** Same day-of-month `months` later, clamped to the month's last day (31 Jan + 1 -> 28/29 Feb). */
export const addMonths = (key, months) => {
  const [y, m, d] = key.split('-').map(Number)
  const target = new Date(y, m - 1 + months, 1, 12)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d, lastDay))
  return toDateKey(target)
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export const daysBetween = (from, to) => Math.round((parseDateKey(to) - parseDateKey(from)) / 86_400_000)
