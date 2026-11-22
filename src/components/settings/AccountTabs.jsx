import { NavLink } from 'react-router'

const TABS = [
  ['/settings/accounts', 'Accounts'],
  ['/settings/logic', 'Rate'],
  ['/settings/sharing', 'Sharing'],
]

/** Accounts, and the open account's rate and sharing, one tap apart. */
export function AccountTabs() {
  return (
    <nav aria-label="Account settings" className="flex gap-1 rounded-xl bg-sunken p-1">
      {TABS.map(([to, label]) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) => `flex-1 rounded-lg px-3 py-1.5 text-center text-sm font-semibold transition ${
            isActive ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'}`}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
