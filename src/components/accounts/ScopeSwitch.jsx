import { useSavings } from '../../state/hooks.js'
import { Segmented } from '../ui/Segmented.jsx'

const OPTIONS = [
  { value: 'all', label: 'Everyone' },
  { value: 'me', label: 'Just me' },
]

/** Whole shared account or just your own money (only for those who may see everyone's). */
export function ScopeSwitch() {
  const { canSeeAll, scope, setScope } = useSavings()
  if (!canSeeAll) return null
  return <Segmented options={OPTIONS} value={scope} onChange={setScope} label="Whose money to show" />
}
