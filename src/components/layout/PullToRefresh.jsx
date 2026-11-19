import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'

const THRESHOLD = 64 // px of pull (after easing) that triggers a refresh
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

    const atTop = () => Math.max(window.scrollY, document.scrollingElement?.scrollTop ?? 0) <= 0

    const onStart = (e) => {
      // Only from the very top, with one finger, and not while a sheet is open.
      if (busy.current || !atTop() || e.touches.length !== 1 || document.body.style.overflow === 'hidden') {
        start.current = null
        return
      }
      start.current = e.touches[0].clientY
    }

    const onMove = (e) => {
      if (start.current === null) return
      const dy = e.touches[0].clientY - start.current
      if (dy <= 0 || !atTop()) {
        if (pullRef.current) set(0)
        return
      }
      // Ease out so it feels like stretching, and stop the page bouncing.
      set(Math.min(MAX, dy * 0.6))
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

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [])

  if (!pull && !refreshing) return null
  const ready = pull >= THRESHOLD

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-40 flex justify-center md:top-16"
      style={{
        transform: `translateY(${pull - 40}px)`,
        opacity: Math.min(1, pull / 30),
        transition: start.current === null ? 'transform 0.2s ease, opacity 0.2s ease' : 'none',
      }}
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
