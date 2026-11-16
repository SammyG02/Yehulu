import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'

/**
 * Bottom sheet on phones, centred dialog from the md breakpoint up.
 * Closes on Escape or a backdrop tap; locks page scroll while open.
 */
export function Sheet({ open, onClose, title, children }) {
  const titleId = useId()
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    // Move focus inside, unless a field already took it with autoFocus.
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previousFocus?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative max-h-[92dvh] w-full animate-sheet-in overflow-y-auto rounded-t-[1.75rem] bg-surface px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2 shadow-float outline-none md:max-w-md md:animate-pop-in md:rounded-3xl md:p-6"
      >
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line md:hidden" aria-hidden="true" />
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-lg font-bold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-muted transition hover:bg-sunken hover:text-ink"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
