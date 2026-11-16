import { Link, NavLink } from 'react-router'
import { Plus } from 'lucide-react'
import { useSavings } from '../../state/hooks.js'
import { Button } from '../ui/Button.jsx'
import { Logo } from './Logo.jsx'
import { NAV_ITEMS } from './navigation.js'

/** Sticky top bar. Phones get the logo only; md and up get the full section nav. */
export function TopBar() {
  const { account, currentRate, actions } = useSavings()

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
                    `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
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
          <Link to="/settings/logic" className="max-w-[10rem] truncate rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-ink md:hidden">
            {currentRate.annualRate}% · {account.name}
          </Link>
          <Button className="hidden md:inline-flex" onClick={() => actions.openComposer()}>
            <Plus className="h-4 w-4" aria-hidden="true" /> New transaction
          </Button>
        </div>
      </div>
    </header>
  )
}
