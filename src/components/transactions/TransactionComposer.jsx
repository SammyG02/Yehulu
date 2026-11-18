import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { formatAmount, formatMoney } from '../../lib/format.js'
import { withdrawalFee } from '../../lib/interest.js'
import { useSavings } from '../../state/hooks.js'
import { Button } from '../ui/Button.jsx'
import { Field, inputClass } from '../ui/Field.jsx'
import { Segmented } from '../ui/Segmented.jsx'
import { Sheet } from '../ui/Sheet.jsx'

const TYPES = [
  { value: 'deposit', label: 'Deposit', activeClass: 'bg-surface text-brand-ink shadow-card' },
  { value: 'withdrawal', label: 'Withdraw', activeClass: 'bg-surface text-neg shadow-card' },
]
const QUICK_ADD = [100, 500, 1000, 5000]

function ComposerForm({ composer, onClose }) {
  const { today, actions } = useSavings()
  const editing = composer.mode === 'edit'
  const original = composer.txn

  const [type, setType] = useState(editing ? original.type : composer.type)
  const [amount, setAmount] = useState(editing ? String(original.amount) : '')
  const [date, setDate] = useState(editing ? original.date : today)
  const [note, setNote] = useState(editing ? original.note : '')
  const [error, setError] = useState(null)

  const isDeposit = type === 'deposit'
  const clearError = () => setError(null)

  const addQuick = (n) => {
    const current = parseFloat(amount) || 0
    setAmount(String(Math.round((current + n) * 100) / 100))
    clearError()
  }

  const submit = (e) => {
    e.preventDefault()
    const value = Math.round(parseFloat(amount) * 100) / 100
    if (!(value > 0)) return setError('Enter an amount greater than zero.')
    if (!date) return setError('Pick a date.')

    const txn = { type, amount: value, date, note: note.trim() }
    const problem = editing ? actions.updateTransaction(original.id, txn) : actions.addTransaction(txn)
    if (problem) return setError(problem)
    onClose()
  }

  const remove = () => {
    if (actions.deleteTransaction(original)) onClose()
  }

  const dateHint = date > today
    ? 'Scheduled. It counts from that date.'
    : isDeposit
      ? 'Starts earning interest the day after.'
      : 'Stops earning interest from this day.'

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <Segmented
        block
        size="lg"
        label="Transaction type"
        options={TYPES}
        value={type}
        onChange={(v) => { setType(v); clearError() }}
      />

      <div className="rounded-2xl bg-sunken px-4 pb-4 pt-3 text-center">
        <label htmlFor="composer-amount" className="text-xs font-semibold uppercase tracking-wider text-muted">
          Amount in Birr
        </label>
        <input
          id="composer-amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          autoFocus={!editing}
          value={amount}
          onChange={(e) => { setAmount(e.target.value); clearError() }}
          placeholder="0"
          className={`mt-1 w-full bg-transparent text-center text-4xl font-extrabold tabular-nums tracking-tight placeholder:text-muted/40 focus:outline-none ${isDeposit ? 'text-brand-ink' : 'text-neg'}`}
          aria-invalid={Boolean(error)}
        />
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {QUICK_ADD.map(n => (
            <button
              key={n}
              type="button"
              onClick={() => addQuick(n)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-bold tabular-nums transition hover:border-brand hover:text-brand-ink"
            >
              +{formatAmount(n, { whole: true })}
            </button>
          ))}
        </div>
      </div>

      <Field id="composer-date" label="Date" hint={dateHint}>
        <input id="composer-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); clearError() }} className={inputClass} />
      </Field>

      <Field id="composer-note" label="Note" optional>
        <input
          id="composer-note"
          type="text"
          maxLength={60}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={isDeposit ? 'e.g. Salary' : 'e.g. School fees'}
          className={inputClass}
        />
      </Field>

      {!isDeposit && parseFloat(amount) > 0 && (
        <p className="flex justify-between rounded-xl bg-sunken px-4 py-2.5 text-sm">
          <span className="text-muted">Withdrawal fee (0.2%)</span>
          <span className="font-semibold tabular-nums">
            {formatMoney(withdrawalFee(parseFloat(amount)))}
            <span className="font-normal text-muted"> · {formatMoney(parseFloat(amount) + withdrawalFee(parseFloat(amount)))} in total</span>
          </span>
        </p>
      )}

      {error && <p role="alert" className="rounded-xl bg-neg-soft px-4 py-3 text-sm font-medium text-neg">{error}</p>}

      <div className="space-y-2">
        <Button type="submit" size="lg" block>
          {editing ? 'Save changes' : isDeposit ? 'Add deposit' : 'Add withdrawal'}
        </Button>
        {editing && (
          <Button variant="danger" size="lg" block onClick={remove}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete transaction
          </Button>
        )}
      </div>
    </form>
  )
}

/** The one place transactions are added or edited, opened from anywhere via actions.openComposer / editTransaction. */
export function TransactionComposer() {
  const { composer, actions } = useSavings()
  const title = composer?.mode === 'edit' ? 'Edit transaction' : 'New transaction'
  const key = composer ? (composer.mode === 'edit' ? composer.txn.id : `new-${composer.type}`) : 'closed'

  return (
    <Sheet open={Boolean(composer)} onClose={actions.closeComposer} title={title}>
      {composer && <ComposerForm key={key} composer={composer} onClose={actions.closeComposer} />}
    </Sheet>
  )
}
