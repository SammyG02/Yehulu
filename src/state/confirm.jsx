import { useCallback, useMemo, useRef, useState } from 'react'
import { Button } from '../components/ui/Button.jsx'
import { Sheet } from '../components/ui/Sheet.jsx'
import { ConfirmContext } from './contexts.js'

/**
 * In-app "Are you sure?" in Yehulu's own style (the browser's confirm() shows
 * the web address and looks out of place, especially on iPhone).
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title, message, confirmLabel, danger: true })) …
 */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null)
  const resolver = useRef(null)

  const confirm = useCallback((options) => new Promise((resolve) => {
    resolver.current?.(false)
    resolver.current = resolve
    setRequest(options)
  }), [])

  const answer = useCallback((value) => {
    resolver.current?.(value)
    resolver.current = null
    setRequest(null)
  }, [])

  const value = useMemo(() => confirm, [confirm])

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Sheet open={Boolean(request)} onClose={() => answer(false)} title={request?.title ?? ''}>
        {request && (
          <div className="space-y-5">
            {request.message && <p className="text-sm leading-relaxed text-muted">{request.message}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" size="lg" onClick={() => answer(false)}>{request.cancelLabel ?? 'Cancel'}</Button>
              <Button variant={request.danger ? 'danger' : 'primary'} size="lg" autoFocus onClick={() => answer(true)}>
                {request.confirmLabel ?? 'Continue'}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </ConfirmContext.Provider>
  )
}
