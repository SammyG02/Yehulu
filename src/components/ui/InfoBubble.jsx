import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A number you can tap (or hover on a computer) for a small bubble that
 * explains it. The bubble is drawn at the page level (a portal), so cards,
 * scrolling lists and blurred sticky headers never cut it off or move it; it
 * closes on a tap elsewhere, Esc or scroll.
 *   label: what's shown; tone: 'brand' | 'neg' | 'muted'
 *   rows: [[label, value, { strong, tone }], ...]: the last one is the total
 */
export function InfoBubble({ label, ariaLabel, rows, tone = 'brand', className = '', width = 'w-56' }) {
  const [at, setAt] = useState(null)
  const open = at !== null
  const box = useRef(null)
  const tip = useRef(null)
  const show = () => {
    const r = box.current?.getBoundingClientRect()
    if (r) setAt({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
  }
  const hide = () => setAt(null)
  useEffect(() => {
    if (!open) return
    const away = (e) => { if (!box.current?.contains(e.target) && !tip.current?.contains(e.target)) hide() }
    const esc = (e) => { if (e.key === 'Escape') hide() }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', hide, true)
    }
  }, [open])

  const colour = { brand: 'text-brand-ink decoration-brand/50 hover:decoration-brand', neg: 'text-neg decoration-neg/40 hover:decoration-neg', muted: 'text-muted decoration-muted/50 hover:decoration-muted' }[tone]
  const totalColour = { brand: 'text-brand-ink', neg: 'text-neg', muted: 'text-ink' }

  return (
    <span ref={box} onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        onClick={() => (open ? hide() : show())}
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`whitespace-nowrap rounded-md tabular-nums underline decoration-dotted underline-offset-4 transition ${colour} ${className}`}
      >
        {label}
      </button>
      {open && createPortal(
        <span ref={tip} role="tooltip" style={{ top: at.top, right: at.right }} className={`fixed z-[60] block ${width} rounded-xl border border-line bg-surface p-3 text-left text-xs font-normal shadow-float`}>
          <span className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 tabular-nums">
            {rows.map(([name, value, opt = {}], i) => {
              const last = i === rows.length - 1
              return [
                <span key={`${i}a`} className={last ? 'border-t border-line pt-1 font-semibold text-ink' : 'text-muted'}>{name}</span>,
                <span key={`${i}b`} className={last ? `border-t border-line pt-1 font-bold ${totalColour[opt.tone ?? tone]}` : 'text-ink'}>{value}</span>,
              ]
            })}
          </span>
        </span>,
        document.body,
      )}
    </span>
  )
}
