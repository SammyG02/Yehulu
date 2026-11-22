import { Bell, Calculator, CircleUserRound, Database, FileText, Palette, Plug, Users, Wallet } from 'lucide-react'
import AccountsSettings from './AccountsSettings.jsx'
import ProfileSettings from './ProfileSettings.jsx'
import SharingSettings from './SharingSettings.jsx'
import DataSettings from './DataSettings.jsx'
import ImportSettings from './ImportSettings.jsx'
import ConnectedAppsSettings from './ConnectedAppsSettings.jsx'
import NotificationsSettings from './NotificationsSettings.jsx'
import LogicSettings from './LogicSettings.jsx'
import ThemeSettings from './ThemeSettings.jsx'
import { THEME_OPTIONS } from './themeOptions.js'

/**
 * Every settings section. Add a section by adding an entry here: it gets a
 * route at /settings/<path> automatically, and a row in the Settings menu
 * unless it has a `parent` (then it's reached from inside that section).
 * `summary` is the short line under the label, showing the current value.
 */
export const SETTINGS_SECTIONS = [
  {
    path: 'profile',
    label: 'Profile',
    icon: CircleUserRound,
    Component: ProfileSettings,
    summary: ({ user }) => (user ? user.name : 'Sign in to back up and share'),
  },
  {
    path: 'accounts',
    label: 'Accounts',
    icon: Wallet,
    Component: AccountsSettings,
    summary: ({ accounts, account, currentRate }) =>
      `${accounts.length === 1 ? account.name : `${accounts.length} accounts`} · rate, sharing · ${currentRate.annualRate}%`,
  },
  {
    path: 'notifications',
    label: 'Notifications',
    icon: Bell,
    Component: NotificationsSettings,
    summary: () => 'Weekly summary, goals, reminders',
  },
  {
    path: 'data',
    label: 'Data',
    icon: Database,
    Component: DataSettings,
    summary: () => 'Import statements, export, back up',
  },
  {
    path: 'connections',
    label: 'Connected apps',
    icon: Plug,
    Component: ConnectedAppsSettings,
    summary: ({ user }) => (user ? 'Chinka and other apps' : 'Sign in to connect apps'),
  },
  {
    path: 'theme',
    label: 'Theme',
    icon: Palette,
    Component: ThemeSettings,
    summary: ({ preference }) => THEME_OPTIONS.find(o => o.value === preference)?.label,
  },
  // Inside other sections (not rows in the menu): their pages and links stay.
  { path: 'logic', label: 'Rate', parent: 'accounts', icon: Calculator, Component: LogicSettings },
  { path: 'sharing', label: 'Sharing', parent: 'accounts', icon: Users, Component: SharingSettings },
  { path: 'import', label: 'Import statement', parent: 'data', icon: FileText, Component: ImportSettings },
]

/** The section that owns a path in the menu (itself, or its parent). */
export const menuSectionOf = (path) => SETTINGS_SECTIONS.find(x => x.path === path)?.parent ?? path
