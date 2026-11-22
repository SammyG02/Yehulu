import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChartLine, ChevronDown, ChevronRight, CloudUpload, TriangleAlert } from 'lucide-react'
import { PageHeader } from '../components/layout/AppShell.jsx'
import { ChartLegend, LazyBalanceChart } from '../components/charts/LazyBalanceChart.jsx'
import { MembersCard } from '../components/accounts/MembersCard.jsx'
import { MonthlyInterestSheet } from '../components/MonthlyInterestSheet.jsx'
import { ScopeSwitch } from '../components/accounts/ScopeSwitch.jsx'
import { GoalCard } from '../components/GoalPlanner.jsx'
import { GoogleButton } from '../components/auth/GoogleButton.jsx'
import { InstallBanner } from '../components/InstallBanner.jsx'
import { TransactionRow } from '../components/transactions/TransactionRow.jsx'
import { Amount } from '../components/ui/Amount.jsx'
import { ButtonLink } from '../components/ui/Button.jsx'
import { Card, CardHeader } from '../components/ui/Card.jsx'
import { usePageTitle } from '../hooks/usePageTitle.js'
import { formatDate, formatMoney, greeting } from '../lib/format.js'
import { effectiveAnnualRate, findOverdraft, summarize } from '../lib/interest.js'
import { toFraction } from '../lib/storage.js'
import { useAuth, useLedger, useSavings } from '../state/hooks.js'

// Solid brand green (#24b663) with black text, like the logo's green and black.
// White text would be too faint on this green.
const HERO = 'relative overflow-hidden rounded-3xl bg-brand p-4 text-[#04160c] shadow-float sm:p-6'

function HeroDecoration() {
  return (
    <div aria-hidden="true">
      <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border-[28px] border-white/15" />
      <div className="absolute -bottom-28 -left-10 h-56 w-56 rounded-full bg-black/10 blur-3xl" />
    </div>
  )
}

function BalanceCard({ summary }) {
  const { actions, shared, scope, viewMember } = useSavings()
  return (
    <div className={HERO}>
      <HeroDecoration />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-[#04160c]/70">{!shared ? 'Total balance' : scope === 'all' ? 'Account balance' : viewMember ? `${viewMember.name}'s balance` : 'Your balance'}</p>
          {/* Interest earned for today; it's added to the balance when the day ends. */}
          <span
            className="whitespace-nowrap rounded-full bg-white/85 px-2.5 py-1 text-xs font-semibold text-[#0d6b35]"
            title="Interest earned today. It's added to your balance at the end of the day."
          >
            +{formatMoney(summary.interestToday)} today
          </span>
        </div>
        <p className="mt-1 text-[clamp(1.875rem,9vw,3rem)] font-extrabold leading-tight tracking-tight">
          <Amount value={summary.balance} />
        </p>
        {summary.depositedToday > 0 && (
          <p className="mt-1 text-xs text-[#04160c]/70">Today's deposit earns from today; interest is added tonight.</p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => actions.openComposer('deposit')}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#04160c] font-bold text-white transition hover:bg-black active:scale-[0.98]"
          >
            <ArrowDownLeft className="h-5 w-5" aria-hidden="true" /> Deposit
          </button>
          <button
            type="button"
            onClick={() => actions.openComposer('withdrawal')}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white/85 font-bold text-[#04160c] transition hover:bg-white active:scale-[0.98]"
          >
            <ArrowUpRight className="h-5 w-5" aria-hidden="true" /> Withdraw
          </button>
        </div>
      </div>
    </div>
  )
}

/** Shown when the history goes below zero somewhere, e.g. after deleting a deposit. */
function OverdraftBanner({ date, today }) {
  return (
    <div role="status" className="mb-3 flex items-start gap-3 rounded-2xl border border-neg/25 bg-neg-soft px-4 py-3 text-sm md:mb-5">
      <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-neg" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        Your balance {date <= today ? 'went' : 'will go'} below zero on{' '}
        <span className="font-bold">{formatDate(date)}</span>.{' '}
        <span className="text-muted">A deposit may be missing, or an amount or date is wrong.</span>
      </p>
      <Link to="/activity" className="flex-shrink-0 font-semibold text-neg hover:underline">Review</Link>
    </div>
  )
}

function Stat({ label, value, tone = '', className = '', onClick }) {
  const body = (
    <>
      <p className="flex items-center justify-between gap-1 text-xs font-semibold text-muted">
        {label}
        {onClick && <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />}
      </p>
      <p className={`mt-1 text-base font-extrabold tracking-tight sm:text-lg ${tone}`}>
        <Amount value={value} />
      </p>
    </>
  )
  if (!onClick) return <Card className={`min-w-0 p-3 sm:p-4 ${className}`}>{body}</Card>
  return (
    <Card as="button" type="button" onClick={onClick} className={`min-w-0 p-3 text-left transition hover:border-brand sm:p-4 ${className}`}>
      {body}
    </Card>
  )
}

/** "Everyone put in", tap to see what each person put in (deposits minus withdrawals). */
function PutInByMember({ total }) {
  const { account, allTransactions, me } = useSavings()
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => {
    const net = new Map()
    for (const t of allTransactions) {
      net.set(t.memberId, (net.get(t.memberId) ?? 0) + (t.type === 'deposit' ? t.amount : -t.amount))
    }
    return account.members
      .map(m => ({ id: m.id, name: m.id === me ? `You (${m.name})` : m.name, amount: net.get(m.id) ?? 0 }))
      .sort((a, b) => b.amount - a.amount)
  }, [account.members, allTransactions, me])

  return (
    <Card className="col-span-2 min-w-0 overflow-hidden sm:col-span-1">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-2 p-3 text-left sm:p-4"
      >
        <span className="min-w-0">
          <span className="block text-xs font-semibold text-muted">Everyone put in</span>
          <span className="mt-1 block text-base font-extrabold tracking-tight sm:text-lg"><Amount value={total} /></span>
        </span>
        <ChevronDown className={`mt-0.5 h-4 w-4 flex-shrink-0 text-muted transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto border-t border-line">
          {rows.map(r => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm sm:px-4">
              <span className="min-w-0 truncate">{r.name}</span>
              <span className="flex-shrink-0 font-semibold tabular-nums">{formatMoney(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Signed out: one tap to back everything up and use it on any phone. */
function SaveProgress() {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
          <CloudUpload className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="font-bold">Save your progress</h2>
          <p className="text-sm text-muted">Sign in to keep your savings safe and open them on any phone.</p>
        </div>
      </div>
      <GoogleButton className="mt-4" returnTo="/" />
    </Card>
  )
}

function Welcome() {
  const { accounts, account, viewRate: currentRate, actions, shared, isOwner } = useSavings()
  const { enabled, user } = useAuth()
  // A second (or later) account, or a shared one, is empty, not a first visit.
  const extra = accounts.length > 1 || shared
  const steps = [
    { icon: ArrowDownLeft, text: 'Add your deposits' },
    { icon: CalendarClock, text: `Earn ${currentRate.annualRate}% a year, daily` },
    { icon: ChartLine, text: 'Watch it grow' },
  ]
  const side = shared ? <MembersCard /> : (
    <>
      {enabled && !user && <SaveProgress />}
      <Example rate={currentRate} />
    </>
  )
  return (
    <>
      <PageHeader eyebrow={greeting()} title={extra ? account.name : 'Welcome to Yehulu'} />
      <div className="mb-3 empty:hidden md:mb-5"><InstallBanner /></div>
      <div className="grid items-start gap-3 md:gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3 md:space-y-5">
        <div className={HERO}>
          <HeroDecoration />
          <div className="relative">
            <p className="text-sm font-semibold text-[#04160c]/70">Balance</p>
            <p className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums">{formatMoney(0)}</p>
            <p className="mt-1 text-sm text-[#04160c]/75">
              {currentRate.annualRate}% a year, added daily
              {/* Everyone's Yehulu rate is different: make it easy to set yours first. */}
              {isOwner && (
                <> · <Link to="/settings/logic" className="font-semibold text-[#04160c] underline underline-offset-2">Change</Link></>
              )}
            </p>
            <button
              type="button"
              onClick={() => actions.openComposer('deposit')}
              className="mt-5 h-12 w-full rounded-xl bg-[#04160c] px-5 font-bold text-white transition hover:bg-black sm:w-auto"
            >
              Add your first deposit
            </button>
          </div>
        </div>
        {/* On a phone: sign in and the example come right after the balance. */}
        <div className="space-y-3 lg:hidden">{side}</div>
        <ol className="grid gap-3 sm:grid-cols-3 md:gap-4">
          {steps.map(({ icon: Icon, text }, i) => (
            <li key={text}>
              <Card className="flex h-full items-center gap-3 p-4">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-semibold"><span className="text-muted">{i + 1}.</span> {text}</span>
              </Card>
            </li>
          ))}
        </ol>
        </div>
        <div className="hidden space-y-5 lg:block">{side}</div>
      </div>
    </>
  )
}

/** What 100,000 grows to at today's rate, so a new saver sees the point. */
function Example({ rate }) {
  const start = 100000
  const growth = effectiveAnnualRate(toFraction(rate))
  const rows = [[1, '1 year'], [2, '2 years'], [5, '5 years']]
  return (
    <Card className="p-4 sm:p-5">
      <h2 className="font-bold">If you save Br 100,000</h2>
      <p className="text-sm text-muted">At {rate.annualRate}% a year, with nothing else added</p>
      <ul className="mt-3 divide-y divide-line">
        {rows.map(([years, label]) => (
          <li key={years} className="flex items-baseline justify-between gap-3 py-2 text-sm">
            <span className="text-muted">In {label}</span>
            <span className="font-bold tabular-nums text-brand-ink">{formatMoney(start * (1 + growth) ** years)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * A shared account where you haven't put money in yet: your balance is zero,
 * but the account isn't empty, so show what the others have saved.
 */
function SharedStart() {
  const { account, allTransactions, actions, viewMember, isOwner } = useSavings()
  const recent = [...allTransactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)
  const who = viewMember?.name
  return (
    <>
      <PageHeader eyebrow={greeting()} title={account.name} action={<ScopeSwitch />} />
      <div className="grid items-start gap-3 md:gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3 md:space-y-5">
          <div className={HERO}>
            <HeroDecoration />
            <div className="relative">
              <p className="text-sm font-semibold text-[#04160c]/70">{who ? `${who}'s balance` : 'Your balance'}</p>
              <p className="mt-1 text-4xl font-extrabold tracking-tight">{formatMoney(0)}</p>
              <p className="mt-2 max-w-md text-sm text-[#04160c]/75">
                {who
                  ? `${who} has no money in ${account.name} yet.`
                  : `You haven't added your own money to ${account.name} yet. Each member earns interest on their own deposits.`}
              </p>
              {(!who || isOwner) && (
              <button
                type="button"
                onClick={() => actions.openComposer('deposit')}
                className="mt-5 h-12 w-full rounded-xl bg-[#04160c] px-5 font-bold text-white transition hover:bg-black sm:w-auto"
              >
                {who ? `Add a deposit for ${who}` : 'Add your deposit'}
              </button>
              )}
            </div>
          </div>
          <MembersCard />
        </div>
        {recent.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader title="Recent activity" action={<ButtonLink to="/activity" variant="link">See all</ButtonLink>} className="pb-2" />
            <ul className="divide-y divide-line">
              {recent.map(txn => <TransactionRow key={txn.id} txn={txn} />)}
            </ul>
          </Card>
        )}
      </div>
    </>
  )
}

export default function HomePage() {
  usePageTitle('Home')
  const { account, transactions, viewTransactions, rates, today, shared, scope, viewMember } = useSavings()
  const ledger = useLedger(30)
  const overdraft = useMemo(() => findOverdraft(transactions, rates), [transactions, rates])
  const summary = useMemo(() => summarize(ledger, today), [ledger, today])
  const recent = useMemo(
    () => [...viewTransactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    [viewTransactions],
  )
  const everyone = scope === 'all'
  // null: closed; 'all': every month; 'YYYY-MM': that month day by day.
  const [interestView, setInterestView] = useState(null)

  if (viewTransactions.length === 0) return shared ? <SharedStart /> : <Welcome />

  return (
    <>
      <PageHeader eyebrow={greeting()} title={account.name} action={<ScopeSwitch />} />
      <div className="mb-3 empty:hidden md:mb-5"><InstallBanner /></div>
      {!viewMember && overdraft && <OverdraftBanner date={overdraft} today={today} />}

      <div className="grid items-start gap-3 md:gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3 md:space-y-5">
          <BalanceCard summary={summary} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4">
            <Stat label="Interest earned" value={summary.interestToDate} tone="text-brand-ink" onClick={() => setInterestView('all')} />
            <Stat label="This month" value={summary.interestThisMonth} tone="text-brand-ink" onClick={() => setInterestView(today.slice(0, 7))} />
            {everyone
              ? <PutInByMember total={summary.netSaved} />
              : <Stat label={viewMember ? `${viewMember.name} put in` : 'You put in'} value={summary.netSaved} className="col-span-2 sm:col-span-1" />}
          </div>

          <Card>
            <CardHeader
              title="Balance"
              subtitle={`Since ${formatDate(ledger[0].date)}, and the next 30 days`}
              action={<ButtonLink to="/growth" variant="link">More on Growth</ButtonLink>}
            />
            <div className="px-2 pt-3 sm:px-3">
              <LazyBalanceChart className="h-44 sm:h-56" ledger={ledger} today={today} compact />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 pt-2 sm:px-5">
              <ChartLegend />
              <span className="text-xs text-muted">
                In 30 days: <span className="font-bold text-ink">{formatMoney(summary.projectedBalance)}</span>
              </span>
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-3 md:space-y-5">
          {shared && <MembersCard />}
          {/* Your goal is about your own money. */}
          {!everyone && <GoalCard balance={summary.balance} />}
          <Card className="overflow-hidden">
            <CardHeader
              title="Recent activity"
              action={<ButtonLink to="/activity" variant="link">See all</ButtonLink>}
              className="pb-2"
            />
            <ul className="divide-y divide-line">
              {recent.map(txn => <TransactionRow key={txn.id} txn={txn} />)}
            </ul>
          </Card>
        </div>
      </div>
      <MonthlyInterestSheet
        open={interestView !== null}
        month={interestView === 'all' ? null : interestView}
        onClose={() => setInterestView(null)}
        ledger={ledger}
      />
    </>
  )
}
