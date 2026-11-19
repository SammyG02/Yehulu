import { useState } from 'react'
import { Link } from 'react-router'
import { Check, ChevronDown, Plus, Settings2 } from 'lucide-react'
import { formatMoney } from '../../lib/format.js'
import { periodOn } from '../../lib/interest.js'
import { DEFAULT_RATE, MAX_ACCOUNTS } from '../../lib/storage.js'
import { useAccountBalances, useSavings } from '../../state/hooks.js'
import { Button } from '../ui/Button.jsx'
import { AffixInput, Field, inputClass } from '../ui/Field.jsx'
import { Sheet } from '../ui/Sheet.jsx'

const isPercent = (v) => String(v).trim() !== '' && Number(v) >= 0 && Number(v) <= 100

/** Name and rate for a new account. Calls onCreated(id) once it exists (and is open). */
export function NewAccountForm({ onCreated, onCancel }) {
  const { accounts, actions } = useSavings()
  const [name, setName] = useState('')
  const [annualRate, setAnnualRate] = useState(String(DEFAULT_RATE.annualRate))
  const [tried, setTried] = useState(false)

  const trimmed = name.trim().slice(0, 40)
  const nameError = !trimmed ? 'Give it a name'
    : accounts.some(a => a.name.toLowerCase() === trimmed.toLowerCase()) ? 'You already have an account with this name' : null
  const rateError = isPercent(annualRate) ? null : '0 to 100'
  const full = accounts.length >= MAX_ACCOUNTS

  const submit = (e) => {
    e.preventDefault()
    setTried(true)
    if (nameError || rateError || full) return
    const id = actions.addAccount({ name: trimmed, annualRate: Number(annualRate) })
    if (id) onCreated?.(id)
  }

  if (full) return <p className="text-sm text-muted">You've reached the limit of {MAX_ACCOUNTS} accounts.</p>

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
        <Field id="new-account-name" label="Account name" error={tried ? nameError : null}>
          <input
            id="new-account-name"
            type="text"
            maxLength={40}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Fixed deposit"
            className={inputClass}
          />
        </Field>
        <Field id="new-account-rate" label="Rate" hint="Per year" error={tried ? rateError : null}>
          <AffixInput id="new-account-rate" suffix="%" min="0" max="100" step="0.01" value={annualRate} onChange={(e) => setAnnualRate(e.target.value)} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit">Create account</Button>
      </div>
    </form>
  )
}

/** Every account with its rate and balance today; tap one to open it. */
export function AccountList({ onPick }) {
  const { accounts, account: active, today, actions } = useSavings()
  const balances = useAccountBalances()

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
      {accounts.map(a => {
        const isActive = a.id === active.id
        return (
          <li key={a.id}>
            <button
              type="button"
              aria-current={isActive ? 'true' : undefined}
              onClick={() => { actions.switchAccount(a.id); onPick?.(a.id) }}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${isActive ? 'bg-brand-soft' : 'hover:bg-sunken/70'}`}
            >
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-semibold ${isActive ? 'text-brand-ink' : ''}`}>{a.name}</span>
                <span className="block text-xs text-muted">{periodOn(a.rates, today).annualRate}% a year</span>
              </span>
              <span className="text-sm font-bold tabular-nums">{formatMoney(balances.get(a.id) ?? 0)}</span>
              <span className="flex w-5 justify-end">
                {isActive && <Check className="h-4 w-4 text-brand-ink" aria-label="Open" />}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** Top-bar chip showing the open account; opens a sheet to switch or add one. */
export function AccountSwitcher() {
  const { account, currentRate } = useSavings()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const close = () => { setOpen(false); setAdding(false) }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex max-w-[12rem] items-center gap-1 rounded-full bg-brand-soft py-1 pl-3 pr-2 text-xs font-semibold text-brand-ink transition hover:brightness-95 md:max-w-[11rem] md:py-1.5 md:text-sm lg:max-w-[16rem]"
      >
        <span className="truncate">{account.name}</span>
        <span className="flex-shrink-0 font-medium opacity-75">· {currentRate.annualRate}%</span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      </button>

      <Sheet open={open} onClose={close} title={adding ? 'New account' : 'Your accounts'}>
        {adding ? (
          <NewAccountForm onCreated={close} onCancel={() => setAdding(false)} />
        ) : (
          <div className="space-y-3">
            <AccountList onPick={close} />
            <div className="flex items-center justify-between gap-2">
              <Link to="/settings/accounts" onClick={close} className="inline-flex items-center gap-1.5 px-1 text-sm font-semibold text-muted hover:text-ink">
                <Settings2 className="h-4 w-4" aria-hidden="true" /> Manage
              </Link>
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" aria-hidden="true" /> New account
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  )
}
