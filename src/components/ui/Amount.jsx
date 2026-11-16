import { CURRENCY, formatAmount } from '../../lib/format.js'

/** Money with a smaller currency label: <small>Br</small> 1,234.50 */
export function Amount({ value, sign = '', className = '' }) {
  return (
    // Only the number itself never breaks; on very narrow screens it can wrap
    // below the currency label instead of being cut off.
    <span className={`tabular-nums ${className}`}>
      <span className="whitespace-nowrap">
        {sign}
        <span className="mr-[0.25em] text-[0.6em] font-semibold opacity-70">{CURRENCY}</span>
      </span>
      <span className="whitespace-nowrap">{formatAmount(value)}</span>
    </span>
  )
}
