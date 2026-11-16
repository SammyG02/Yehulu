import { Navigate, NavLink, Outlet, useMatch } from 'react-router'
import { ChevronRight } from 'lucide-react'
import { PageHeader } from '../../components/layout/AppShell.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { useMediaQuery } from '../../hooks/useMediaQuery.js'
import { usePageTitle } from '../../hooks/usePageTitle.js'
import { useSavings } from '../../state/hooks.js'
import { useTheme } from '../../state/hooks.js'
import { SETTINGS_SECTIONS } from './sections.js'

function SettingsMenu() {
  const { account, transactions, currentRate } = useSavings()
  const { preference } = useTheme()
  const context = { account, transactions, currentRate, preference }

  return (
    <Card as="nav" aria-label="Settings sections" className="overflow-hidden">
      <ul className="divide-y divide-line">
        {SETTINGS_SECTIONS.map(({ path, label, icon: Icon, summary }) => (
          <li key={path}>
            <NavLink
              to={`/settings/${path}`}
              className={({ isActive }) =>
                `group flex items-center gap-3 px-4 py-3 transition hover:bg-sunken/70 ${isActive ? 'md:bg-brand-soft' : ''}`}
            >
              {({ isActive }) => (
                <>
                  <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${isActive ? 'md:bg-brand md:text-on-brand' : ''} bg-sunken text-ink`}>
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm font-semibold ${isActive ? 'md:text-brand-ink' : ''}`}>{label}</span>
                    <span className="block truncate text-xs text-muted">{summary(context)}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted md:hidden" aria-hidden="true" />
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * Phones: /settings is a list; each section opens on its own screen.
 * md and up: the list stays on the left and the section shows beside it.
 */
export default function SettingsLayout() {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const atList = Boolean(useMatch({ path: '/settings', end: true }))
  usePageTitle(atList ? 'Settings' : undefined)

  if (isDesktop && atList) return <Navigate to={`/settings/${SETTINGS_SECTIONS[0].path}`} replace />

  return (
    <div className="mx-auto max-w-4xl">
      <div className={atList ? '' : 'hidden md:block'}>
        <PageHeader title="Settings" />
      </div>
      <div className="md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-6">
        <aside className={`${atList ? '' : 'hidden'} md:sticky md:top-24 md:block`}>
          <SettingsMenu />
        </aside>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
