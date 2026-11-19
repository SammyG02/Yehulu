import { useLayoutEffect, useRef } from 'react'
import { cleanAmountInput, groupAmountInput } from '../lib/format.js'

/**
 * Props for a text box that shows an amount as "200,000" while typing.
 * `value` and `onValue` use the plain form ("200000"), so nothing else has to
 * know about the commas. The cursor stays after the same digit as the commas
 * move around.
 */
export function useAmountInput(value, onValue) {
  const ref = useRef(null)
  // How many digits (and point) were before the cursor, to put it back there.
  const caret = useRef(null)
  const shown = groupAmountInput(value)

  useLayoutEffect(() => {
    const el = ref.current
    if (caret.current === null || !el || document.activeElement !== el) return
    let seen = 0
    let pos = 0
    while (pos < shown.length && seen < caret.current) {
      if (shown[pos] !== ',') seen++
      pos++
    }
    el.setSelectionRange(pos, pos)
    caret.current = null
  }, [shown])

  const onChange = (e) => {
    const { value: typed, selectionStart } = e.target
    caret.current = cleanAmountInput(typed.slice(0, selectionStart ?? typed.length)).length
    onValue(cleanAmountInput(typed))
  }

  return { ref, type: 'text', inputMode: 'decimal', autoComplete: 'off', value: shown, onChange }
}
