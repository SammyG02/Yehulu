import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { SettingsPanel } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card, CardHeader } from '../../components/ui/Card.jsx'
import { AffixInput, Field, inputClass } from '../../components/ui/Field.jsx'
import { addDays, isDateKey } from '../../lib/dates.js'
import { formatDate, formatPercent } from '../../lib/format.js'
import { dailyRate, effectiveAnnualRate, periodOn } from '../../lib/interest.js'
import { SERVICE_CHARGE, toFraction } from '../../lib/storage.js'
import { useConfirm, useSavings } from '../../state/hooks.js'

const isPercent = (v) => String(v).trim() !== '' && Number(v) >= 0 && Number(v) <= 100
const describe = (p) => `${p.annualRate}% a year`

function RateFigures({ period }) {
  const rates = toFraction(period)
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-sunken px-3 py-2.5 text-sm">
      <span className="text-muted">Per day <span className="font-bold text-ink">{formatPercent(dailyRate(rates), 4)}</span></span>
      <span className="text-muted">Real yearly growth <span className="font-bold text-brand-ink">{formatPercent(effectiveAnnualRate(rates))}</span></span>
    </div>
  )
}

/** "Change rate from [date]", or editing an existing period when `editing` is set. */
function RateForm({ editing, onDone }) {
  const { account, currentRate, today, actions } = useSavings()
  const confirm = useConfirm()
  const start = editing ?? currentRate
  const [from, setFrom] = useState(editing ? editing.from : today)
  const [annualRate, setAnnualRate] = useState(String(start.annualRate))

  const dateError = isDateKey(from) ? null : 'Pick a date'
  const rateError = isPercent(annualRate) ? null : '0 to 100'
  const valid = !dateError && !rateError

  const entered = valid ? { from, annualRate: Number(annualRate), serviceCharge: SERVICE_CHARGE } : null
  const others = account.rates.filter(p => p.from !== editing?.from)
  const replacing = valid && others.some(p => p.from === from)
  // Nothing to save: the same rate already starts that day, or (for a new
  // change) that rate is already the one in effect on that day.
  const unchanged = valid && (
    account.rates.some(p => p.from === from && p.annualRate === entered.annualRate)
    || (!editing && periodOn(account.rates, from).annualRate === entered.annualRate))
  const recalcFrom = valid ? (editing && editing.from < from ? editing.from : from) : null
  const affectsPast = valid && recalcFrom < today

  const submit = async (e) => {
    e.preventDefault()
    if (!valid || unchanged) return
    if (affectsPast && !(await confirm({
      title: 'Change a past rate?',
      message: `Interest from ${formatDate(recalcFrom)} onward will be recalculated, including interest already earned.`,
      confirmLabel: 'Recalculate',
    }))) return
    if (await actions.changeRates([...others, entered], editing ? 'Rate updated' : 'Rate changed')) onDone()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 border-t border-line p-4">
      <h3 className="text-sm font-bold">{editing ? `Edit the rate from ${formatDate(editing.from)}` : 'Change rate'}</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field id="rate-from" label="Starting" error={dateError}>
          <input id="rate-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </Field>
        <Field id="rate-annual" label="Interest rate" hint="Per year" error={rateError}>
          <AffixInput id="rate-annual" suffix="%" min="0" max="100" step="0.01" value={annualRate} onChange={(e) => setAnnualRate(e.target.value)} />
        </Field>
      </div>

      {valid && <RateFigures period={entered} />}

      {valid && !unchanged && (
        <p className={`rounded-xl px-3 py-2 text-xs ${affectsPast ? 'bg-accent-soft text-ink' : 'text-muted'}`}>
          {affectsPast
            ? <>Interest from <span className="font-semibold">{formatDate(recalcFrom)}</span> onward will be recalculated, including interest already earned.</>
            : <>Applies from {formatDate(from)}. Interest already earned stays the same.</>}
          {replacing && ' It replaces the rate that starts on that day.'}
        </p>
      )}

      <div className="flex justify-end gap-2">
        {editing && <Button variant="ghost" onClick={onDone}>Cancel</Button>}
        <Button type="submit" disabled={!valid || unchanged}>
          {editing ? 'Save' : `Change from ${valid ? formatDate(from, { day: 'numeric', month: 'short' }) : '…'}`}
        </Button>
      </div>
    </form>
  )
}

function RateHistory({ editing, onEdit }) {
  const { account, currentRate, today, actions, isOwner } = useSavings()
  const confirm = useConfirm()
  const periods = account.rates
  const onlyOne = periods.length === 1

  const remove = async (period) => {
    if (onlyOne) return
    if (!(await confirm({
      title: `Delete the ${period.annualRate}% rate?`,
      message: period.from < today
        ? `It started on ${formatDate(period.from)}. Interest from that day onward will be recalculated, including interest already earned.`
        : `It was set to start on ${formatDate(period.from)}.`,
      confirmLabel: 'Delete',
      danger: true,
    }))) return
    if (await actions.changeRates(periods.filter(p => p !== period), 'Rate deleted') && editing === period) onEdit(null)
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Rate history" subtitle="Each rate applies until the next one starts." className="pb-3" />
      <ul className="divide-y divide-line border-t border-line">
        {[...periods].reverse().map(period => {
          const i = periods.indexOf(period)
          const next = periods[i + 1]
          const range = `${formatDate(period.from)} – ${next ? formatDate(addDays(next.from, -1)) : 'onwards'}`
          return (
            <li key={period.from} className={`flex items-center gap-3 px-4 py-2.5 ${editing === period ? 'bg-brand-soft/60' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold">
                  {describe(period)}
                  {period === currentRate && <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-xs font-semibold text-brand-ink">Current</span>}
                  {period.from > today && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-semibold text-accent">Scheduled</span>}
                </p>
                <p className="text-xs text-muted">{range}</p>
              </div>
              {isOwner && (<>
              <button
                type="button"
                onClick={() => onEdit(period)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-sunken hover:text-ink"
                aria-label={`Edit the rate from ${formatDate(period.from)}`}
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => remove(period)}
                disabled={onlyOne}
                title={onlyOne ? 'There must be at least one rate' : undefined}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-neg-soft hover:text-neg disabled:pointer-events-none disabled:opacity-30"
                aria-label={`Delete the rate from ${formatDate(period.from)}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
              </>)}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function LogicPanel() {
  const { account, currentRate, isOwner } = useSavings()
  const [editing, setEditing] = useState(null)

  return (
    <SettingsPanel title="Logic" description={`How interest is worked out for ${account.name}. Each account has its own rate.`}>
      <Card className="overflow-hidden">
        <div className="space-y-3 p-4">
          <div>
            <p className="text-xs font-semibold text-muted">Rate today</p>
            <p className="text-lg font-extrabold tracking-tight">{describe(currentRate)}</p>
          </div>
          <RateFigures period={currentRate} />
          <ul className="space-y-1 text-xs leading-relaxed text-muted">
            <li><span className="font-semibold text-ink">Service charge:</span> {SERVICE_CHARGE}% of interest, set by Yehulu.</li>
            <li><span className="font-semibold text-ink">Withdrawal fee:</span> 0.2% of each withdrawal.</li>
            <li>Each day's interest is worked out on that day's closing balance and added overnight, so it compounds. Deposits earn from the day they're made.</li>
            <li>Interest and the charge are rounded to the santim each day, like on a Yehulu statement.</li>
          </ul>
        </div>
        {isOwner
          ? <RateForm key={editing?.from ?? 'new'} editing={editing} onDone={() => setEditing(null)} />
          : <p className="border-t border-line px-4 py-3 text-xs text-muted">Only the account owner can change the rate.</p>}
      </Card>

      <RateHistory editing={editing} onEdit={setEditing} />
    </SettingsPanel>
  )
}

/** Keyed by account so a half-filled form never carries over to another account. */
export default function LogicSettings() {
  const { account } = useSavings()
  return <LogicPanel key={account.id} />
}
