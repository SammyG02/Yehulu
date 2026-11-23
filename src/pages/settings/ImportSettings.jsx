import { useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { CircleCheck, FileText, TriangleAlert } from 'lucide-react'
import { SettingsPanel } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { Field, inputClass } from '../../components/ui/Field.jsx'
import { formatDate, formatMoney } from '../../lib/format.js'
import { simulateLedger } from '../../lib/interest.js'
import { buildImport, compareWithStatement, importedPeriods, planImport, planRemoval, readStatementPdf, statementAccounts } from '../../lib/statement.js'
import { MAX_ACCOUNTS, memberRateList, ratesOf, toFraction } from '../../lib/storage.js'
import { useConfirm, useSavings } from '../../state/hooks.js'

const NEW = 'new'

/** Step 1: pick one or more statement PDFs; they're read on this device. */
function PickFiles({ onRead }) {
  const fileRef = useRef(null)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState(null)
  // A protected PDF: ask for its password, then read everything again.
  const [locked, setLocked] = useState(null) // { files, name, passwords }
  const [password, setPassword] = useState('')

  const read = async (files, passwords = {}) => {
    if (!files.length) return
    setError(null)
    setLocked(null)
    const statements = []
    try {
      for (const [i, file] of files.entries()) {
        setProgress(`Reading ${i + 1} of ${files.length}…`)
        try {
          statements.push({ ...(await readStatementPdf(new Uint8Array(await file.arrayBuffer()), passwords[file.name] ?? '')), fileName: file.name })
        } catch (err) {
          if (err.needsPassword) {
            setLocked({ files, name: file.name, passwords, wrong: Boolean(passwords[file.name]) })
            setPassword('')
            return
          }
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
      {locked && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!password) return
            const passwords = { ...locked.passwords, [locked.name]: password }
            setPassword('') // not kept on screen once used
            read(locked.files, passwords)
          }}
          className="space-y-2 rounded-xl bg-sunken p-3"
        >
          <label htmlFor="pdf-password" className="block text-sm font-semibold">
            {locked.wrong ? 'That password is not right. ' : ''}{locked.name} has a password
          </label>
          <div className="flex gap-2">
            <input id="pdf-password" type="password" autoComplete="off" data-lpignore="true" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="PDF password" />
            <Button type="submit" disabled={!password}>Open</Button>
          </div>
          <p className="text-xs text-muted">Used only to open the file on this device. It isn't saved.</p>
        </form>
      )}
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
  const [unverifiedOk, setUnverifiedOk] = useState(false)

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
    let plan
    try {
      plan = planImport({
        existing, lines, anchors: result.anchors, currentRates: current, foundRates: found,
        useRates: Boolean(target && useRates), period: { from: result.from, to: result.to }, newId: () => `preview-${n++}`,
      })
    } catch (err) {
      // e.g. another Yehulu account's statement: nothing to preview, import blocked.
      return { plan: { add: [], remove: [], rates: null, skipped: 0, matched: [], unmatchedOwn: [], bridges: [] }, check: null, refused: err.message }
    }
    const gone = new Set(plan.remove)
    const after = [...existing.filter(t => !gone.has(t.id)), ...plan.add]
    const rates = (plan.rates ?? current).map(toFraction)
    const check = compareWithStatement(simulateLedger({ transactions: after, rates, fromDate: result.to, endDate: result.to }), result.expected)
    return { plan, check }
  }, [result, target, who, useRates, existing])
  const { plan, check, refused } = preview
  // Statements of another Yehulu account already in the chosen account?
  const others = [...statementAccounts(existing)].filter(no => result.accountNo && no !== result.accountNo)
  const blocked = Boolean(refused) || others.length > 0 || (result.unconfirmed > 0 && !unverifiedOk)
  const missing = plan.bridges.filter(b => b.note.startsWith('Missing'))
  const firstCredit = plan.bridges.find(b => !b.note.startsWith('Missing'))
  const replacing = plan.remove.length
  const endMatches = Boolean(check && check.end.app != null && Math.abs(check.end.app - check.end.yehulu) < 0.005)

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

      {others.length > 0 && (
        <div className="space-y-2 rounded-xl bg-neg-soft px-4 py-3 text-sm text-neg">
          <p className="flex gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>
              {target.name} already has statements from Yehulu account ••{others.map(o => o.slice(-4)).join(', ••')}. This one is
              from ••{result.accountNo.slice(-4)}: a different account. Import it into its own account instead.
            </span>
          </p>
        </div>
      )}
      {result.unconfirmed > 0 && (
        <div className="space-y-2 rounded-xl bg-accent-soft px-4 py-3 text-sm text-accent">
          <p className="flex gap-2">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>
              The opening or closing balance printed on {result.unconfirmed === 1 ? 'a statement' : `${result.unconfirmed} statements`} couldn't
              be found, so the app can't confirm that nothing is cut off at the start or end.
            </span>
          </p>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={unverifiedOk} onChange={(e) => setUnverifiedOk(e.target.checked)} className="h-4 w-4" />
            I've checked the statement is complete; import it anyway
          </label>
        </div>
      )}
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

      {check && <Card className="space-y-3 p-4 sm:p-5">
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
      </Card>}

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
        <Button onClick={doImport} disabled={busy || blocked || plan.add.length === 0}>
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

/** One imported period: remove all of it, or part of it (between two dates). */
function ImportedPeriod({ period }) {
  const { account, me, actions } = useSavings()
  const confirm = useConfirm()
  const uid = useId()
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState(period.from)
  const [to, setTo] = useState(period.to)
  const account4 = period.accountNo ? `Yehulu ••${period.accountNo.slice(-4)}` : 'Yehulu statements'
  // A file (removed as a whole) or older imports (removed between two dates).
  const byFile = Boolean(period.source)
  const label = byFile ? period.file : `${account4} · imported earlier`

  // What removing that range would do (same steps as the real removal).
  const preview = useMemo(() => {
    if (!open || !from || !to || from > to) return null
    const existing = account.transactions.filter(t => !account.cloud || t.memberId === me)
    let n = 0
    const plan = planRemoval({ existing, accountNo: period.accountNo, from, to, source: period.source, rates: ratesOf(account, me), newId: () => `p${n++}` })
    const later = existing.some(t => t.ref?.startsWith(`y:${period.accountNo}:`) && t.date > to)
    return { ...plan.removed, total: plan.removed.deposits + plan.removed.withdrawals, later }
  }, [open, from, to, account, me, period.accountNo, period.source])

  const remove = async () => {
    if (!preview?.total) return
    if (!(await confirm({
      title: byFile ? `Remove ${period.file}?` : `Remove ${preview.total} statement line${preview.total === 1 ? '' : 's'}?`,
      message: `${preview.total} line${preview.total === 1 ? '' : 's'} from ${byFile ? 'this statement' : account4}, ${formatDate(from)} – ${formatDate(to)}, in ${account.name}.`
        + (preview.keptForOthers ? ` ${preview.keptForOthers} that another imported statement also has stay.` : '')
        + ' Entries you added yourself stay.'
        + (preview.later ? ' Later statements keep matching the bank.' : ''),
      confirmLabel: 'Remove',
      danger: true,
    }))) return
    actions.removeStatement({ accountNo: period.accountNo, from, to, source: period.source })
    setOpen(false)
  }

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{label}</span>
          <span className="block text-xs text-muted">
            {byFile && `${account4} · `}{formatDate(period.from)} – {formatDate(period.to)} · {period.lines} line{period.lines === 1 ? '' : 's'}
          </span>
        </span>
        {!open && <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Remove…</Button>}
      </div>
      {open && (
        <div className="mt-3 space-y-3 rounded-xl bg-sunken p-3">
          {!byFile && (
            <div className="grid grid-cols-2 gap-3">
              <Field id={`${uid}-from`} label="From">
                <input id={`${uid}-from`} type="date" value={from} min={period.from} max={period.to} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
              </Field>
              <Field id={`${uid}-to`} label="To">
                <input id={`${uid}-to`} type="date" value={to} min={period.from} max={period.to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
              </Field>
            </div>
          )}
          <p className="text-xs text-muted">
            {preview
              ? `Removes ${preview.deposits} deposit${preview.deposits === 1 ? '' : 's'} and ${preview.withdrawals} withdrawal${preview.withdrawals === 1 ? '' : 's'} that came from ${byFile ? 'this statement' : 'statements'}.`
                + (preview.keptForOthers ? ` ${preview.keptForOthers} that another imported statement also has stay.` : '')
                + ' Your own entries stay.'
                + (preview.later ? ' Balances after this keep matching the bank (the gap is carried over until you import it again).' : '')
              : 'Pick a From date on or before the To date.'}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setFrom(period.from); setTo(period.to) }}>Cancel</Button>
            <Button variant="danger" size="sm" onClick={remove} disabled={!preview?.total}>Remove</Button>
          </div>
        </div>
      )}
    </li>
  )
}

/** What has been imported into the open account (your own money), with a way to remove it. */
function ImportedList() {
  const { account, me } = useSavings()
  const periods = useMemo(
    () => importedPeriods(account.transactions.filter(t => !account.cloud || t.memberId === me)),
    [account, me],
  )
  if (!periods.length) return null
  return (
    <Card className="p-4 sm:p-5">
      <h3 className="text-sm font-bold">Imported into {account.name}</h3>
      <ul className="divide-y divide-line">
        {periods.map(p => <ImportedPeriod key={`${p.accountNo}:${p.source ?? 'old'}`} period={p} />)}
      </ul>
    </Card>
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
        <Review result={found.result} fileCount={found.count} onCancel={() => setFound(null)} onDone={(r) => { setFound(null); setDone(r) }} />
      ) : (
        <>
          <PickFiles onRead={(result, count) => setFound({ result, count })} />
          <ImportedList />
        </>
      )}
    </SettingsPanel>
  )
}
