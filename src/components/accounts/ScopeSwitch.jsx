import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useSavings } from '../../state/hooks.js'
import { Segmented } from '../ui/Segmented.jsx'
import { MemberPickerSheet } from './MemberPickerSheet.jsx'

const PICK = 'pick'

/**
 * Whose money the pages show: Everyone | Me | a member ("view as"). The third
 * pill shows the member's name while you're viewing as them, and opens a
 * searchable list. Only for those who may see everyone's money.
 */
export function ScopeSwitch() {
  const { canSeeAll, scope, setScope, viewMember } = useSavings()
  const [picking, setPicking] = useState(false)
  if (!canSeeAll) return null

  const options = [
    { value: 'all', label: 'Everyone' },
    { value: 'me', label: 'Me' },
    {
      value: PICK,
      label: (
        <>
          <span className="max-w-[5.5rem] truncate">{viewMember ? viewMember.name.split(' ')[0] : 'Member'}</span>
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
        </>
      ),
    },
  ]

  return (
    <>
      <Segmented
        options={options}
        value={viewMember ? PICK : scope}
        onChange={(v) => (v === PICK ? setPicking(true) : setScope(v))}
        label="Whose money to show"
      />
      <MemberPickerSheet open={picking} onClose={() => setPicking(false)} />
    </>
  )
}
