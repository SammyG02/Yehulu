import { Link } from 'react-router'
import { Logo } from '../components/layout/Logo.jsx'
import { usePageTitle } from '../hooks/usePageTitle.js'

const UPDATED = 'November 19, 2026'

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted [&_strong]:font-semibold [&_strong]:text-ink">{children}</div>
    </section>
  )
}

/** Public privacy policy (linked from Google's sign-in screen). */
export default function PrivacyPage() {
  usePageTitle('Privacy policy')

  return (
    <div className="min-h-dvh bg-canvas px-4 pb-16 pt-[calc(1.5rem+env(safe-area-inset-top))] sm:px-6">
      <div className="mx-auto max-w-2xl">
        <Logo />
        <h1 className="mt-8 text-3xl font-extrabold tracking-tight">Privacy policy</h1>
        <p className="mt-1 text-sm text-muted">Last updated {UPDATED}</p>

        <div className="mt-8 space-y-8">
          <Section title="What Yehulu is">
            <p>
              Yehulu is a personal savings tracker. You record deposits and withdrawals, and it works out the interest
              your savings earn. It is not a bank and never moves real money.
            </p>
          </Section>

          <Section title="What we collect">
            <p>
              <strong>Your Google account basics.</strong> If you sign in with Google, we receive your name, email address
              and profile picture. We use them only to sign you in and to show other members of a shared account who you are.
            </p>
            <p>
              <strong>What you enter.</strong> Account names, interest rates, goals, and the deposits and withdrawals you record.
            </p>
            <p>
              <strong>Basic usage statistics.</strong> Anonymous page-view counts (Vercel Web Analytics), with no cookies and
              nothing that identifies you.
            </p>
          </Section>

          <Section title="Where it is stored">
            <p>
              Signed-in data is stored with <strong>Supabase</strong>, our database provider. If you use Yehulu without
              signing in, your data stays only on your device. The website is hosted by <strong>Vercel</strong>.
            </p>
          </Section>

          <Section title="Who can see it">
            <p>
              Only you, and the people you invite into a shared account. Members of a shared account can see that
              account's details and transactions. Nobody else can, and we never sell your data or use it for advertising.
            </p>
          </Section>

          <Section title="Deleting your data">
            <p>
              You can delete any account and its transactions in the app at any time. To delete your sign-in and
              everything linked to it, ask the person who runs your Yehulu app, and it will be removed.
            </p>
          </Section>

          <Section title="Changes">
            <p>If this policy changes, the date at the top will change too.</p>
          </Section>
        </div>

        <Link to="/" className="mt-10 inline-block text-sm font-semibold text-brand-ink hover:underline">← Back to Yehulu</Link>
      </div>
    </div>
  )
}
