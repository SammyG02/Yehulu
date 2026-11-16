/** Pill-style single choice. Options: [{ value, label, icon? }]. */
export function Segmented({ options, value, onChange, label, size = 'sm', block = false, className = '' }) {
  const pad = size === 'lg' ? 'h-11 px-4 text-sm' : 'h-8 px-3 text-xs sm:text-sm'
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`${block ? 'flex w-full' : 'inline-flex'} rounded-xl bg-sunken p-1 ${className}`}
    >
      {options.map(({ value: v, label: text, icon: Icon, activeClass }) => {
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className={`${block ? 'flex-1' : ''} inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition ${pad} ${
              active ? (activeClass ?? 'bg-surface text-ink shadow-card') : 'text-muted hover:text-ink'
            }`}
          >
            {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
            {text}
          </button>
        )
      })}
    </div>
  )
}
