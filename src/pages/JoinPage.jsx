import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { LoaderCircle, Users } from 'lucide-react'
import { GoogleButton } from '../components/auth/GoogleButton.jsx'
import { Logo } from '../components/layout/Logo.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Card } from '../components/ui/Card.jsx'
import { usePageTitle } from '../hooks/usePageTitle.js'
import { useAuth, useSavings } from '../state/hooks.js'

function Spinner({ text }) {
  return (
    <p className="flex items-center justify-center gap-2 py-6 text-sm font-semibold text-muted" role="status">
      <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> {text}
    </p>
  )
}

function Invite({ code }) {
  const { actions } = useSavings()
  const { invitePreview } = actions
  const navigate = useNavigate()
  const [preview, setPreview] = useState(undefined)
  const [error, setError] = useState(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    let cancelled = false
    invitePreview(code)
      .then(p => { if (!cancelled) setPreview(p) })
      .catch(err => { if (!cancelled) { setPreview(null); setError(err.message) } })
    return () => { cancelled = true }
  }, [code, invitePreview])

  const join = async () => {
    setJoining(true)
    setError(null)
    try {
      await actions.joinAccount(code)
      actions.showToast(`You joined ${preview.account_name}`)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
      setJoining(false)
    }
  }

  if (preview === undefined) return <Spinner text="Checking the invite…" />

  if (!preview) {
    return (
      <>
        <h1 className="text-xl font-extrabold tracking-tight">This invite link doesn't work</h1>
        <p className="mt-2 text-sm text-muted">It may have been turned off or replaced. Ask for a new link.</p>
        {error && <p className="mt-2 text-xs text-muted">{error}</p>}
        <Link to="/" className="mt-5 inline-block text-sm font-semibold text-brand-ink hover:underline">Go to Yehulu →</Link>
      </>
    )
  }

  if (preview.already_member) {
    return (
      <>
        <h1 className="text-xl font-extrabold tracking-tight">You're already in {preview.account_name}</h1>
        <Button className="mt-5" onClick={async () => { await actions.joinAccount(code); navigate('/', { replace: true }) }}>Open it</Button>
      </>
    )
  }

  const others = Number(preview.member_count)
  return (
    <>
      <p className="text-sm font-semibold text-muted">{preview.owner_name || 'A friend'} invited you to</p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{preview.account_name}</h1>
      <p className="mt-2 flex items-center gap-2 text-sm text-muted">
        <Users className="h-4 w-4" aria-hidden="true" /> {others} {others === 1 ? 'person saves' : 'people save'} here
      </p>
      <p className="mt-4 text-sm text-muted">
        You'll add your own deposits and earn interest on your own money.
      </p>
      {error && <p role="alert" className="mt-3 text-sm text-neg">{error}</p>}
      <Button size="lg" block className="mt-5" disabled={joining} onClick={join}>
        {joining ? 'Joining…' : `Join ${preview.account_name}`}
      </Button>
    </>
  )
}

/** /join/:code — opened from an invite link. */
export default function JoinPage() {
  usePageTitle('Join')
  const { code } = useParams()
  const { enabled, ready, user } = useAuth()

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4 py-10">
      <Logo />
      <Card className="w-full max-w-md p-6">
        {!enabled ? (
          <p className="text-sm text-muted">Sign-in isn't set up for this version of the app.</p>
        ) : !ready ? (
          <Spinner text="Loading…" />
        ) : !user ? (
          <>
            <h1 className="text-xl font-extrabold tracking-tight">You're invited to save together</h1>
            <p className="mt-2 text-sm text-muted">
              Sign in to see the account and join it. Each person earns interest on their own deposits.
            </p>
            <GoogleButton className="mt-5" returnTo={`/join/${code}`} />
          </>
        ) : (
          <Invite code={code} />
        )}
      </Card>
      <Link to="/privacy" className="text-xs text-muted hover:underline">Privacy policy</Link>
    </div>
  )
}
