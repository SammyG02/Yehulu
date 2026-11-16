import { lazy, Suspense } from 'react'

// Recharts is the heaviest dependency, so it loads after first paint.
const BalanceChart = lazy(() => import('./BalanceChart.jsx'))

export function LazyBalanceChart({ className = 'h-56', ...props }) {
  return (
    <div className={className}>
      <Suspense fallback={<div className="h-full w-full animate-pulse rounded-xl bg-sunken" />}>
        <BalanceChart {...props} />
      </Suspense>
    </div>
  )
}

export function ChartLegend() {
  return (
    <div className="flex items-center gap-4 text-xs font-medium text-muted">
      <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-brand" />So far</span>
      <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink" />Projected</span>
    </div>
  )
}
