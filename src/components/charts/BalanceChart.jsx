import { useId, useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCompact, formatDate, formatMoney } from '../../lib/format.js'
import { useThemeColors } from '../../state/hooks.js'

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-float">
      <p className="text-xs font-medium text-muted">
        {formatDate(row.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        {row.actual == null && ' · projected'}
      </p>
      <p className="mt-0.5 text-base font-bold tabular-nums">{formatMoney(row.balance)}</p>
      {row.interest > 0 && <p className="text-xs font-semibold text-brand-ink">+{formatMoney(row.interest)} interest</p>}
    </div>
  )
}

/**
 * End-of-day balance for the whole ledger, from the first transaction to the
 * end of the projection: a solid line up to today, then a dashed projection.
 */
export default function BalanceChart({ ledger, today, compact = false }) {
  const colors = useThemeColors()
  const gradientId = useId().replace(/:/g, '')

  const data = useMemo(() => ledger
    .map(row => ({
      date: row.date,
      balance: row.balance,
      interest: row.interest,
      actual: row.date <= today ? row.balance : null,
      projected: row.date >= today ? row.balance : null,
    })), [ledger, today])

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 4, left: compact ? 4 : 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`${gradientId}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.brand} stopOpacity={0.28} />
            <stop offset="100%" stopColor={colors.brand} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={`${gradientId}-p`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={colors.ink} stopOpacity={0.06} />
            <stop offset="100%" stopColor={colors.ink} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={colors.line} strokeDasharray="4 4" />
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: colors.muted }}
          tickFormatter={(key) => formatDate(key, { day: 'numeric', month: 'short' })}
          minTickGap={compact ? 48 : 32}
          dy={6}
        />
        <YAxis
          hide={compact}
          axisLine={false}
          tickLine={false}
          tick={{ fontSize: 11, fill: colors.muted }}
          tickFormatter={formatCompact}
          width={44}
          domain={['auto', 'auto']}
        />
        <ReferenceLine
          x={today}
          stroke={colors.muted}
          strokeDasharray="2 4"
          label={{ value: 'Today', position: 'insideTopLeft', fill: colors.muted, fontSize: 11, fontWeight: 600 }}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: colors.muted, strokeDasharray: '3 3' }} />
        <Area type="monotone" dataKey="actual" stroke={colors.brand} strokeWidth={2.5} fill={`url(#${gradientId}-a)`} isAnimationActive={false} />
        <Area type="monotone" dataKey="projected" stroke={colors.ink} strokeWidth={2} strokeDasharray="6 5" fill={`url(#${gradientId}-p)`} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
