import { useMemo } from 'react'
import { formatDate, formatMoney } from '../lib/format.js'
import { interestByMonth } from '../lib/interest.js'
import { useSavings } from '../state/hooks.js'
import { Sheet } from './ui/Sheet.jsx'

const monthName = (month) => formatDate(`${month}-01`, { month: 'long', year: 'numeric' })

/**
 * Interest earned in every month since the first deposit, newest first.
 * Follows the view: everyone, you, or the member you're viewing as.
 */
export function MonthlyInterestSheet({ open, onClose, ledger }) {
  const { today, shared, scope, viewMember } = useSavings()
  const months = useMemo(() => interestByMonth(ledger, today), [ledger, today])
  const total = months.reduce((sum, m) => sum + m.interest, 0)
  const best = months.reduce((top, m) => (m.interest > (top?.interest ?? 0) ? m : top), null)
  const most = best?.interest || 1

  const whose = !shared ? null : scope === 'all' ? 'Everyone' : viewMember ? viewMember.name : 'You'

  return (
    <Sheet open={open} onClose={onClose} title="Interest by month">
      <div className="rounded-2xl bg-brand-soft px-4 py-3">
        <p className="text-xs font-semibold text-brand-ink/80">{whose ? `${whose} · interest so far` : 'Interest so far'}</p>
        <p className="mt-0.5 text-2xl font-extrabold tabular-nums text-brand-ink">{formatMoney(total)}</p>
        {best && months.length > 1 && (
          <p className="mt-0.5 text-xs text-brand-ink/80">Best month: {monthName(best.month)}</p>
        )}
      </div>

      {months.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No interest yet. It starts the day after the first deposit.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {months.map(m => (
            <li key={m.month} className="py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">
                  {monthName(m.month)}
                  {m.current && <span className="ml-1.5 text-xs font-normal text-muted">so far</span>}
                </span>
                <span className="text-sm font-bold tabular-nums text-brand-ink">+{formatMoney(m.interest)}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, (m.interest / most) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {m.current ? 'Balance now' : 'Balance at month end'} {formatMoney(m.balance)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  )
}
