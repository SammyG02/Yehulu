import { Calculator, Database, Palette } from 'lucide-react'
import DataSettings from './DataSettings.jsx'
import LogicSettings from './LogicSettings.jsx'
import ThemeSettings, { THEME_OPTIONS } from './ThemeSettings.jsx'

/**
 * Every settings section. Add a section by adding an entry here: it gets a
 * row in the Settings menu and a route at /settings/<path> automatically.
 * `summary` is the short line under the label, showing the current value.
 */
export const SETTINGS_SECTIONS = [
  {
    path: 'logic',
    label: 'Logic',
    icon: Calculator,
    Component: LogicSettings,
    summary: ({ account }) => `${account.annualRate}% a year · ${account.serviceCharge}% charge`,
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
