import { Calculator, CircleUserRound, Database, FileText, Palette, Plug, Users, Wallet } from 'lucide-react'
import AccountsSettings from './AccountsSettings.jsx'
import ProfileSettings from './ProfileSettings.jsx'
import SharingSettings from './SharingSettings.jsx'
import DataSettings from './DataSettings.jsx'
import ImportSettings from './ImportSettings.jsx'
import ConnectedAppsSettings from './ConnectedAppsSettings.jsx'
import LogicSettings from './LogicSettings.jsx'
import ThemeSettings from './ThemeSettings.jsx'
import { THEME_OPTIONS } from './themeOptions.js'

/**
 * Every settings section. Add a section by adding an entry here: it gets a
 * row in the Settings menu and a route at /settings/<path> automatically.
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
    summary: ({ accounts, account }) => accounts.length === 1 ? account.name : `${accounts.length} accounts · ${account.name} open`,
  },
  {
    path: 'import',
    label: 'Import statement',
    icon: FileText,
    Component: ImportSettings,
    summary: () => 'Yehulu PDF statements',
  },
  {
    path: 'sharing',
    label: 'Sharing',
    icon: Users,
    Component: SharingSettings,
    summary: ({ user, account }) => (!user || !account.cloud ? 'Save with friends'
      : account.members.length > 1 ? `${account.members.length} members` : 'Invite friends'),
  },
  {
    path: 'connections',
    label: 'Connected apps',
    icon: Plug,
    Component: ConnectedAppsSettings,
    summary: ({ user }) => (user ? 'Chinka and other apps' : 'Sign in to connect apps'),
  },
  {
    path: 'logic',
    label: 'Logic',
    icon: Calculator,
    Component: LogicSettings,
    summary: ({ currentRate }) => `${currentRate.annualRate}% a year · ${currentRate.serviceCharge}% charge`,
  },
  {
    path: 'theme',
    label: 'Theme',
    icon: Palette,
    Component: ThemeSettings,
    summary: ({ preference }) => THEME_OPTIONS.find(o => o.value === preference)?.label,
  },
  {
    path: 'data',
    label: 'Data',
    icon: Database,
    Component: DataSettings,
    summary: () => 'Back up, restore or delete',
  },
]
