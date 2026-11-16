import { useMemo, useState } from 'react'
import { ChartLine } from 'lucide-react'
import { PageHeader } from '../components/layout/AppShell.jsx'
import { ChartLegend, LazyBalanceChart } from '../components/charts/LazyBalanceChart.jsx'
import { DailyBreakdown } from '../components/DailyBreakdown.jsx'
import { GoalPlanner } from '../components/GoalPlanner.jsx'
import { Amount } from '../components/ui/Amount.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Card } from '../components/ui/Card.jsx'
import { Segmented } from '../components/ui/Segmented.jsx'
import { usePageTitle } from '../hooks/usePageTitle.js'
import { formatDate, formatMoney, formatPercent } from '../lib/format.js'
import { effectiveAnnualRate, summarize } from '../lib/interest.js'
import { useLedger, useSavings } from '../state/hooks.js'

const HORIZONS = [
  { value: 30, label: '1M', long: '30 days' },
  { value: 90, label: '3M', long: '3 months' },
  { value: 180, label: '6M', long: '6 months' },
  { value: 365, label: '1Y', long: '1 year' },
  { value: 730, label: '2Y', long: '2 years' },
]

export default function GrowthPage() {
  usePageTitle('Growth')
  const { transactions, today, rates, actions } = useSavings()
  const [horizon, setHorizon] = useState(90)
  const ledger = useLedger(horizon)
  const summary = useMemo(() => summarize(ledger, today), [ledger, today])
  const { long } = HORIZONS.find(h => h.value === horizon)
  const hasTransactions = transactions.length > 0

  return (
    <>
      <PageHeader title="Growth" subtitle="Where your balance is heading, and when you'll hit your goal." />

      {hasTransactions ? (
        <Card className="mb-3 md:mb-5">
          <div className="flex flex-col gap-3 p-4 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-muted">Balance in {long}</p>
              <p className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
                <Amount value={summary.projectedBalance} />
              </p>
              <p className="mt-1 text-sm">
                <span className="font-bold text-brand-ink">+{formatMoney(summary.projectedInterest)} interest</span>
                <span className="text-muted"> by {formatDate(ledger[ledger.length - 1].date)}</span>
              </p>
            </div>
            <Segmented options={HORIZONS} value={horizon} onChange={setHorizon} label="Projection length" />
          </div>
          <div className="px-2 sm:px-3">
            <LazyBalanceChart className="h-56 md:h-72" ledger={ledger} today={today} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 pt-2 sm:px-5">
            <ChartLegend />
            <span className="text-xs text-muted">
              Grows {formatPercent(effectiveAnnualRate(rates))} a year, assuming no other transactions
            </span>
          </div>
        </Card>
      ) : (
        <Card className="mb-4 flex flex-col items-center px-6 py-10 text-center md:mb-6">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sunken text-muted">
            <ChartLine className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-bold">No projection yet</h2>
          <p className="mt-1 max-w-sm text-sm text-muted">
            Add a deposit to see your balance grow. You can still try the goal planner below with a monthly top-up.
          </p>
          <Button className="mt-5" onClick={() => actions.openComposer()}>Add a deposit</Button>
        </Card>
      )}

      <div className="grid items-start gap-3 md:gap-5 lg:grid-cols-2">
        <GoalPlanner />
        {hasTransactions && <DailyBreakdown ledger={ledger} today={today} />}
      </div>
    </>
  )
}
