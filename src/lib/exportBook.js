// The Excel export of one account (as currently viewed): Transactions, Daily
// interest and Monthly sheets, from the same ledger the app shows.

import { feeOf } from './interest.js'

const r2 = (x) => Math.round(x * 100) / 100
const money = (v) => ({ v: r2(v), as: 'money' })
const date = (v) => ({ v, as: 'date' })
const bold = (v) => ({ v, as: 'bold' })

/**
 * account: { name }; view: 'Everyone' | 'You' | a member's name
 * transactions: the ones in view; ledger: the view's daily rows (covering today)
 * today: 'YYYY-MM-DD'; rate: { annualRate } (percent) in force today
 * whose(txn) -> a name, or null outside shared accounts
 * Returns [{ name, rows, widths, freezeRow }] for makeXlsx.
 */
export function buildExport({ account, view, transactions, ledger, today, rate, whose = () => null }) {
  const shared = transactions.some(t => whose(t))
  const title = [{ v: `${account.name}${view ? ` · ${view}` : ''}`, as: 'title' }]
  const info = [`Exported from Yehulu on ${today} · rate today ${rate.annualRate}% a year, 10% service charge on interest, 0.2% fee on withdrawals`]

  // Transactions, oldest first.
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date))
  const txHead = ['Date', 'Type', 'Amount', 'Fee', 'Money in / out', ...(shared ? ['Whose'] : []), 'Note', 'Source']
  const txRows = sorted.map(t => {
    const fee = feeOf(t)
    const moved = t.type === 'deposit' ? t.amount : -(t.amount + fee)
    const source = t.ref?.startsWith('y:') ? 'Statement'
      : /^(gap|opening)-/.test(t.ref ?? '') ? 'Statement balance line'
        : 'Added in app'
    return [
      date(t.date), t.type === 'deposit' ? 'Deposit' : 'Withdrawal', money(t.amount), fee ? money(fee) : null, money(moved),
      ...(shared ? [whose(t) ?? ''] : []), t.note ?? '', source,
    ]
  })

  // One row per day up to yesterday (today's interest is added tonight).
  const days = ledger.filter(r => r.date < today)
  const dayHead = ['Date', 'Deposits', 'Withdrawals', 'Fees', 'Balance before interest', 'Interest', 'Service charge (10%)', 'Interest credited', 'Closing balance']
  const dayRows = days.map(r => [
    date(r.date),
    r.deposits ? money(r.deposits) : null,
    r.withdrawals ? money(r.withdrawals) : null,
    r.fees ? money(r.fees) : null,
    money(r.available),
    money(r.grossInterest ?? r.interest),
    money(r.serviceCharge ?? 0),
    money(r.interest),
    money(r.balance),
  ])

  // Months, newest last; the current month so far.
  const months = new Map()
  for (const r of days) {
    const key = r.date.slice(0, 7)
    const m = months.get(key) ?? { key, deposits: 0, withdrawals: 0, fees: 0, interest: 0, charge: 0, balance: 0 }
    m.deposits += r.deposits
    m.withdrawals += r.withdrawals
    m.fees += r.fees
    m.interest += r.interest
    m.charge += r.serviceCharge ?? 0
    m.balance = r.balance
    months.set(key, m)
  }
  const monthHead = ['Month', 'Deposits', 'Withdrawals', 'Fees', 'Interest credited', 'Service charge paid', 'Balance at month end']
  const monthRows = [...months.values()].map(m => [
    m.key === today.slice(0, 7) ? `${m.key} (so far)` : m.key,
    money(m.deposits), money(m.withdrawals), money(m.fees), money(m.interest), money(m.charge), money(m.balance),
  ])
  const total = (i) => monthRows.reduce((s, row) => s + (row[i]?.v ?? 0), 0)
  const totals = monthRows.length
    ? [[bold('Total'), money(total(1)), money(total(2)), money(total(3)), money(total(4)), money(total(5)), null]]
    : []

  const sheet = (name, head, rows, widths) => ({
    name,
    rows: [title, info, [], head.map(bold), ...rows],
    widths,
    freezeRow: 4,
  })
  return [
    sheet('Transactions', txHead, txRows, [12, 12, 14, 10, 15, ...(shared ? [18] : []), 28, 22]),
    sheet('Daily interest', dayHead, dayRows, [12, 13, 13, 9, 22, 12, 19, 16, 16]),
    sheet('Monthly', monthHead, [...monthRows, ...totals], [16, 14, 14, 10, 17, 19, 20]),
  ]
}

/** A safe file name: "Yehulu ••4844 - Everyone - 2026-11-21.xlsx" */
export const exportFileName = (account, view, today) =>
  `${[account.name, view, today].filter(Boolean).join(' - ')}.xlsx`.replace(/[\\/:*?"<>|]/g, '')
