import { Monitor, Moon, Sun } from 'lucide-react'

export const THEME_OPTIONS = [
  { value: 'system', label: 'System', description: 'Match this phone or computer', icon: Monitor },
  { value: 'light', label: 'Light', description: 'Always light', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Always dark', icon: Moon },
]
