import { useEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from 'lucide-react'
import { formatDate, formatMoney, formatSigned } from '../../lib/format.js'
import { feeOf } from '../../lib/interest.js'
import { useSavings } from '../../state/hooks.js'

const plain = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * A withdrawal's amount: what really left the account (amount + 0.2% fee),
 * the figure on the Yehulu statement and SMS. Tap it (or hover on a computer)
 * for a small bubble with what it's made of.
 */
function WithdrawalAmount({ amount, fee, shown }) {
  // Placed on top of the page (lists sit in cards that clip their edges).
  const [at, setAt] = useState(null)
  const open = at !== null
  const box = useRef(null)
  const show = () => {
    const r = box.current?.getBoundingClientRect()
    if (r) setAt({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
  }
  const hide = () => setAt(null)
  useEffect(() => {
    if (!open) return
    const away = (e) => { if (!box.current?.contains(e.target)) hide() }
    const esc = (e) => { if (e.key === 'Escape') hide() }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', hide, true)
    }
  }, [open])

  return (
    <span ref={box} onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        onClick={() => (open ? hide() : show())}
        aria-expanded={open}
        aria-label={`${shown}: ${formatMoney(amount)} plus ${formatMoney(fee)} fee`}
        className="whitespace-nowrap rounded-md text-sm font-bold tabular-nums text-neg underline decoration-dotted decoration-neg/40 underline-offset-4 transition hover:decoration-neg"
      >
        {shown}
      </button>
      {open && (
        <span role="tooltip" style={{ top: at.top, right: at.right }} className="fixed z-50 block w-52 rounded-xl border border-line bg-surface p-3 text-left text-xs shadow-float">
          <span className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
            <span className="text-muted">Taken out</span><span>{plain(amount)}</span>
            <span className="text-muted">Fee (0.2%)</span><span>{plain(fee)}</span>
            <span className="border-t border-line pt-1 font-semibold">Left your account</span>
            <span className="border-t border-line pt-1 font-bold text-neg">{plain(amount + fee)}</span>
          </span>
        </span>
      )}
    </span>
  )
}

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
        ? <WithdrawalAmount amount={txn.amount} fee={fee} shown={shown} />
        : (
          <span className={`whitespace-nowrap text-sm font-bold tabular-nums ${isDeposit ? 'text-brand-ink' : 'text-neg'}`}>
            {shown}
          </span>
        )}
      <ChevronRight className={`hidden h-4 w-4 flex-shrink-0 text-muted sm:block ${editable ? '' : 'invisible'}`} aria-hidden="true" />
    </li>
  )
}
