import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { CircleCheck, FileText, TriangleAlert } from 'lucide-react'
import { SettingsPanel } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { Field, inputClass } from '../../components/ui/Field.jsx'
import { formatDate, formatMoney } from '../../lib/format.js'
import { simulateLedger } from '../../lib/interest.js'
import { buildImport, compareWithStatement, planImport, readStatementPdf } from '../../lib/statement.js'
import { MAX_ACCOUNTS, memberRateList, toFraction } from '../../lib/storage.js'
import { useSavings } from '../../state/hooks.js'

const NEW = 'new'

/** Step 1: pick one or more statement PDFs; they're read on this device. */
function PickFiles({ onRead }) {
  const fileRef = useRef(null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)

  const read = async (files) => {
    if (!files.length) return
    setError(null)
    const statements = []
    try {
      for (const [i, file] of files.entries()) {
        setProgress(`Reading ${i + 1} of ${files.length}…`)
        try {
          statements.push(await readStatementPdf(new Uint8Array(await file.arrayBuffer())))
        } catch (err) {
          throw new Error(`${file.name}: ${err.message}`, { cause: err })
        }
      }
      onRead(buildImport(statements), files.length)
    } catch (err) {
      setError(err.message)
    } finally {
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <Card className="space-y-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <FileText className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 text-sm">
          <p className="font-bold">Yehulu account statements (PDF)</p>
          <p className="text-muted">
            Pick one or more. Overlapping statements are fine. They're read on this device and never uploaded; only the
            transactions are saved.
          </p>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => read([...e.target.files])}
      />
      <Button onClick={() => fileRef.current?.click()} disabled={progress !== null} className="w-full sm:w-auto">
        {progress ?? 'Choose statements'}
      </Button>
      {error && <p role="alert" className="rounded-xl bg-neg-soft px-4 py-3 text-sm text-neg">{error}</p>}
    </Card>
  )
}

const Line = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
    <span className="text-muted">{label}</span>
    <span className="text-right font-semibold tabular-nums">{children}</span>
  </div>
)

/** Step 2: what was found, the check against the statement, and where it goes. */
function Review({ result, fileCount, onDone, onCancel }) {
  const { accounts, account: open, me, today, actions } = useSavings()
  // Accounts you may add to: yours, or shared ones (your own money, or anyone's if you own it).
  const targets = accounts.filter(a => !a.cloud || a.role === 'owner' || a.role === 'member')
  const [into, setInto] = useState(accounts.length < MAX_ACCOUNTS ? NEW : open.id)
  const shortNo = result.accountNo ? `••${result.accountNo.slice(-4)}` : ''
  const [name, setName] = useState(`Yehulu ${shortNo}`.trim())
  const target = accounts.find(a => a.id === into)
  const canPickMember = target?.cloud && target.role === 'owner' && target.members?.length > 1
  const [memberId, setMemberId] = useState(null)
  const who = target?.cloud ? (canPickMember ? memberId ?? me : me) : null
  const [useRates, setUseRates] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const counts = useMemo(() => ({
    deposits: result.transactions.filter(t => t.type === 'deposit').length,
    withdrawals: result.transactions.filter(t => t.type === 'withdrawal' && !t.noFee).length,
    noFee: result.transactions.filter(t => t.noFee).length,
  }), [result])

  // Exactly what the import will do to that person's money (same steps as the
  // app's import action), then the app's maths over the result.
  const existing = useMemo(
    () => (target ? target.transactions.filter(t => !target.cloud || t.memberId === who) : []),
    [target, who],
  )
  const preview = useMemo(() => {
    let n = 0
    const lines = result.transactions.map(t => ({ ...t, id: `preview-${n++}` }))
    const found = result.rates.map(r => ({ ...r, serviceCharge: 10 }))
    const current = target ? memberRateList(target, who) : found
    const plan = planImport({
      existing, lines, anchors: result.anchors, currentRates: current, foundRates: found,
      useRates: Boolean(target && useRates), period: { from: result.from, to: result.to }, newId: () => `preview-${n++}`,
    })
    const gone = new Set(plan.remove)
    const after = [...existing.filter(t => !gone.has(t.id)), ...plan.add]
    const rates = (plan.rates ?? current).map(toFraction)
    const check = compareWithStatement(simulateLedger({ transactions: after, rates, fromDate: result.to, endDate: result.to }), result.expected)
    return { plan, check }
  }, [result, target, who, useRates, existing])
  const { plan, check } = preview
  const missing = plan.bridges.filter(b => b.note.startsWith('Missing'))
  const firstCredit = plan.bridges.find(b => !b.note.startsWith('Missing'))
  const replacing = plan.remove.length
  const endMatches = check.end.app != null && Math.abs(check.end.app - check.end.yehulu) < 0.005

  const doImport = () => {
    setError(null)
    if (into === NEW && !name.trim()) return setError('Give the new account a name.')
    setBusy(true)
    const outcome = actions.importStatement({
      into, name: name.trim().slice(0, 40), memberId: who, transactions: result.transactions, anchors: result.anchors,
      rates: result.rates, useRates: into === NEW || useRates, period: { from: result.from, to: result.to },
    })
    setBusy(false)
    if (outcome.error) return setError(outcome.error)
    onDone(outcome)
  }

  return (
    <div className="space-y-4">
      <Card className="divide-y divide-line px-4 sm:px-5">
        <Line label="Account">{[result.holder, shortNo].filter(Boolean).join(' · ') || 'Yehulu account'}</Line>
        <Line label="Period">{formatDate(result.from)} – {formatDate(result.to)}</Line>
        <Line label="Statements">{fileCount}</Line>
        <Line label="Deposits">{counts.deposits}</Line>
        <Line label="Withdrawals">{counts.withdrawals}{counts.noFee ? ` + ${counts.noFee} with no fee` : ''}</Line>
        <Line label="Balance on the statement">{formatMoney(result.closing)}</Line>
        <p className="py-2 text-xs text-muted">Interest and charges aren't copied: the app works them out, the same way Yehulu does.</p>
      </Card>

      {plan.matched.length > 0 && (
        <p className="flex gap-2 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand-ink">
          <CircleCheck className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            {plan.matched.length} of these {plan.matched.length === 1 ? 'is' : 'are'} already in {target?.name} as {plan.matched.length === 1 ? 'an entry' : 'entries'} you
            added yourself, so {plan.matched.length === 1 ? "it won't" : "they won't"} be added again.
            {plan.matched.some(m => m.own.date !== m.line.date) && (
              <span className="block text-xs">
                {plan.matched.filter(m => m.own.date !== m.line.date).length} of yours {plan.matched.filter(m => m.own.date !== m.line.date).length === 1 ? 'has' : 'have'} a
                different date from the statement. Your dates are kept; edit them to the statement's dates for the balance to match exactly.
              </span>
            )}
          </span>
        </p>
      )}
      {plan.unmatchedOwn.length > 0 && (
        <div className="flex gap-2 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            {plan.unmatchedOwn.length} {plan.unmatchedOwn.length === 1 ? 'entry' : 'entries'} you added yourself in this period {plan.unmatchedOwn.length === 1 ? "isn't" : "aren't"} on the statement.
            Nothing is changed; check {plan.unmatchedOwn.length === 1 ? 'it' : 'them'} in Activity:
            <span className="block text-xs">
              {plan.unmatchedOwn.slice(0, 5).map(t => `${formatDate(t.date)} ${t.type === 'deposit' ? '+' : '−'}${formatMoney(t.amount)}`).join(' · ')}
              {plan.unmatchedOwn.length > 5 ? ' …' : ''}
            </span>
          </span>
        </div>
      )}
      {result.fixes.length > 0 && (
        <p className="flex gap-2 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            {result.fixes.length} line{result.fixes.length === 1 ? ' was' : 's were'} corrected using the statement's own balance:
            <span className="block text-xs">
              {result.fixes.slice(0, 5).map(f => `${formatDate(f.date)}: ${f.what}`).join(' · ')}{result.fixes.length > 5 ? ' …' : ''}
            </span>
          </span>
        </p>
      )}
      {missing.length > 0 && (
        <p className="flex gap-2 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            {missing.length === 1 ? 'A statement is missing' : `${missing.length} statements are missing`} (before{' '}
            {missing.map(b => formatDate(b.date)).join(', ')}).
            <span className="block text-xs">
              The balance is carried over so everything after is right. Import the missing statement any time, in any
              order: it fills the gap in.
            </span>
          </span>
        </p>
      )}
      {replacing > 0 && (
        <p className="flex gap-2 rounded-xl bg-brand-soft px-4 py-3 text-sm text-brand-ink">
          <CircleCheck className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          This fills in history that was missing in {target.name}.
        </p>
      )}

      <Card className="space-y-3 p-4 sm:p-5">
        <h3 className="text-sm font-bold">Rates found</h3>
        <ul className="flex flex-wrap gap-2">
          {result.rates.map(r => (
            <li key={r.from} className="rounded-lg bg-sunken px-2.5 py-1 text-xs"><span className="font-bold">{r.annualRate}%</span> from {formatDate(r.from)}</li>
          ))}
        </ul>
        {into !== NEW && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useRates} onChange={(e) => setUseRates(e.target.checked)} className="h-4 w-4 accent-brand" />
            {target?.cloud && target.members?.length > 1 && who !== target.ownerId
              ? 'Use these as their own rates'
              : 'Use these rates for the account'}
          </label>
        )}
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <h3 className="text-sm font-bold">Check against the statement</h3>
        <p className={`flex gap-2 text-sm ${endMatches ? 'text-brand-ink' : 'text-accent'}`}>
          {endMatches ? <CircleCheck className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />}
          <span>
            {endMatches
              ? `Matches: the app also gets ${formatMoney(check.end.yehulu)} on ${formatDate(check.end.date)}.`
              : `The app gets ${formatMoney(check.end.app ?? 0)} on ${formatDate(check.end.date)}; the statement says ${formatMoney(check.end.yehulu)}.`}
            <span className="block text-xs text-muted">
              {check.matched} of {check.days} days match to the santim{missing.length ? ' (days in a missing statement can\'t be checked)' : ''}.
            </span>
          </span>
        </p>
        {firstCredit && (
          <p className="text-xs text-muted">
            Yehulu's first credit was {formatMoney(firstCredit.amount)} {firstCredit.type === 'deposit' ? 'more' : 'less'} than its
            usual rule (this happens when an account opens). The app adds that on {formatDate(firstCredit.date)} so it
            follows the statement.
          </p>
        )}
      </Card>

      <Card className="space-y-3 p-4 sm:p-5">
        <h3 className="text-sm font-bold">Import into</h3>
        <Field id="import-into" label="Account">
          <select id="import-into" value={into} onChange={(e) => { setInto(e.target.value); setMemberId(null) }} className={inputClass}>
            {accounts.length < MAX_ACCOUNTS && <option value={NEW}>A new account</option>}
            {targets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        {into === NEW && (
          <Field id="import-name" label="Name">
            <input id="import-name" type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
        )}
        {canPickMember && (
          <Field id="import-member" label="Whose money">
            <select id="import-member" value={who ?? ''} onChange={(e) => setMemberId(e.target.value)} className={inputClass}>
              {target.members.map(m => <option key={m.id} value={m.id}>{m.id === me ? `You (${m.name})` : m.name}</option>)}
            </select>
          </Field>
        )}
        {target && plan.skipped > 0 && (
          <p className="text-xs text-muted">{plan.skipped} of these are already in {target.name} and will be skipped.</p>
        )}
      </Card>

      {error && <p role="alert" className="rounded-xl bg-neg-soft px-4 py-3 text-sm text-neg">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={doImport} disabled={busy || plan.add.length === 0}>
          {(() => {
            const n = plan.add.length
            return `Import ${n} transaction${n === 1 ? '' : 's'}`
          })()}
        </Button>
      </div>
      {today < result.to && <p className="text-xs text-muted">This statement goes past today.</p>}
    </div>
  )
}

export default function ImportSettings() {
  const navigate = useNavigate()
  const [found, setFound] = useState(null)
  const [done, setDone] = useState(null)

  return (
    <SettingsPanel title="Import statement" description="Add your history from Yehulu account statements, and check the app against them.">
      {done ? (
        <Card className="space-y-4 p-4 sm:p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-brand-ink">
            <CircleCheck className="h-5 w-5" aria-hidden="true" />
            {done.added} transaction{done.added === 1 ? '' : 's'} imported{done.skipped ? `, ${done.skipped} already there` : ''}.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/')}>See it on Home</Button>
            <Button variant="ghost" onClick={() => { setDone(null); setFound(null) }}>Import more</Button>
          </div>
        </Card>
      ) : found ? (
        <Review result={found.result} fileCount={found.count} onCancel={() => setFound(null)} onDone={setDone} />
      ) : (
        <PickFiles onRead={(result, count) => setFound({ result, count })} />
      )}
    </SettingsPanel>
  )
}
