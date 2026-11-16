import { useMemo } from 'react'
import { Link } from 'react-router'
import { ArrowDownLeft, ArrowUpRight, CalendarClock, ChartLine, PiggyBank, TriangleAlert } from 'lucide-react'
import { PageHeader } from '../components/layout/AppShell.jsx'
import { ChartLegend, LazyBalanceChart } from '../components/charts/LazyBalanceChart.jsx'
import { GoalCard } from '../components/GoalPlanner.jsx'
import { TransactionRow } from '../components/transactions/TransactionRow.jsx'
import { Amount } from '../components/ui/Amount.jsx'
import { ButtonLink } from '../components/ui/Button.jsx'
import { Card, CardHeader } from '../components/ui/Card.jsx'
import { usePageTitle } from '../hooks/usePageTitle.js'
import { formatDate, formatMoney, greeting } from '../lib/format.js'
import { findOverdraft, summarize } from '../lib/interest.js'
import { useLedger, useSavings } from '../state/hooks.js'

// Black card with brand-green accents, echoing the black wordmark and green mark.
const HERO = 'relative overflow-hidden rounded-3xl bg-[#0b0f0d] p-4 text-white shadow-float ring-1 ring-white/5 sm:p-6'

function HeroDecoration() {
  return (
    <div aria-hidden="true">
      <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border-[28px] border-brand/15" />
      <div className="absolute -bottom-28 -left-10 h-56 w-56 rounded-full bg-brand/20 blur-3xl" />
    </div>
  )
}

function BalanceCard({ summary }) {
  const { actions } = useSavings()
  return (
    <div className={HERO}>
      <HeroDecoration />
      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-white/60">Total balance</p>
          {/* Interest earned for today; it's added to the balance when the day ends. */}
          <span
            className="whitespace-nowrap rounded-full bg-brand/20 px-2.5 py-1 text-xs font-semibold text-[#4ade80]"
            title="Interest earned today. It's added to your balance at the end of the day."
          >
            +{formatMoney(summary.interestToday)} today
          </span>
        </div>
        <p className="mt-1 text-[clamp(1.875rem,9vw,3rem)] font-extrabold leading-tight tracking-tight">
          <Amount value={summary.balance} />
        </p>
        {summary.depositedToday > 0 && (
          <p className="mt-1 text-xs text-white/55">Today's deposits start earning tomorrow.</p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => actions.openComposer('deposit')}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand font-bold text-on-brand transition hover:bg-brand-strong active:scale-[0.98]"
          >
            <ArrowDownLeft className="h-5 w-5" aria-hidden="true" /> Deposit
          </button>
          <button
            type="button"
            onClick={() => actions.openComposer('withdrawal')}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white/10 font-bold text-white transition hover:bg-white/15 active:scale-[0.98]"
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

function Stat({ label, value, tone = '', className = '' }) {
  return (
    <Card className={`min-w-0 p-3 sm:p-4 ${className}`}>
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-base font-extrabold tracking-tight sm:text-lg ${tone}`}>
        <Amount value={value} />
      </p>
    </Card>
  )
}

function Welcome() {
  const { currentRate, actions } = useSavings()
  const steps = [
    { icon: ArrowDownLeft, title: 'Add your deposits', text: 'Past ones too. Yehulu works out the interest you\'ve already earned.' },
    { icon: CalendarClock, title: 'Interest every day', text: `${currentRate.annualRate}% a year minus a ${currentRate.serviceCharge}% charge, added daily so it compounds.` },
    { icon: ChartLine, title: 'See where it goes', text: 'Projections and a goal planner show when you\'ll reach your target.' },
  ]
  return (
    <>
      <PageHeader eyebrow={greeting()} title="Welcome to Yehulu" />
      <div className="grid gap-3 md:gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className={HERO}>
          <HeroDecoration />
          <div className="relative max-w-md">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand text-on-brand">
              <PiggyBank className="h-6 w-6" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-2xl font-extrabold tracking-tight sm:text-3xl">Watch your savings grow, day by day.</h2>
            <p className="mt-2 text-sm text-white/65">
              Add the money you've saved and see your balance, daily interest and where it's heading.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => actions.openComposer('deposit')}
                className="h-12 rounded-xl bg-brand px-5 font-bold text-on-brand transition hover:bg-brand-strong"
              >
                Add your first deposit
              </button>
              <ButtonLink to="/settings/logic" variant="ghost" size="lg" className="bg-white/10 text-white hover:bg-white/20">
                Set interest rate ({currentRate.annualRate}%)
              </ButtonLink>
            </div>
          </div>
        </div>
        <Card className="p-4 sm:p-5">
          <h2 className="font-bold">How it works</h2>
          <ol className="mt-4 space-y-4">
            {steps.map(({ icon: Icon, title, text }, i) => (
              <li key={title} className="flex gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-bold">{i + 1}. {title}</span>
                  <span className="block text-sm text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  )
}

export default function HomePage() {
  usePageTitle('Home')
  const { account, transactions, rates, today } = useSavings()
  const ledger = useLedger(30)
  const overdraft = useMemo(() => findOverdraft(transactions, rates), [transactions, rates])
  const summary = useMemo(() => summarize(ledger, today), [ledger, today])
  const recent = useMemo(
    () => [...transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    [transactions],
  )

  if (transactions.length === 0) return <Welcome />

  return (
    <>
      <PageHeader eyebrow={greeting()} title={account.name} />
      {overdraft && <OverdraftBanner date={overdraft} today={today} />}

      <div className="grid items-start gap-3 md:gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3 md:space-y-5">
          <BalanceCard summary={summary} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4">
            <Stat label="Interest earned" value={summary.interestToDate} tone="text-brand-ink" />
            <Stat label="This month" value={summary.interestThisMonth} tone="text-brand-ink" />
            <Stat label="You put in" value={summary.netSaved} className="col-span-2 sm:col-span-1" />
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
          <GoalCard balance={summary.balance} />
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
    </>
  )
}
