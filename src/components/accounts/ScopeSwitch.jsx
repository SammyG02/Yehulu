import { ChevronDown, Eye } from 'lucide-react'
import { useSavings } from '../../state/hooks.js'

/**
 * Whose money the pages show: the whole shared account, just yours, or one
 * member's ("view as"). Only for those who may see everyone's money.
 */
export function ScopeSwitch() {
  const { canSeeAll, scope, setScope, account, me } = useSavings()
  if (!canSeeAll) return null
  const others = account.members.filter(m => m.id !== me)
  return (
    <label className="relative inline-flex max-w-[11rem] items-center">
      <span className="sr-only">Whose money to show</span>
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value)}
        className="h-9 w-full cursor-pointer appearance-none truncate rounded-full bg-brand-soft pl-3.5 pr-8 text-sm font-semibold text-brand-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <option value="all">Everyone</option>
        <option value="me">Just me</option>
        {others.length > 0 && (
          <optgroup label="View as">
            {others.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </optgroup>
        )}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-brand-ink" aria-hidden="true" />
    </label>
  )
}

/** Shown while viewing as another member, with the way back. */
export function ViewingBanner() {
  const { viewMember, setScope } = useSavings()
  if (!viewMember) return null
  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl bg-accent-soft px-4 py-2.5 text-sm md:mb-5" role="status">
      <Eye className="h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        Viewing as <span className="font-bold">{viewMember.name}</span>. This is what they see.
      </span>
      <button type="button" onClick={() => setScope('all')} className="flex-shrink-0 font-semibold text-ink underline-offset-2 hover:underline">
        Back to everyone
      </button>
    </div>
  )
}
