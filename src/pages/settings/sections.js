import { Calculator, Database, Palette, Wallet } from 'lucide-react'
import AccountsSettings from './AccountsSettings.jsx'
import DataSettings from './DataSettings.jsx'
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
    path: 'accounts',
    label: 'Accounts',
    icon: Wallet,
    Component: AccountsSettings,
    summary: ({ accounts, account }) => accounts.length === 1 ? account.name : `${accounts.length} accounts · ${account.name} open`,
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
