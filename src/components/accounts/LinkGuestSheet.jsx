import { useMemo, useState } from 'react'
import { formatDate, formatMoney } from '../../lib/format.js'
import { planLink } from '../../lib/linkMembers.js'
import { useConfirm, useSavings } from '../../state/hooks.js'
import { Button } from '../ui/Button.jsx'
import { Sheet } from '../ui/Sheet.jsx'
import { Avatar } from './Avatar.jsx'

/**
 * Owner: link a name-only member to the person who joined. Shows exactly what
 * moves, and what's left out because that person already has it.
 */
export function LinkGuestSheet({ guest, open, onClose }) {
  const { account, allTransactions, me, actions } = useSavings()
  const confirm = useConfirm()
  const [pick, setPick] = useState(null)
  const joined = account.members.filter(m => !m.guest)

  const plan = useMemo(() => {
    if (!guest || !pick) return null
    return planLink(allTransactions.filter(t => t.memberId === guest.id), allTransactions.filter(t => t.memberId === pick))
  }, [guest, pick, allTransactions])
  if (!guest) return null
  const target = joined.find(m => m.id === pick)
  const close = () => { setPick(null); onClose() }

  const link = async () => {
    if (!target || !plan) return
    if (!(await confirm({
      title: `Link ${guest.name} to ${target.name}?`,
      message: `${plan.move.length} entr${plan.move.length === 1 ? 'y moves' : 'ies move'} to ${target.name}`
        + (plan.doubles.length ? `; ${plan.doubles.length} already there ${plan.doubles.length === 1 ? 'is' : 'are'} left out` : '')
        + `. "${guest.name}" is then removed from the members. This can't be undone.`,
      confirmLabel: 'Link',
    }))) return
    actions.linkGuest(guest.id, target.id)
    close()
  }

  return (
    <Sheet open={open} onClose={close} title={`Who is ${guest.name}?`}>
      <p className="text-sm text-muted">
        Pick the person who joined. {guest.name}'s history moves to them, and their special rate and goal too if they
        don't have their own.
      </p>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {joined.map(m => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => setPick(m.id)}
              aria-pressed={pick === m.id}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${pick === m.id ? 'bg-brand-soft' : 'hover:bg-sunken/70'}`}
            >
              <Avatar member={m} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.id === me ? `You (${m.name})` : m.name}</span>
            </button>
          </li>
        ))}
      </ul>

      {plan && target && (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <span className="font-semibold">{plan.move.length}</span> entr{plan.move.length === 1 ? 'y moves' : 'ies move'} to {target.name}.
          </p>
          {plan.doubles.length > 0 && (
            <div className="rounded-xl bg-accent-soft px-3 py-2 text-accent">
              <p className="font-semibold">
                {plan.doubles.length} look{plan.doubles.length === 1 ? 's' : ''} like {plan.doubles.length === 1 ? 'one' : 'ones'} {target.name} already
                has, so {plan.doubles.length === 1 ? "it's" : "they're"} left out:
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {plan.doubles.slice(0, 6).map(d => (
                  <li key={d.guest.id}>
                    {formatDate(d.guest.date)} {d.guest.type === 'deposit' ? '+' : '−'}{formatMoney(d.guest.amount)} (theirs: {formatDate(d.member.date)})
                  </li>
                ))}
                {plan.doubles.length > 6 && <li>…and {plan.doubles.length - 6} more</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>Cancel</Button>
        <Button onClick={link} disabled={!target || !plan}>Link</Button>
      </div>
    </Sheet>
  )
}
