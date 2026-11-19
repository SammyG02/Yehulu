import { ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react'
import { formatDate, formatMoney, formatSigned } from '../../lib/format.js'
import { withdrawalFee } from '../../lib/interest.js'
import { useSavings } from '../../state/hooks.js'

/** One transaction. Tapping it opens the edit sheet (if you may edit it). */
export function TransactionRow({ txn, showYear = true }) {
  const { today, actions, shared, canEdit, memberName } = useSavings()
  const editable = canEdit(txn)
  const who = shared && txn.memberId ? memberName(txn.memberId) : null
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
        onClick={editable ? () => actions.editTransaction(txn) : undefined}
        disabled={!editable}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition enabled:hover:bg-sunken/70 disabled:cursor-default sm:px-5"
        aria-label={`${who ? `${who}: ` : ''}${title}, ${formatSigned(txn.amount, txn.type)}, ${dateText}${editable ? '. Edit' : ''}`}
      >
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${isDeposit ? 'bg-brand-soft text-brand-ink' : 'bg-neg-soft text-neg'}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
            {who && <span className="font-semibold text-ink">{who}</span>}
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
        <ChevronRight className={`hidden h-4 w-4 flex-shrink-0 text-muted sm:block ${editable ? '' : 'invisible'}`} aria-hidden="true" />
      </button>
    </li>
  )
}
