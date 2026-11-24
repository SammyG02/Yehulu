import { useEffect, useRef } from 'react'
import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { useSavings } from '../../state/hooks.js'
import { Button } from '../ui/Button.jsx'

/**
 * Covers the app while a signed-in import is being saved, and if it fails says
 * why until you've read it. A modal dialog: nothing behind it can be used.
 */
export function ImportProgress() {
  const { importing, actions } = useSavings()
  const ref = useRef(null)
  const open = Boolean(importing)
  const message = importing?.message ?? null

  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="import-progress"
      // Escape or the phone's back button can't close it while it saves.
      onKeyDown={(e) => { if (e.key === 'Escape' && !message) e.preventDefault() }}
      onCancel={(e) => { if (!message) e.preventDefault() }}
      onClose={() => {
        if (message) actions.dismissImport()
        else if (open) ref.current.showModal()
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl bg-surface p-6 text-ink shadow-float outline-none backdrop:bg-black/50"
    >
      {message ? (
        <div className="space-y-4">
          <p id="import-progress" className="flex gap-2 text-sm font-bold">
            <TriangleAlert className="h-5 w-5 flex-shrink-0 text-neg" aria-hidden="true" /> Import not confirmed
          </p>
          <p role="alert" className="text-sm text-muted">{message}</p>
          <Button block onClick={actions.dismissImport}>OK</Button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <LoaderCircle className="h-6 w-6 flex-shrink-0 animate-spin text-brand" aria-hidden="true" />
          <div>
            <p id="import-progress" role="status" className="text-sm font-bold">Saving your import…</p>
            <p className="text-xs text-muted">Please wait. On a slow connection this can take a minute.</p>
          </div>
        </div>
      )}
    </dialog>
  )
}
