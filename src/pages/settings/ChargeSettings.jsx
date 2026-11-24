import { useState } from 'react'
import { AccountTabs } from '../../components/settings/AccountTabs.jsx'
import { SettingsPanel } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { Field, inputClass, MoneyInput } from '../../components/ui/Field.jsx'
import { chargeFound, chargeOn, MAX_CHARGE } from '../../lib/charge.js'
import { addDays, isDateKey } from '../../lib/dates.js'
import { formatDate, formatMoney } from '../../lib/format.js'
import { coveredUntil } from '../../lib/interest.js'
import { chargesOf } from '../../lib/storage.js'
import { useConfirm, useSavings } from '../../state/hooks.js'

/** Amount and first day: to turn the charge on, or change it from a day. */
function ChargeForm({ start, amount: startAmount, label, onSave, onCancel }) {
  const [amount, setAmount] = useState(startAmount)
  const [from, setFrom] = useState(start)
  const value = Number(amount)
  const valid = value > 0 && value <= MAX_CHARGE && isDateKey(from)
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (valid) onSave({ from, amount: value }) }} noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field id="charge-amount" label="Each day">
          <MoneyInput id="charge-amount" value={amount} onValueChange={setAmount} />
        </Field>
        <Field id="charge-from" label="From">
          <input id="charge-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={!valid}>{label}</Button>
      </div>
    </form>
  )
}

function ChargePanel({ who }) {
  const { account, today, actions } = useSavings()
  const confirm = useConfirm()
  const [changing, setChanging] = useState(false)
  const charges = chargesOf(account, who)
  const money = account.cloud ? account.transactions.filter(t => t.memberId === who) : account.transactions
  const found = chargeFound(money)
  const covered = coveredUntil(money)
  const now = chargeOn(charges, today)
  const next = charges.find(c => c.from > today)
  const on = now > 0 || Boolean(next && next.amount > 0)
  // On days a statement covers the charge is never worked out anyway.
  const start = covered && addDays(covered, 1) < today ? addDays(covered, 1) : today
  const save = (list, message) => { actions.setCharges(who, list, message); setChanging(false) }

  const stop = async () => {
    if (await confirm({ title: 'Stop the daily charge?', message: 'It ends today. Days before today keep it.', confirmLabel: 'Stop' })) {
      save([...charges.filter(c => c.from < today), { from: today, amount: 0 }], 'Daily charge stopped')
    }
  }
  const removeAll = async () => {
    if (await confirm({ title: 'Remove the daily charge?', message: 'Everything is worked out as if it was never on. Lines imported from statements stay.', confirmLabel: 'Remove', danger: true })) {
      save([], 'Daily charge removed')
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div>
        <p className="text-xs font-semibold text-muted">Daily charge</p>
        <p className="text-lg font-extrabold tracking-tight">
          {now > 0 ? `${formatMoney(now)} a day` : next ? `${formatMoney(next.amount)} a day from ${formatDate(next.from)}` : 'Off'}
        </p>
        {now > 0 && covered && <p className="text-xs text-muted">Counted after {formatDate(covered)}, where your statements end.</p>}
      </div>

      {!on && found && (
        <div className="space-y-2 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand-ink">
          <p>Your statements show <span className="font-bold">{formatMoney(found.amount)} a day</span> since {formatDate(found.since)}.</p>
          <Button size="sm" onClick={() => save([...charges.filter(c => c.from < found.since), { from: found.since, amount: found.amount }], 'Daily charge on')}>Keep counting it</Button>
        </div>
      )}

      {on && !changing ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setChanging(true)}>Change amount</Button>
          <Button variant="secondary" size="sm" onClick={stop}>Stop</Button>
          <Button variant="danger" size="sm" onClick={removeAll}>Remove</Button>
        </div>
      ) : (
        <ChargeForm
          key={`${who}-${changing}`}
          start={changing ? today : start}
          amount={changing ? String(now || next?.amount || '') : ''}
          label={changing ? 'Save' : 'Turn on'}
          onCancel={changing ? () => setChanging(false) : null}
          onSave={(c) => save([...charges.filter(x => x.from < c.from), c], changing ? 'Daily charge changed' : 'Daily charge on')}
        />
      )}
      {!on && charges.length > 0 && <Button variant="link" onClick={removeAll}>Remove its history</Button>}

      <ul className="space-y-1 text-xs leading-relaxed text-muted">
        <li>For kinds of Yehulu account with a daily charge ("Standing Order" on the statement). No 0.2% fee.</li>
        <li>Sunday's is taken on Monday. It isn't taken when there isn't enough money.</li>
        <li>When you import a statement, its own lines count instead. Don't also add them by hand.</li>
      </ul>
    </Card>
  )
}

export default function ChargeSettings() {
  const { account, me } = useSavings()
  const canPick = account.cloud && account.role === 'owner' && account.members?.length > 1
  const [picked, setPicked] = useState(null)
  const who = account.cloud ? (canPick && account.members.some(m => m.id === picked) ? picked : me) : null

  return (
    <SettingsPanel title="Daily charge" description={`For ${account.name}. Off unless you turn it on.`}>
      <AccountTabs />
      {account.cloud && !account.chargesReady ? (
        <Card className="p-4 text-sm text-muted">The daily charge isn't available online yet (database update 017).</Card>
      ) : (
        <>
          {canPick && (
            <Field id="charge-member" label="Whose money">
              <select id="charge-member" value={who} onChange={(e) => setPicked(e.target.value)} className={inputClass}>
                {account.members.map(m => <option key={m.id} value={m.id}>{m.id === me ? `You (${m.name})` : m.name}</option>)}
              </select>
            </Field>
          )}
          <ChargePanel key={`${account.id}-${who}`} who={who} />
        </>
      )}
    </SettingsPanel>
  )
}
