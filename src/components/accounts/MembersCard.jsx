import { useMemo } from 'react'
import { Link } from 'react-router'
import { Users } from 'lucide-react'
import { formatMoney } from '../../lib/format.js'
import { simulateLedger, summarize } from '../../lib/interest.js'
import { useSavings } from '../../state/hooks.js'
import { Card, CardHeader } from '../ui/Card.jsx'

/** Balance today of one person's transactions (everyone earns on their own money). */
const balanceOf = (transactions, rates, today) =>
  summarize(simulateLedger({ transactions, rates, fromDate: today, endDate: today }), today).balance

const groupBy = (list, key) => {
  const map = new Map()
  for (const item of list) map.set(key(item), [...(map.get(key(item)) ?? []), item])
  return map
}

export function Avatar({ member, className = 'h-8 w-8' }) {
  if (member.avatarUrl) {
    return <img src={member.avatarUrl} alt="" referrerPolicy="no-referrer" className={`${className} flex-shrink-0 rounded-full object-cover`} />
  }
  return (
    <span className={`${className} flex flex-shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-ink`} aria-hidden="true">
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Shared account: the total, and each member's balance when you may see it. */
export function MembersCard() {
  const { account, allTransactions, rates, today, me, isOwner } = useSavings()
  const seesAll = isOwner || account.membersSeeAll

  const { total, byMember } = useMemo(() => {
    // The total comes from the anonymous list, so it's right even when you
    // can only see your own transactions.
    const groups = groupBy(account.activity ?? [], t => t.memberKey)
    const total = [...groups.values()].reduce((sum, list) => sum + balanceOf(list, rates, today), 0)
    const mine = groupBy(allTransactions, t => t.memberId)
    const byMember = new Map([...mine].map(([id, list]) => [id, balanceOf(list, rates, today)]))
    return { total, byMember }
  }, [account.activity, allTransactions, rates, today])

  const members = seesAll ? account.members : account.members.filter(m => m.id === me)

  return (
    <Card>
      <CardHeader
        title="Members"
        subtitle={`${account.members.length} people save in ${account.name}`}
        action={<Link to="/settings/sharing" className="text-sm font-semibold text-brand-ink hover:underline">Manage</Link>}
      />
      <div className="mx-4 mt-3 flex items-baseline justify-between rounded-xl bg-sunken px-3 py-2.5 sm:mx-5">
        <span className="text-sm text-muted">Account total</span>
        <span className="text-lg font-extrabold tabular-nums">{formatMoney(total)}</span>
      </div>
      <ul className="mt-2 divide-y divide-line pb-2">
        {members.map(m => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <Avatar member={m} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{m.id === me ? `You (${m.name})` : m.name}</span>
              <span className="block text-xs text-muted">{m.role === 'owner' ? 'Owner' : m.guest ? 'No app' : 'Member'}</span>
            </span>
            <span className="text-sm font-bold tabular-nums">{formatMoney(byMember.get(m.id) ?? 0)}</span>
          </li>
        ))}
      </ul>
      {!seesAll && (
        <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
          <Users className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          The owner keeps each member's balance private.
        </p>
      )}
    </Card>
  )
}
