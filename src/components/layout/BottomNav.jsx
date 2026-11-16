import { NavLink } from 'react-router'
import { Plus } from 'lucide-react'
import { useSavings } from '../../state/hooks.js'
import { NAV_ITEMS } from './navigation.js'

function Tab({ to, label, icon: Icon, end }) {
  return (
    <NavLink to={to} end={end} className="group flex flex-col items-center gap-1 py-2 text-[11px] font-semibold">
      {({ isActive }) => (
        <>
          <span className={`flex h-8 w-14 items-center justify-center rounded-full transition ${isActive ? 'bg-brand-soft text-brand-ink' : 'text-muted group-hover:text-ink'}`}>
            <Icon className="h-5 w-5" strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
          </span>
          <span className={isActive ? 'text-ink' : 'text-muted'}>{label}</span>
        </>
      )}
    </NavLink>
  )
}

/** Phone-only tab bar: two sections, the add button, two sections. */
export function BottomNav() {
  const { actions } = useSavings()
  const [first, second, third, fourth] = NAV_ITEMS

  return (
    <nav
      aria-label="Sections"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line/70 bg-surface/95 backdrop-blur-md md:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2">
        <Tab {...first} />
        <Tab {...second} />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => actions.openComposer()}
            className="-mt-5 mb-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-on-brand shadow-float ring-4 ring-canvas transition active:scale-95"
            aria-label="New transaction"
          >
            <Plus className="h-7 w-7" strokeWidth={2.4} />
          </button>
        </div>
        <Tab {...third} />
        <Tab {...fourth} />
      </div>
    </nav>
  )
}
