import { useAmountInput } from '../../hooks/useAmountInput.js'
import { CURRENCY } from '../../lib/format.js'

// min-w-0 / appearance-none / block: iPhone gives date boxes a minimum width
// that otherwise pushes them past the edge of the screen.
export const inputClass =
  'block h-11 w-full min-w-0 max-w-full appearance-none rounded-xl [&::-webkit-date-and-time-value]:text-left border border-line bg-canvas px-4 text-base text-ink placeholder:text-muted/70 transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25'

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

/** Amount in Birr shown as "200,000". `onValueChange` gets the plain number text ("200000"). */
export function MoneyInput({ value, onValueChange, ...props }) {
  const amount = useAmountInput(value, onValueChange)
  return <AffixInput prefix={CURRENCY} placeholder="0.00" {...props} {...amount} />
}
