import { CloudOff, LoaderCircle, PiggyBank } from 'lucide-react'
import { useAuth, useSavings } from '../../state/hooks.js'
import { NewAccountForm } from '../accounts/AccountSwitcher.jsx'
import { Button } from '../ui/Button.jsx'
import { Card } from '../ui/Card.jsx'
import { Logo } from './Logo.jsx'

/**
 * Shown instead of the app while signed-in data loads, if it fails to load,
 * or when a signed-in person has no accounts left.
 */
export function CloudGate() {
  const { cloudStatus, cloudError, actions } = useSavings()
  const { signOut } = useAuth()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo />
      {cloudStatus === 'loading' && (
        <p className="flex items-center gap-2 text-sm font-semibold text-muted" role="status">
          <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading your accounts…
        </p>
      )}

      {cloudStatus === 'error' && (
        <Card className="w-full max-w-md p-5 text-center">
          <CloudOff className="mx-auto h-8 w-8 text-neg" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-bold">Couldn't load your accounts</h1>
          <p className="mt-1 text-sm text-muted">Check your internet connection and try again.</p>
          <p className="mt-3 break-words rounded-xl bg-sunken px-3 py-2 text-left font-mono text-xs text-muted">{cloudError}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="ghost" onClick={signOut}>Sign out</Button>
            <Button onClick={actions.reload}>Try again</Button>
          </div>
        </Card>
      )}

      {cloudStatus === 'empty' && (
        <Card className="w-full max-w-md p-5">
          <PiggyBank className="h-8 w-8 text-brand-ink" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-bold">Create your first account</h1>
          <p className="mb-4 mt-1 text-sm text-muted">Or open an invite link a friend sent you to join theirs.</p>
          <NewAccountForm />
          <button type="button" onClick={signOut} className="mt-4 text-sm font-semibold text-muted hover:text-ink">Sign out</button>
        </Card>
      )}
    </div>
  )
}
