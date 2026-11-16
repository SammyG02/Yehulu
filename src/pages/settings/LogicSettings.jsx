import { useState } from 'react'
import { SettingsPanel } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { AffixInput, Field, inputClass } from '../../components/ui/Field.jsx'
import { formatPercent } from '../../lib/format.js'
import { dailyRate, effectiveAnnualRate } from '../../lib/interest.js'
import { sanitizeAccount, toRates } from '../../lib/storage.js'
import { useSavings } from '../../state/hooks.js'

const isPercent = (v) => v !== '' && Number(v) >= 0 && Number(v) <= 100

export default function LogicSettings() {
  const { account, actions } = useSavings()
  const [draft, setDraft] = useState({
    name: account.name,
    annualRate: String(account.annualRate),
    serviceCharge: String(account.serviceCharge),
  })

  const rateError = isPercent(draft.annualRate) ? null : '0 to 100'
  const chargeError = isPercent(draft.serviceCharge) ? null : '0 to 100'
  const valid = !rateError && !chargeError
  const preview = valid ? sanitizeAccount(draft) : account
  const dirty = valid && JSON.stringify(preview) !== JSON.stringify(account)
  const rates = toRates(preview)
  const set = (field) => (e) => setDraft(d => ({ ...d, [field]: e.target.value }))

  const save = (e) => {
    e.preventDefault()
    if (dirty) actions.updateAccount(preview)
  }

  return (
    <SettingsPanel title="Logic" description="How interest is worked out. Rates differ between account types.">
      <Card as="form" onSubmit={save} noValidate className="space-y-4 p-4">
        <Field id="logic-name" label="Account name">
          <input id="logic-name" type="text" maxLength={40} value={draft.name} onChange={set('name')} placeholder="e.g. Yehulu Gold" className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="logic-rate" label="Interest rate" hint="Per year" error={rateError}>
            <AffixInput id="logic-rate" suffix="%" min="0" max="100" step="0.01" value={draft.annualRate} onChange={set('annualRate')} />
          </Field>
          <Field id="logic-charge" label="Service charge" hint="Taken from interest" error={chargeError}>
            <AffixInput id="logic-charge" suffix="%" min="0" max="100" step="0.01" value={draft.serviceCharge} onChange={set('serviceCharge')} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-xl bg-sunken px-3 py-2.5 text-sm">
          <span className="text-muted">Per day <span className="font-bold text-ink">{formatPercent(dailyRate(rates), 4)}</span></span>
          <span className="text-muted">Real yearly growth <span className="font-bold text-brand-ink">{formatPercent(effectiveAnnualRate(rates))}</span></span>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Interest is added every day, so it compounds. Deposits start earning the day after they're made.
          Saving recalculates all past and future interest at the new rate.
        </p>

        <div className="flex justify-end">
          <Button type="submit" disabled={!dirty}>Save</Button>
        </div>
      </Card>
    </SettingsPanel>
  )
}
