import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { formatMoney } from '../../lib/format.js'
import { useMemberBalances, useSavings } from '../../state/hooks.js'
import { inputClass } from '../ui/Field.jsx'
import { Sheet } from '../ui/Sheet.jsx'
import { Avatar } from './Avatar.jsx'

const roleText = (m) => (m.role === 'owner' ? 'Owner' : m.guest ? 'No app' : 'Member')

/** Pick a member to view the app as. Searchable, so it works with 100 people. */
export function MemberPickerSheet({ open, onClose }) {
  const { account, me, scope, setScope } = useSavings()
  const { byMember } = useMemberBalances()
  const [query, setQuery] = useState('')

  const people = useMemo(() => {
    const q = query.trim().toLowerCase()
    return account.members
      .filter(m => m.id !== me && (!q || m.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [account.members, me, query])

  const close = () => { setQuery(''); onClose() }
  const pick = (id) => { setScope(id); close() }

  return (
    <Sheet open={open} onClose={close} title="View as">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${account.members.length - 1} member${account.members.length === 2 ? '' : 's'}`}
          aria-label="Search members"
          className={`${inputClass} pl-10`}
        />
      </div>
      <ul className="mt-3 divide-y divide-line">
        {people.map(m => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => pick(m.id)}
              aria-pressed={scope === m.id}
              className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition ${scope === m.id ? 'bg-brand-soft' : 'hover:bg-sunken/70'}`}
            >
              <Avatar member={m} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{m.name}</span>
                <span className="block text-xs text-muted">{roleText(m)}</span>
              </span>
              <span className="text-sm font-bold tabular-nums">{formatMoney(byMember.get(m.id) ?? 0)}</span>
            </button>
          </li>
        ))}
      </ul>
      {people.length === 0 && <p className="py-6 text-center text-sm text-muted">Nobody called “{query.trim()}”.</p>}
    </Sheet>
  )
}
