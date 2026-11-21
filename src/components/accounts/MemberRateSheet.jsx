import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { isDateKey } from '../../lib/dates.js'
import { formatDate } from '../../lib/format.js'
import { periodOn } from '../../lib/interest.js'
import { SERVICE_CHARGE } from '../../lib/storage.js'
import { useConfirm, useSavings } from '../../state/hooks.js'
import { Button } from '../ui/Button.jsx'
import { AffixInput, Field, inputClass } from '../ui/Field.jsx'
import { Sheet } from '../ui/Sheet.jsx'

/**
 * Owner: give one member their own rate. Everyone earns the account rate
 * unless the owner sets one here; it's for the odd person whose Yehulu rate
 * is different.
 */
export function MemberRateSheet({ member, open, onClose }) {
  const { account, allTransactions, today, actions } = useSavings()
  const confirm = useConfirm()
  const own = member?.rates ?? null
  const accountRate = periodOn(account.rates, today).annualRate
  // Default start: their first transaction, so one rate covers all their money.
  const firstDate = allTransactions.filter(t => t.memberId === member?.id).map(t => t.date).sort()[0] ?? today
  const [rate, setRate] = useState('')
  const [from, setFrom] = useState(firstDate)
  const [tried, setTried] = useState(false)
  // Start fresh each time it opens, or opens for someone else.
  const openFor = open ? member?.id ?? null : null
  const [shownFor, setShownFor] = useState(openFor)
  if (openFor !== shownFor) {
    setShownFor(openFor)
    if (openFor) { setRate(''); setFrom(own ? today : firstDate); setTried(false) }
  }
  if (!member) return null

  const value = Number(rate)
  const rateError = String(rate).trim() === '' ? 'Enter a rate' : value >= 0 && value <= 100 ? null : '0 to 100'
  const dateError = isDateKey(from) ? null : 'Pick a date'
  const first = member.name.split(' ')[0]

  const save = async (e) => {
    e.preventDefault()
    setTried(true)
    if (rateError || dateError) return
    const period = { from, annualRate: value, serviceCharge: SERVICE_CHARGE }
    const next = [...(own ?? []).filter(p => p.from !== from), period].sort((a, b) => a.from.localeCompare(b.from))
    if (await actions.setMemberRates(member.id, next)) onClose()
  }

  const removePeriod = async (period) => {
    const rest = own.filter(p => p !== period)
    await actions.setMemberRates(member.id, rest.length ? rest : null)
  }

  const useAccountRate = async () => {
    if (!(await confirm({
      title: `Use the account rate for ${first}?`,
      message: `${first}'s interest is recalculated at the account rate (${accountRate}% today), including interest already earned.`,
      confirmLabel: 'Use account rate',
    }))) return
    if (await actions.setMemberRates(member.id, null)) onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={`${first}'s rate`}>
      <p className="text-sm text-muted">
        {own
          ? `${first} has their own rate. Everyone else earns the account rate (${accountRate}%).`
          : `${first} earns the account rate (${accountRate}% today), like everyone. Set a rate only if their Yehulu rate is different.`}
      </p>

      {own && (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {[...own].reverse().map(p => (
            <li key={p.from} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{p.annualRate}% a year</span>
                <span className="block text-xs text-muted">From {formatDate(p.from)}</span>
              </span>
              <button
                type="button"
                onClick={() => removePeriod(p)}
                aria-label={`Delete the ${p.annualRate}% rate`}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-neg-soft hover:text-neg"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={save} noValidate className="mt-4 space-y-3">
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
          <Field id="member-rate" label={own ? 'New rate' : 'Their rate'} hint="Per year" error={tried ? rateError : null}>
            <AffixInput id="member-rate" suffix="%" min="0" max="100" step="0.01" placeholder="e.g. 2" autoFocus value={rate} onChange={(e) => setRate(e.target.value)} />
          </Field>
          <Field id="member-rate-from" label="Applies from" error={tried ? dateError : null}>
            <input id="member-rate-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {own
            ? <Button variant="ghost" size="sm" onClick={useAccountRate}>Use the account rate</Button>
            : <span />}
          <Button type="submit">Save rate</Button>
        </div>
      </form>
    </Sheet>
  )
}
