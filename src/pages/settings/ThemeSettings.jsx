import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { SettingsPanel, SettingsRow } from '../../components/settings/SettingsUI.jsx'
import { Card } from '../../components/ui/Card.jsx'
import { useTheme } from '../../state/theme.jsx'

export const THEME_OPTIONS = [
  { value: 'system', label: 'System', description: 'Match this phone or computer', icon: Monitor },
  { value: 'light', label: 'Light', description: 'Always light', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Always dark', icon: Moon },
]

export default function ThemeSettings() {
  const { preference, setPreference } = useTheme()
  return (
    <SettingsPanel title="Theme" description="How Yehulu looks on this device.">
      <Card className="overflow-hidden">
        <div role="radiogroup" aria-label="Theme" className="divide-y divide-line">
          {THEME_OPTIONS.map(option => {
            const active = option.value === preference
            return (
              <SettingsRow
                key={option.value}
                role="radio"
                aria-checked={active}
                icon={option.icon}
                label={option.label}
                description={option.description}
                onClick={() => setPreference(option.value)}
                trailing={active && <Check className="h-5 w-5 text-brand-ink" aria-hidden="true" />}
              />
            )
          })}
        </div>
      </Card>
    </SettingsPanel>
  )
}
