import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { SettingsPanel } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card, CardHeader } from '../../components/ui/Card.jsx'
import { AffixInput, Field, inputClass } from '../../components/ui/Field.jsx'
import { addDays, isDateKey } from '../../lib/dates.js'
import { formatDate, formatPercent } from '../../lib/format.js'
import { dailyRate, effectiveAnnualRate } from '../../lib/interest.js'
import { toFraction } from '../../lib/storage.js'
import { useSavings } from '../../state/hooks.js'

const isPercent = (v) => String(v).trim() !== '' && Number(v) >= 0 && Number(v) <= 100
const describe = (p) => `${p.annualRate}% a year · ${p.serviceCharge}% charge`

function RateFigures({ period }) {
  const rates = toFraction(period)
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-sunken px-3 py-2.5 text-sm">
      <span className="text-muted">Per day <span className="font-bold text-ink">{formatPercent(dailyRate(rates), 4)}</span></span>
      <span className="text-muted">Real yearly growth <span className="font-bold text-brand-ink">{formatPercent(effectiveAnnualRate(rates))}</span></span>
    </div>
  )
}

function NameCard() {
  const { account, actions } = useSavings()
  const [name, setName] = useState(account.name)
  const trimmed = name.trim()
  const dirty = trimmed !== '' && trimmed !== account.name

  return (
    <Card as="form" className="p-4" noValidate onSubmit={(e) => { e.preventDefault(); if (dirty) actions.renameAccount(trimmed.slice(0, 40)) }}>
      <Field id="logic-name" label="Account name">
        <div className="flex gap-2">
          <input id="logic-name" type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Yehulu Gold" className={inputClass} />
          <Button type="submit" variant="secondary" disabled={!dirty}>Save</Button>
        </div>
      </Field>
    </Card>
  )
}

/** "Change rate from [date]", or editing an existing period when `editing` is set. */
function RateForm({ editing, onDone }) {
  const { account, currentRate, today, actions } = useSavings()
  const start = editing ?? currentRate
  const [from, setFrom] = useState(editing ? editing.from : today)
  const [annualRate, setAnnualRate] = useState(String(start.annualRate))
  const [serviceCharge, setServiceCharge] = useState(String(start.serviceCharge))

  const dateError = isDateKey(from) ? null : 'Pick a date'
  const rateError = isPercent(annualRate) ? null : '0 to 100'
  const chargeError = isPercent(serviceCharge) ? null : '0 to 100'
  const valid = !dateError && !rateError && !chargeError

  const entered = valid ? { from, annualRate: Number(annualRate), serviceCharge: Number(serviceCharge) } : null
  const others = account.rates.filter(p => p.from !== editing?.from)
  const replacing = valid && others.some(p => p.from === from)
  const unchanged = valid && account.rates.some(p =>
    p.from === from && p.annualRate === entered.annualRate && p.serviceCharge === entered.serviceCharge)
  const recalcFrom = valid ? (editing && editing.from < from ? editing.from : from) : null
  const affectsPast = valid && recalcFrom < today

  const submit = (e) => {
    e.preventDefault()
    if (!valid || unchanged) return
    if (affectsPast && !window.confirm(
      `This recalculates interest from ${formatDate(recalcFrom)} onward, including interest already earned. Continue?`,
    )) return
    if (actions.changeRates([...others, entered], editing ? 'Rate updated' : 'Rate changed')) onDone()
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 border-t border-line p-4">
      <h3 className="text-sm font-bold">{editing ? `Edit the rate from ${formatDate(editing.from)}` : 'Change rate'}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1.3fr_1fr_1fr]">
        <div className="col-span-2 sm:col-span-1">
          <Field id="rate-from" label="Starting" error={dateError}>
            <input id="rate-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <Field id="rate-annual" label="Interest rate" error={rateError}>
          <AffixInput id="rate-annual" suffix="%" min="0" max="100" step="0.01" value={annualRate} onChange={(e) => setAnnualRate(e.target.value)} />
        </Field>
        <Field id="rate-charge" label="Service charge" error={chargeError}>
          <AffixInput id="rate-charge" suffix="%" min="0" max="100" step="0.01" value={serviceCharge} onChange={(e) => setServiceCharge(e.target.value)} />
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
  const { account, currentRate, today, actions } = useSavings()
  const periods = account.rates
  const onlyOne = periods.length === 1

  const remove = (period) => {
    if (onlyOne) return
    if (period.from < today && !window.confirm(
      `Delete the rate from ${formatDate(period.from)}? Interest from that day onward will be recalculated, including interest already earned.`,
    )) return
    if (actions.changeRates(periods.filter(p => p !== period), 'Rate deleted') && editing === period) onEdit(null)
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
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export default function LogicSettings() {
  const { currentRate } = useSavings()
  const [editing, setEditing] = useState(null)

  return (
    <SettingsPanel title="Logic" description="How interest is worked out. Rates differ between account types.">
      <NameCard />

      <Card className="overflow-hidden">
        <div className="space-y-3 p-4">
          <div>
            <p className="text-xs font-semibold text-muted">Rate today</p>
            <p className="text-lg font-extrabold tracking-tight">{describe(currentRate)}</p>
          </div>
          <RateFigures period={currentRate} />
          <p className="text-xs leading-relaxed text-muted">
            Interest is added every day, so it compounds. Deposits start earning the day after they're made.
          </p>
        </div>
        <RateForm key={editing?.from ?? 'new'} editing={editing} onDone={() => setEditing(null)} />
      </Card>

      <RateHistory editing={editing} onEdit={setEditing} />
    </SettingsPanel>
  )
}
