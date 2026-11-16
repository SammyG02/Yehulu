import { useEffect, useState } from 'react'
import { toDateKey } from '../lib/dates.js'

/** Today's date key, updated at midnight and whenever the tab becomes visible again. */
export function useToday() {
  const [today, setToday] = useState(() => toDateKey(new Date()))

  useEffect(() => {
    const refresh = () => setToday(toDateKey(new Date()))
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5)
    const timer = setTimeout(refresh, nextMidnight - now)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [today])

  return today
}
