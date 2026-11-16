import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router'
import { Target } from 'lucide-react'
import { formatDate, formatDuration, formatMoney } from '../lib/format.js'
import { sanitizeGoal } from '../lib/storage.js'
import { useGoalPlan } from '../hooks/useGoalPlan.js'
import { useSavings } from '../state/hooks.js'
import { Card, CardHeader } from './ui/Card.jsx'
import { Field, MoneyInput } from './ui/Field.jsx'

const LONG_DATE = { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }

function PlanResult({ goal, result }) {
  if (!result) {
    return <p className="text-sm text-muted">Enter a target balance to see when you'll reach it.</p>
  }
  const { plan, without } = result
  if (!plan) {
    return (
      <p className="text-sm">
        <span className="font-semibold">Not within 30 years</span> at this rate.
        {!goal.monthly && <span className="text-muted"> Try adding a monthly top-up.</span>}
      </p>
    )
  }
  if (plan.days === 0) {
    return <p className="text-sm"><span className="font-semibold text-brand-ink">Already reached.</span> Time for a bigger goal.</p>
  }
  return (
    <div>
      <p className="text-sm text-muted">You'll reach {formatMoney(goal.target)} on</p>
      <p className="mt-0.5 text-xl font-extrabold tracking-tight sm:text-2xl">{formatDate(plan.date, LONG_DATE)}</p>
      <p className="text-sm font-semibold text-brand-ink">in {formatDuration(plan.days)}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted">From interest</dt>
          <dd className="font-bold tabular-nums">{formatMoney(plan.interest)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">New money in</dt>
          <dd className="font-bold tabular-nums">{formatMoney(plan.deposits)}</dd>
        </div>
      </dl>
      {goal.monthly > 0 && (
        <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
          {without
            ? <>Top-ups get you there <span className="font-semibold text-ink">{formatDuration(without.days - plan.days)} sooner</span> than interest alone.</>
            : 'Without top-ups you would not get there within 30 years.'}
        </p>
      )}
    </div>
  )
}

/** Full planner (Growth page). The goal is saved with the rest of the data. */
export function GoalPlanner() {
  const { goal, actions } = useSavings()
  const [target, setTarget] = useState(goal.target ? String(goal.target) : '')
  const [monthly, setMonthly] = useState(goal.monthly ? String(goal.monthly) : '')

  const update = (nextTarget, nextMonthly) => {
    setTarget(nextTarget)
    setMonthly(nextMonthly)
    actions.updateGoal(sanitizeGoal({ target: nextTarget, monthly: nextMonthly }))
  }

  // Planning simulates up to 30 years day by day; let typing stay responsive.
  const deferredGoal = useDeferredValue(goal)
  const result = useGoalPlan(deferredGoal)

  return (
    <Card id="goal" className="scroll-mt-24">
      <CardHeader title="Savings goal" subtitle="Find out when you'll reach a target balance." />
      <div className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="goal-target" label="Target balance">
            <MoneyInput id="goal-target" value={target} onChange={(e) => update(e.target.value, monthly)} />
          </Field>
          <Field id="goal-monthly" label="Monthly top-up" optional>
            <MoneyInput id="goal-monthly" value={monthly} onChange={(e) => update(target, e.target.value)} />
          </Field>
        </div>
        <div className="rounded-2xl bg-sunken p-4">
          <PlanResult goal={deferredGoal} result={result} />
        </div>
      </div>
    </Card>
  )
}

/** Compact goal progress for the Home page. */
export function GoalCard({ balance }) {
  const { goal } = useSavings()
  const result = useGoalPlan(goal)

  if (!goal.target) {
    return (
      <Link to="/growth#goal" className="group flex items-center gap-4 rounded-2xl border border-dashed border-line bg-surface p-4 transition hover:border-brand sm:p-5">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Target className="h-5 w-5" aria-hidden="true" />
        </span>
        <span>
          <span className="block font-bold">Set a savings goal</span>
          <span className="block text-sm text-muted">See exactly when you'll get there.</span>
        </span>
      </Link>
    )
  }

  const progress = Math.max(0, Math.min(1, balance / goal.target))
  const plan = result?.plan
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">Goal</p>
          <p className="text-lg font-extrabold tabular-nums">{formatMoney(goal.target)}</p>
        </div>
        <Link to="/growth#goal" className="text-sm font-semibold text-brand-ink hover:text-brand-ink">Edit</Link>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label="Goal progress">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="mt-2 flex justify-between gap-3 text-xs text-muted">
        <span className="font-semibold text-ink">{Math.floor(progress * 100)}%</span>
        <span>
          {progress >= 1
            ? 'Reached!'
            : plan
              ? `On track for ${formatDate(plan.date, { day: 'numeric', month: 'short', year: 'numeric' })}`
              : 'Not within 30 years'}
        </span>
      </div>
    </Card>
  )
}
