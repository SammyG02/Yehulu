import { CURRENCY } from '../../lib/format.js'

export const inputClass =
  'h-11 w-full rounded-xl border border-line bg-canvas px-4 text-base text-ink placeholder:text-muted/70 transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25'

export function Field({ id, label, hint, error, optional, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      {children}
      {error
        ? <p className="mt-1.5 text-sm text-neg" role="alert">{error}</p>
        : hint && <p className="mt-1.5 text-xs text-muted">{hint}</p>}
    </div>
  )
}

/** Number input with a fixed prefix (Br) or suffix (%). */
export function AffixInput({ prefix, suffix, className = '', ...props }) {
  return (
    <div className="relative">
      {prefix && (
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-sm font-semibold text-muted">{prefix}</span>
      )}
      <input
        type="number"
        inputMode="decimal"
        className={`${inputClass} tabular-nums ${prefix ? 'pl-11' : ''} ${suffix ? 'pr-10' : ''} ${className}`}
        {...props}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-muted">{suffix}</span>
      )}
    </div>
  )
}

export const MoneyInput = (props) => <AffixInput prefix={CURRENCY} min="0" step="0.01" placeholder="0.00" {...props} />
