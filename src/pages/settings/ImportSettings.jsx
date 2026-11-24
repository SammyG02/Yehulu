import { useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { CircleCheck, FileText, TriangleAlert } from 'lucide-react'
import { SettingsPanel } from '../../components/settings/SettingsUI.jsx'
import { Button } from '../../components/ui/Button.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { Field, inputClass } from '../../components/ui/Field.jsx'
import { formatDate, formatMoney } from '../../lib/format.js'
import { simulateLedger } from '../../lib/interest.js'
import { buildImport, compareWithStatement, importChoices, importedPeriods, planImport, planRemoval, readStatementPdf, statementAccounts, suggestChoice } from '../../lib/statement.js'
import { MAX_ACCOUNTS, memberRateList, nameTaken, ratesOf, toFraction } from '../../lib/storage.js'
import { useAccountBalances, useConfirm, useSavings } from '../../state/hooks.js'

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

/** One place the statement can go. */
function Choice({ checked, onPick, title, detail, disabled = false }) {
  return (
    <label className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand ${
      disabled ? 'cursor-not-allowed border-line opacity-50'
        : checked ? 'cursor-pointer border-brand bg-brand-soft' : 'cursor-pointer border-line hover:bg-sunken'}`}
    >
      <input type="radio" name="import-into" checked={checked} disabled={disabled} onChange={onPick} className="h-4 w-4 flex-shrink-0 accent-brand" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </label>
  )
}

/** Step 2: what was found, the check against the statement, and where it goes. */
function Review({ result, fileCount, onDone, onCancel }) {
  const { accounts, me, today, actions } = useSavings()
  const balances = useAccountBalances()
  const choices = useMemo(
    () => importChoices({ accounts, me, accountNo: result.accountNo, lines: result.transactions }),
    [accounts, me, result],
  )
  const sameIn = choices.filter(c => c.kind === 'same')
  const canAdd = accounts.length < MAX_ACCOUNTS
  const canCreate = canAdd && sameIn.length === 0
  // Your pick, else the suggestion (null: you have to choose).
  const [picked, setPicked] = useState(null)
  const into = (picked === NEW ? canCreate : choices.some(c => c.id === picked)) ? picked : suggestChoice(choices, accounts, canAdd)
  const choice = choices.find(c => c.id === into)
  const shortNo = result.accountNo ? `••${result.accountNo.slice(-4)}` : ''
  const [name, setName] = useState(() => {
    const base = `Yehulu ${shortNo}`.trim()
    let unused = base
    for (let n = 2; nameTaken(accounts, unused); n++) unused = `${base} (${n})`
    return unused
  })
  const nameError = into === NEW && nameTaken(accounts, name) ? 'You already have an account with this name' : null
  const target = accounts.find(a => a.id === into)
  const canPickMember = target?.cloud && target.role === 'owner' && target.members?.length > 1
  const [memberId, setMemberId] = useState(null)
  const who = target?.cloud ? (canPickMember ? memberId ?? choice?.memberId ?? me : me) : null
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
  const nothingNew = Boolean(target) && !refused && plan.add.length === 0 && plan.remove.length === 0
  // Going somewhere else while another account already has these statements.
  const twice = target && choice?.kind !== 'same' ? [...new Set(sameIn.map(c => accounts.find(a => a.id === c.id).name))] : []

  // What each account shows under its name.
  const details = useMemo(() => new Map(choices.map(c => {
    const a = accounts.find(x => x.id === c.id)
    const mine = a.transactions.filter(t => !a.cloud || t.memberId === c.memberId)
    const owner = a.cloud && c.memberId !== me ? a.members?.find(m => m.id === c.memberId)?.name : null
    const money = formatMoney(balances.get(c.id) ?? 0)
    if (c.kind === 'other') return [c.id, `Has Yehulu ••${[...statementAccounts(mine)].map(n => n.slice(-4)).join(', ••')}, a different account`]
    if (c.kind === 'empty') return [c.id, owner ? `${owner} · Empty` : 'Empty']
    if (c.kind === 'open') return [c.id, `${owner ?? money} · ${mine.length} transaction${mine.length === 1 ? '' : 's'}`]
    const dates = mine.filter(t => t.ref).map(t => t.date).sort()
    return [c.id, `${owner ?? money} · has these statements, ${formatDate(dates[0])} – ${formatDate(dates.at(-1))}`]
  })), [choices, accounts, balances, me])

  const buttonText = !into ? 'Choose an account' : into === NEW ? `Add ${plan.add.length} to a new account`
    : plan.add.length ? `Add ${plan.add.length} to ${target.name}` : `Update ${target.name}`
  const endMatches = Boolean(check && check.end.app != null && Math.abs(check.end.app - check.end.yehulu) < 0.005)

  const doImport = () => {
    setError(null)
    if (!into) return setError('Choose where it goes.')
    if (into === NEW && !name.trim()) return setError('Give the new account a name.')
    setBusy(true)
    const outcome = actions.importStatement({
      into, name: name.trim().slice(0, 40), memberId: who, transactions: result.transactions, anchors: result.anchors,
      rates: result.rates, useRates: into === NEW || useRates, period: { from: result.from, to: result.to },
    })
    setBusy(false)
    if (outcome.error) return setError(outcome.error)
    onDone({ ...outcome, name: target?.name ?? name.trim() })
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

      <Card className="p-4 sm:p-5">
        <fieldset className="space-y-2">
          <legend className="mb-3 text-sm font-bold">Where should this go?</legend>
          {choices.map(c => (
            <Choice
              key={c.id}
              title={accounts.find(a => a.id === c.id).name}
              detail={details.get(c.id)}
              disabled={c.kind === 'other'}
              checked={into === c.id}
              onPick={() => { setPicked(c.id); setMemberId(null); setError(null) }}
            />
          ))}
          {canCreate && (
            <Choice title="New account" detail="Keep it separate" checked={into === NEW} onPick={() => { setPicked(NEW); setMemberId(null); setError(null) }} />
          )}
        </fieldset>
        <div className="[&>*]:mt-3">
          {into === NEW && (
            <Field id="import-name" label="Name" error={nameError}>
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
          {sameIn.length > 1 && !into && (
            <p className="text-xs text-accent">More than one account has this Yehulu account's statements. Choose one.</p>
          )}
          {twice.length > 0 && (
            <p className="text-xs text-accent">{twice.join(' and ')} already {twice.length === 1 ? 'has' : 'have'} this Yehulu account's statements. Adding it here too counts the same money twice.</p>
          )}
          {nothingNew && (
            <p className="flex gap-2 text-sm text-brand-ink">
              <CircleCheck className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Everything here is already in {target.name}.
            </p>
          )}
          {choice?.kind === 'same' && !nothingNew && plan.skipped > 0 && (
            <p className="text-xs text-muted">{plan.skipped} already there, skipped.</p>
          )}
        </div>
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
        {target && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useRates} onChange={(e) => setUseRates(e.target.checked)} className="h-4 w-4 accent-brand" />
            {target?.cloud && target.members?.length > 1 && who !== target.ownerId
              ? 'Use these as their own rates'
              : 'Use these rates for the account'}
          </label>
        )}
      </Card>

      {into && check && <Card className="space-y-3 p-4 sm:p-5">
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

      {error && <p role="alert" className="rounded-xl bg-neg-soft px-4 py-3 text-sm text-neg">{error}</p>}
      {nothingNew ? (
        <Button onClick={onCancel} className="w-full">Done</Button>
      ) : (
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={doImport} disabled={busy || blocked || !into || Boolean(nameError) || (plan.add.length === 0 && plan.remove.length === 0)} className="min-w-0">
            <span className="truncate">{buttonText}</span>
          </Button>
        </div>
      )}
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
            {done.added} transaction{done.added === 1 ? '' : 's'} added to {done.name}{done.skipped ? `, ${done.skipped} already there` : ''}.
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
