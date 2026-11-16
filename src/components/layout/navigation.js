import { ArrowLeftRight, ChartLine, House, Settings } from 'lucide-react'

/** The app's sections. Used by both the desktop top bar and the phone bottom bar. */
export const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/activity', label: 'Activity', icon: ArrowLeftRight },
  { to: '/growth', label: 'Growth', icon: ChartLine },
  { to: '/settings', label: 'Settings', icon: Settings },
]
