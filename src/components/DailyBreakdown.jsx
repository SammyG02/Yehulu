import { useMemo, useState } from 'react'
import { formatAmount, formatDate } from '../lib/format.js'
import { Card, CardHeader } from './ui/Card.jsx'
import { Segmented } from './ui/Segmented.jsx'

const VIEWS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
]

/** Day-by-day ledger, for checking the numbers against a bank statement. */
export function DailyBreakdown({ ledger, today }) {
  const [view, setView] = useState('upcoming')

  const rows = useMemo(
    () => (view === 'upcoming'
      ? ledger.filter(r => r.date >= today)
      : ledger.filter(r => r.date < today).reverse()),
    [ledger, today, view],
  )

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <CardHeader
        title="Day by day"
        subtitle="Start + in/out + interest = end"
        action={<Segmented options={VIEWS} value={view} onChange={setView} label="Period" />}
        className="pb-4"
      />
      {rows.length === 0 ? (
        <p className="border-t border-line px-5 py-10 text-center text-sm text-muted">No earlier days yet.</p>
      ) : (
        <div className="scroll-thin max-h-[26rem] overflow-auto border-t border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-xs font-semibold text-muted shadow-[0_1px_0_rgb(var(--line))]">
              <tr>
                <th scope="col" className="px-4 py-2.5 sm:px-5">Date</th>
                <th scope="col" className="hidden px-3 py-2.5 text-right sm:table-cell">Start</th>
                <th scope="col" className="hidden px-3 py-2.5 text-right sm:table-cell">In / out</th>
                <th scope="col" className="px-3 py-2.5 text-right">Interest</th>
                <th scope="col" className="px-4 py-2.5 text-right sm:px-5">End</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60 tabular-nums">
              {rows.map(row => {
                const flow = row.deposits - row.withdrawals
                const flowText = flow === 0 ? null : `${flow > 0 ? '+' : '−'}${formatAmount(Math.abs(flow))}`
                const flowClass = flow > 0 ? 'text-brand-ink' : 'text-neg'
                const isToday = row.date === today
                return (
                  <tr key={row.date} className={isToday ? 'bg-brand-soft/60' : ''}>
                    <td className="whitespace-nowrap px-4 py-2.5 sm:px-5">
                      <span className="font-medium">{formatDate(row.date, { day: 'numeric', month: 'short' })}</span>
                      {isToday && <span className="ml-1.5 text-xs font-bold text-brand-ink">Today</span>}
                      {flowText && <span className={`block text-xs font-semibold sm:hidden ${flowClass}`}>{flowText}</span>}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right text-muted sm:table-cell">{formatAmount(row.opening)}</td>
                    <td className={`hidden px-3 py-2.5 text-right font-semibold sm:table-cell ${flowText ? flowClass : 'text-muted/50'}`}>
                      {flowText ?? '–'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-brand-ink">+{formatAmount(row.interest)}</td>
                    <td className="px-4 py-2.5 text-right font-bold sm:px-5">{formatAmount(row.balance)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
