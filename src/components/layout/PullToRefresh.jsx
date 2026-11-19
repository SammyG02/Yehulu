import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const THRESHOLD = 70 // px of pull (after easing) that triggers a refresh
const MAX = 110

/**
 * Drag down from the top of the page to refresh, like a native app (phones
 * only: touch events). `onRefresh` may return a promise; the spinner shows
 * until it settles.
 */
export function PullToRefresh({ onRefresh }) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const start = useRef(null)
  const pullRef = useRef(0)
  const busy = useRef(false)
  const refreshRef = useRef(onRefresh)
  refreshRef.current = onRefresh

  useEffect(() => {
    const set = (v) => { pullRef.current = v; setPull(v) }

    const onStart = (e) => {
      // Only from the very top, with one finger, and not while a sheet is open.
      if (busy.current || window.scrollY > 0 || e.touches.length !== 1 || document.body.style.overflow === 'hidden') {
        start.current = null
        return
      }
      start.current = e.touches[0].clientY
    }

    const onMove = (e) => {
      if (start.current === null) return
      const dy = e.touches[0].clientY - start.current
      if (dy <= 0 || window.scrollY > 0) {
        if (pullRef.current) set(0)
        return
      }
      // Ease out so it feels like stretching, and stop the page bouncing.
      set(Math.min(MAX, dy * 0.5))
      if (e.cancelable) e.preventDefault()
    }

    const onEnd = async () => {
      if (start.current === null) return
      start.current = null
      if (pullRef.current < THRESHOLD) {
        set(0)
        return
      }
      busy.current = true
      setRefreshing(true)
      set(THRESHOLD)
      const minimum = new Promise(r => setTimeout(r, 600))
      try {
        await Promise.all([refreshRef.current?.(), minimum])
      } finally {
        busy.current = false
        setRefreshing(false)
        set(0)
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  if (!pull && !refreshing) return null
  const ready = pull >= THRESHOLD

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-20 flex justify-center md:top-16"
      style={{ transform: `translateY(${pull - 40}px)`, transition: start.current === null ? 'transform 0.2s ease' : 'none' }}
      role="status"
      aria-label={refreshing ? 'Refreshing' : undefined}
    >
      <span className={`flex h-10 w-10 items-center justify-center rounded-full bg-surface shadow-float ring-1 ring-line ${ready || refreshing ? 'text-brand-ink' : 'text-muted'}`}>
        <RefreshCw
          className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
          aria-hidden="true"
        />
      </span>
    </div>
  )
}
