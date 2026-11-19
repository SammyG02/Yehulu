import { NavLink } from 'react-router'
import { Plus } from 'lucide-react'
import { useSavings } from '../../state/hooks.js'
import { AccountSwitcher } from '../accounts/AccountSwitcher.jsx'
import { Button } from '../ui/Button.jsx'
import { Logo } from './Logo.jsx'
import { NAV_ITEMS } from './navigation.js'

/** Sticky top bar: logo, section nav (md and up) and the account switcher. */
export function TopBar() {
  const { actions } = useSavings()

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 md:h-16">
        <Logo />

        <nav aria-label="Sections" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={end}
                  className={({ isActive }) =>
                    `flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold transition lg:px-4 ${
                      isActive ? 'bg-brand-soft text-brand-ink' : 'text-muted hover:bg-sunken hover:text-ink'
                    }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <AccountSwitcher />
          <Button className="hidden md:inline-flex md:max-lg:px-3" onClick={() => actions.openComposer()} aria-label="New transaction">
            <Plus className="h-4 w-4" aria-hidden="true" /> <span className="md:max-lg:hidden">New transaction</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
