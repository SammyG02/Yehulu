import { ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react'
import { formatDate, formatMoney, formatSigned } from '../../lib/format.js'
import { withdrawalFee } from '../../lib/interest.js'
import { useSavings } from '../../state/hooks.js'

/** One transaction. Tapping it opens the edit sheet. */
export function TransactionRow({ txn, showYear = true }) {
  const { today, actions } = useSavings()
  const isDeposit = txn.type === 'deposit'
  const Icon = isDeposit ? ArrowDownLeft : ArrowUpRight
  const title = txn.note || (isDeposit ? 'Deposit' : 'Withdrawal')
  const dateText = formatDate(txn.date, showYear
    ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'short' })

  return (
    <li>
      <button
        type="button"
        onClick={() => actions.editTransaction(txn)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-sunken/70 sm:px-5"
        aria-label={`${title}, ${formatSigned(txn.amount, txn.type)}, ${dateText}. Edit`}
      >
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${isDeposit ? 'bg-brand-soft text-brand-ink' : 'bg-neg-soft text-neg'}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {dateText}
            {txn.date > today && (
              <span className="rounded-md bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">Scheduled</span>
            )}
            {!isDeposit && <span>+{formatMoney(withdrawalFee(txn.amount))} fee</span>}
          </span>
        </span>
        <span className={`whitespace-nowrap text-sm font-bold tabular-nums ${isDeposit ? 'text-brand-ink' : 'text-neg'}`}>
          {formatSigned(txn.amount, txn.type)}
        </span>
        <ChevronRight className="hidden h-4 w-4 flex-shrink-0 text-muted sm:block" aria-hidden="true" />
      </button>
    </li>
  )
}
