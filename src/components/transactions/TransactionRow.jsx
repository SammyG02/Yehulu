import { ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react'
import { formatDate, formatMoney, formatSigned } from '../../lib/format.js'
import { feeOf } from '../../lib/interest.js'
import { useSavings } from '../../state/hooks.js'

/** One transaction. Tapping it opens the edit sheet (if you may edit it). */
export function TransactionRow({ txn, showYear = true }) {
  const { today, actions, shared, canEdit, memberName } = useSavings()
  const editable = canEdit(txn)
  const who = shared && txn.memberId ? memberName(txn.memberId) : null
  const isDeposit = txn.type === 'deposit'
  const Icon = isDeposit ? ArrowDownLeft : ArrowUpRight
  const title = txn.note || (isDeposit ? 'Deposit' : 'Withdrawal')
  // A withdrawal shows what really left the account (amount + 0.2% fee), the
  // figure on the Yehulu statement and SMS; the line below says what it's made of.
  const fee = feeOf(txn)
  const moved = isDeposit ? txn.amount : txn.amount + fee
  const shown = formatSigned(moved, txn.type)
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
        aria-label={`${who ? `${who}: ` : ''}${title}, ${shown}${fee ? `, ${formatMoney(txn.amount)} plus ${formatMoney(fee)} fee` : ''}, ${dateText}${editable ? '. Edit' : ''}`}
      >
        <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${isDeposit ? 'bg-brand-soft text-brand-ink' : 'bg-neg-soft text-neg'}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
            {txn.date > today && (
              <span className="flex-shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">Scheduled</span>
            )}
            <span className="truncate">
              {who && <span className="font-semibold text-ink">{who} · </span>}
              {dateText}
              {!isDeposit && !fee && ' · no fee'}
            </span>
          </span>
          {fee > 0 && (
            <span className="block truncate text-xs text-muted tabular-nums">
              {formatMoney(txn.amount)} + {formatMoney(fee)} fee (0.2%)
            </span>
          )}
        </span>
        <span className={`whitespace-nowrap text-sm font-bold tabular-nums ${isDeposit ? 'text-brand-ink' : 'text-neg'}`}>
          {shown}
        </span>
        <ChevronRight className={`hidden h-4 w-4 flex-shrink-0 text-muted sm:block ${editable ? '' : 'invisible'}`} aria-hidden="true" />
      </button>
    </li>
  )
}
