import { ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react'
import { formatDate, formatMoney, formatSigned, plain } from '../../lib/format.js'
import { feeOf } from '../../lib/interest.js'
import { useSavings } from '../../state/hooks.js'
import { InfoBubble } from '../ui/InfoBubble.jsx'

/** One transaction. Tapping it opens the edit sheet (if you may edit it). */
export function TransactionRow({ txn, showYear = true }) {
  const { today, actions, shared, canEdit, memberName } = useSavings()
  const editable = canEdit(txn)
  const who = shared && txn.memberId ? memberName(txn.memberId) : null
  const isDeposit = txn.type === 'deposit'
  const Icon = isDeposit ? ArrowDownLeft : ArrowUpRight
  const title = txn.note || (isDeposit ? 'Deposit' : 'Withdrawal')
  const fee = feeOf(txn)
  const shown = formatSigned(isDeposit ? txn.amount : txn.amount + fee, txn.type)
  const dateText = formatDate(txn.date, showYear
    ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
    : { weekday: 'short', day: 'numeric', month: 'short' })
  const Main = editable ? 'button' : 'div'

  return (
    <li className="flex items-center gap-2 pr-4 transition hover:bg-sunken/70 sm:pr-5">
      <Main
        {...(editable ? { type: 'button', onClick: () => actions.editTransaction(txn), 'aria-label': `${who ? `${who}: ` : ''}${title}, ${shown}, ${dateText}. Edit` } : {})}
        className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left sm:pl-5"
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
            </span>
          </span>
        </span>
      </Main>
      {fee > 0
        ? (
          // What left the account; tap for what it's made of.
          <InfoBubble
            label={shown}
            tone="neg"
            className="text-sm font-bold"
            width="w-52"
            ariaLabel={`${shown}: ${formatMoney(txn.amount)} plus ${formatMoney(fee)} fee`}
            rows={[['Taken out', plain(txn.amount)], ['Fee (0.2%)', plain(fee)], ['Left your account', plain(txn.amount + fee)]]}
          />
        )
        : (
          <span className={`whitespace-nowrap text-sm font-bold tabular-nums ${isDeposit ? 'text-brand-ink' : 'text-neg'}`}>
            {shown}
          </span>
        )}
      <ChevronRight className={`hidden h-4 w-4 flex-shrink-0 text-muted sm:block ${editable ? '' : 'invisible'}`} aria-hidden="true" />
    </li>
  )
}
