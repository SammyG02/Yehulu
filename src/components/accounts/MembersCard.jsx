import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Users } from 'lucide-react'
import { formatMoney } from '../../lib/format.js'
import { useMemberBalances, useSavings } from '../../state/hooks.js'
import { Card, CardHeader } from '../ui/Card.jsx'
import { Avatar } from './Avatar.jsx'
import { MemberPickerSheet } from './MemberPickerSheet.jsx'

// The card stays short however big the group is; the rest is one tap away.
const SHOWN = 5

/** Shared account: the total, and each member's balance when you may see it. */
export function MembersCard() {
  const { account, me, isOwner, canSeeAll, scope, setScope } = useSavings()
  const { total, byMember } = useMemberBalances()
  const [picking, setPicking] = useState(false)
  const seesAll = isOwner || account.membersSeeAll

  // You first, then the owner, then the biggest savers.
  const members = useMemo(() => {
    const visible = seesAll ? account.members : account.members.filter(m => m.id === me)
    const rank = (m) => (m.id === me ? 0 : m.role === 'owner' ? 1 : 2)
    return [...visible].sort((a, b) => rank(a) - rank(b) || (byMember.get(b.id) ?? 0) - (byMember.get(a.id) ?? 0))
  }, [seesAll, account.members, me, byMember])
  const hidden = members.length - SHOWN

  return (
    <Card>
      <CardHeader
        title="Members"
        subtitle={`${account.members.length} people save in ${account.name}`}
        action={<Link to="/settings/sharing" className="text-sm font-semibold text-brand-ink hover:underline">Manage</Link>}
      />
      <button
        type="button"
        disabled={!canSeeAll}
        onClick={() => setScope('all')}
        className={`mx-4 mt-3 flex w-[calc(100%-2rem)] items-baseline justify-between rounded-xl px-3 py-2.5 text-left transition sm:mx-5 sm:w-[calc(100%-2.5rem)] ${
          canSeeAll && scope === 'all' ? 'bg-brand-soft' : 'bg-sunken enabled:hover:brightness-95'}`}
      >
        <span className="text-sm text-muted">Account total</span>
        <span className="text-lg font-extrabold tabular-nums">{formatMoney(total)}</span>
      </button>
      <ul className="mt-2 divide-y divide-line pb-2">
        {members.slice(0, SHOWN).map(m => {
          // Tap someone to see the app as they do.
          const target = m.id === me ? 'me' : m.id
          const active = canSeeAll && scope === target
          return (
            <li key={m.id}>
              <button
                type="button"
                disabled={!canSeeAll}
                onClick={() => setScope(target)}
                aria-pressed={canSeeAll ? active : undefined}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition sm:px-5 ${active ? 'bg-brand-soft' : 'enabled:hover:bg-sunken/70'}`}
              >
                <Avatar member={m} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{m.id === me ? `You (${m.name})` : m.name}</span>
                  <span className="block text-xs text-muted">{m.role === 'owner' ? 'Owner' : m.guest ? 'No app' : 'Member'}</span>
                </span>
                <span className="text-sm font-bold tabular-nums">{formatMoney(byMember.get(m.id) ?? 0)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setPicking(true)}
          className="w-full border-t border-line px-4 py-3 text-left text-sm font-semibold text-brand-ink transition hover:bg-sunken/70 sm:px-5"
        >
          See all {members.length} members
        </button>
      )}
      {hidden > 0 && <MemberPickerSheet open={picking} onClose={() => setPicking(false)} />}
      {!seesAll && (
        <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
          <Users className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          The owner keeps each member's balance private.
        </p>
      )}
    </Card>
  )
}
