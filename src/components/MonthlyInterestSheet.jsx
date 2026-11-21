import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDate, formatMoney } from '../lib/format.js'
import { interestByMonth, periodOn } from '../lib/interest.js'
import { ratesOf } from '../lib/storage.js'
import { useSavings } from '../state/hooks.js'
import { Sheet } from './ui/Sheet.jsx'

const plain = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const monthName = (month) => formatDate(`${month}-01`, { month: 'long', year: 'numeric' })

function Summary({ label, value, note }) {
  return (
    <div className="rounded-2xl bg-brand-soft px-4 py-3">
      <p className="text-xs font-semibold text-brand-ink/80">{label}</p>
      <p className="mt-0.5 text-2xl font-extrabold tabular-nums text-brand-ink">{formatMoney(value)}</p>
      {note && <p className="mt-0.5 text-xs text-brand-ink/80">{note}</p>}
    </div>
  )
}

function Bar({ value, most }) {
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
      <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, (value / (most || 1)) * 100)}%` }} />
    </div>
  )
}

/** Every month since the first deposit, newest first. Tap one to see its days. */
function MonthList({ months, whose, onPick }) {
  const total = months.reduce((sum, m) => sum + m.interest, 0)
  const best = months.reduce((top, m) => (m.interest > (top?.interest ?? 0) ? m : top), null)
  return (
    <>
      <Summary
        label={whose ? `${whose} · interest so far` : 'Interest so far'}
        value={total}
        note={best && months.length > 1 ? `Best month: ${monthName(best.month)}` : null}
      />
      {months.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No interest yet. The first deposit's interest is added overnight.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {months.map(m => (
            <li key={m.month}>
              <button type="button" onClick={() => onPick(m.month)} className="-mx-2 block w-[calc(100%+1rem)] rounded-xl px-2 py-3 text-left transition hover:bg-sunken/70">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-semibold">
                    {monthName(m.month)}
                    {m.current && <span className="ml-1.5 text-xs font-normal text-muted">so far</span>}
                  </span>
                  <span className="flex items-center gap-1 text-sm font-bold tabular-nums text-brand-ink">
                    +{formatMoney(m.interest)}
                    <ChevronRight className="h-4 w-4 text-muted" aria-hidden="true" />
                  </span>
                </span>
                <Bar value={m.interest} most={best?.interest} />
                <span className="mt-1 block text-xs text-muted">
                  {m.current ? 'Balance now' : 'Balance at month end'} {formatMoney(m.balance)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** One month, day by day, newest first. */
/**
 * The day's interest, tappable (or hover on a computer): a small bubble shows
 * how it came to be, the way Yehulu works it out.
 *   rate: the annual rate that day (fraction), or null when several people at
 *   different rates are added up (then only interest and charge are shown).
 */
function InterestAmount({ day, rate }) {
  // Placed on top of the page, like the withdrawal bubble.
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
  const gross = day.grossInterest ?? day.interest
  const charge = day.serviceCharge ?? 0
  const pct = rate == null ? null : Math.round(rate * 10000) / 100

  return (
    <span ref={box} onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        onClick={() => (open ? hide() : show())}
        aria-expanded={open}
        aria-label={`How +${formatMoney(day.interest)} was worked out`}
        className="rounded-md text-sm font-bold tabular-nums text-brand-ink underline decoration-dotted decoration-brand/50 underline-offset-4 transition hover:decoration-brand"
      >
        +{formatMoney(day.interest)}
      </button>
      {open && (
        <span role="tooltip" style={{ top: at.top, right: at.right }} className="fixed z-[60] block w-56 rounded-xl border border-line bg-surface p-3 text-left text-xs shadow-float">
          <span className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
            <span className="text-muted">Balance that day</span><span>{plain(day.available)}</span>
            <span className="text-muted">{pct != null ? `Interest (${pct}% ÷ 365)` : 'Interest'}</span><span>{plain(gross)}</span>
            <span className="text-muted">Charge (10%)</span><span>{plain(charge)}</span>
            <span className="border-t border-line pt-1 font-semibold">Added overnight</span>
            <span className="border-t border-line pt-1 font-bold text-brand-ink">{plain(day.interest)}</span>
          </span>
        </span>
      )}
    </span>
  )
}

function DayList({ ledger, today, month, whose, onBack, rateOn }) {
  const days = useMemo(
    () => ledger.filter(r => r.date < today && r.date.startsWith(month)).reverse(),
    [ledger, today, month],
  )
  const total = days.reduce((sum, d) => sum + d.interest, 0)
  const current = month === today.slice(0, 7)
  return (
    <>
      <button type="button" onClick={onBack} className="-ml-1 mb-3 flex items-center gap-1 text-sm font-semibold text-brand-ink hover:underline">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" /> All months
      </button>
      <Summary
        label={`${whose ? `${whose} · ` : ''}${monthName(month)}${current ? ' so far' : ''}`}
        value={total}
        note={days.length ? `${days.length} day${days.length === 1 ? '' : 's'} of interest` : null}
      />
      {days.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          {current ? "No interest yet this month. Today's is added tonight." : 'No interest this month.'}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {days.map(d => (
            <li key={d.date} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">{formatDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <InterestAmount day={d} rate={rateOn(d.date)} />
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Balance {formatMoney(d.balance)}
                {d.deposits > 0 && ` · put in ${formatMoney(d.deposits)}`}
                {d.withdrawals > 0 && ` · took out ${formatMoney(d.withdrawals)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * Interest by month, or one month day by day (`month`, e.g. "2026-11").
 * Follows the view: everyone, you, or the member you're viewing as.
 */
export function MonthlyInterestSheet({ open, onClose, ledger, month: startMonth = null }) {
  const { today, shared, scope, viewMember, account, rates } = useSavings()
  // The annual rate behind a day's interest (fraction). For everyone in a shared
  // account it's only one number if everyone earns the same rate that day.
  const rateOn = (date) => {
    if (shared && scope === 'all') {
      const each = account.members.map(m => periodOn(ratesOf(account, m.id), date).annualRate)
      return each.every(r => r === each[0]) ? each[0] : null
    }
    return periodOn(rates, date).annualRate
  }
  const months = useMemo(() => interestByMonth(ledger, today), [ledger, today])
  const [picked, setPicked] = useState(null)
  // Reset to where it was opened from each time it opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setPicked(startMonth)
  }

  const whose = !shared ? null : scope === 'all' ? 'Everyone' : viewMember ? viewMember.name : 'You'

  return (
    <Sheet open={open} onClose={onClose} title={picked ? 'Interest by day' : 'Interest by month'}>
      {picked
        ? <DayList ledger={ledger} today={today} month={picked} whose={whose} onBack={() => setPicked(null)} rateOn={rateOn} />
        : <MonthList months={months} whose={whose} onPick={setPicked} />}
    </Sheet>
  )
}
