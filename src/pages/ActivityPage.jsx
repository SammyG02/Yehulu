import { useMemo, useState } from 'react'
import { Plus, ReceiptText } from 'lucide-react'
import { PageHeader } from '../components/layout/AppShell.jsx'
import { ScopeSwitch } from '../components/accounts/ScopeSwitch.jsx'
import { TransactionRow } from '../components/transactions/TransactionRow.jsx'
import { Amount } from '../components/ui/Amount.jsx'
import { Button } from '../components/ui/Button.jsx'
import { Card } from '../components/ui/Card.jsx'
import { Segmented } from '../components/ui/Segmented.jsx'
import { usePageTitle } from '../hooks/usePageTitle.js'
import { formatDate, formatSigned, plain } from '../lib/format.js'
import { InfoBubble } from '../components/ui/InfoBubble.jsx'

import { feeOf } from '../lib/interest.js'
import { useLedger, useSavings } from '../state/hooks.js'

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'in', label: 'Money in' },
  { value: 'out', label: 'Money out' },
  { value: 'scheduled', label: 'Scheduled' },
]

const matches = (filter, txn, today) => {
  if (filter === 'in') return txn.type === 'deposit'
  if (filter === 'out') return txn.type === 'withdrawal'
  if (filter === 'scheduled') return txn.date > today
  return true
}

export default function ActivityPage() {
  usePageTitle('Activity')
  // Follows the View menu: everyone's (as far as you may see), yours, or one member's.
  const { viewTransactions: transactions, today, actions } = useSavings()
  const [filter, setFilter] = useState('all')
  // The daily charge worked out for each month so far (it isn't a transaction).
  const ledger = useLedger(1)
  const charges = useMemo(() => {
    const byMonth = new Map()
    for (const r of ledger) if (r.charges > 0 && r.date <= today) byMonth.set(r.date.slice(0, 7), (byMonth.get(r.date.slice(0, 7)) ?? 0) + r.charges)
    return byMonth
  }, [ledger, today])

  const { months, totalIn, totalOut } = useMemo(() => {
    const list = transactions
      .filter(t => matches(filter, t, today))
      .sort((a, b) => b.date.localeCompare(a.date))
    const groups = new Map()
    let inSum = 0
    let outSum = 0
    for (const txn of list) {
      const key = txn.date.slice(0, 7)
      if (!groups.has(key)) groups.set(key, { key, items: [], net: 0, in: 0, out: 0, fees: 0 })
      const group = groups.get(key)
      group.items.push(txn)
      // Money out includes each withdrawal's 0.2% fee.
      const out = txn.type === 'deposit' ? 0 : txn.amount + feeOf(txn)
      group.net += txn.type === 'deposit' ? txn.amount : -out
      if (txn.type === 'deposit') group.in += txn.amount
      else { group.out += out; group.fees += out - txn.amount }
      if (txn.type === 'deposit') inSum += txn.amount
      else outSum += out
    }
    if (filter === 'all' || filter === 'out') {
      for (const [key, sum] of charges) {
        const group = groups.get(key) ?? { key, items: [], net: 0, in: 0, out: 0, fees: 0 }
        groups.set(key, { ...group, charge: sum, net: group.net - sum, out: group.out + sum })
        outSum += sum
      }
    }
    return { months: [...groups.values()].sort((a, b) => b.key.localeCompare(a.key)), totalIn: inSum, totalOut: outSum }
  }, [transactions, filter, today, charges])

  const addButton = (
    <Button className="hidden md:inline-flex" onClick={() => actions.openComposer()}>
      <Plus className="h-4 w-4" aria-hidden="true" /> Add
    </Button>
  )

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Activity"
        subtitle={`${transactions.length} transaction${transactions.length === 1 ? '' : 's'} · tap one to edit`}
        action={<div className="flex items-center gap-2"><ScopeSwitch />{addButton}</div>}
      />

      {transactions.length === 0 ? (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sunken text-muted">
            <ReceiptText className="h-7 w-7" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-bold">No transactions yet</h2>
          <p className="mt-1 text-sm text-muted">Deposits and withdrawals you add will show up here.</p>
          <Button className="mt-5" onClick={() => actions.openComposer()}>Add a deposit</Button>
        </Card>
      ) : (
        <>
          <div className="no-scrollbar -mx-4 mb-4 overflow-x-auto px-4">
            <Segmented options={FILTERS} value={filter} onChange={setFilter} label="Filter transactions" />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <Card className="p-3 sm:p-4">
              <p className="text-xs font-semibold text-muted">Money in</p>
              <p className="mt-1 text-base font-extrabold text-brand-ink sm:text-lg"><Amount value={totalIn} sign="+" /></p>
            </Card>
            <Card className="p-3 sm:p-4">
              <p className="text-xs font-semibold text-muted">Money out</p>
              <p className="mt-1 text-base font-extrabold text-neg sm:text-lg"><Amount value={totalOut} sign="−" /></p>
            </Card>
          </div>

          {months.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Nothing matches this filter.</p>
          ) : (
            <div className="space-y-5">
              {months.map(month => (
                <section key={month.key} aria-labelledby={`month-${month.key}`}>
                  <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 flex items-baseline justify-between bg-canvas/90 px-5 py-2 backdrop-blur md:top-16 md:mx-0 md:px-1">
                    <h2 id={`month-${month.key}`} className="text-sm font-bold">
                      {formatDate(`${month.key}-01`, { month: 'long', year: 'numeric' })}
                    </h2>
                    <InfoBubble
                      label={formatSigned(Math.abs(month.net), month.net >= 0 ? 'deposit' : 'withdrawal')}
                      tone="muted"
                      className="text-xs font-semibold"
                      ariaLabel={`${formatDate(`${month.key}-01`, { month: 'long' })}: in ${plain(month.in)}, out ${plain(month.out)}`}
                      rows={[
                        ['Money in', plain(month.in)],
                        [month.fees > 0 ? `Money out (incl. ${plain(month.fees)} fees)` : 'Money out', month.out ? `−${plain(month.out)}` : plain(0)],
                        ['This month', `${month.net >= 0 ? '+' : '−'}${plain(Math.abs(month.net))}`, { tone: month.net >= 0 ? 'brand' : 'neg' }],
                      ]}
                      width="w-64"
                    />
                  </div>
                  <Card as="div" className="overflow-hidden">
                    <ul className="divide-y divide-line">
                      {month.charge > 0 && (
                        <li className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                          <span>
                            <span className="block font-semibold">Daily charge</span>
                            <span className="block text-xs text-muted">Expected, until the next statement</span>
                          </span>
                          <span className="font-bold tabular-nums text-neg"><Amount value={month.charge} sign="−" /></span>
                        </li>
                      )}
                      {month.items.map(txn => <TransactionRow key={txn.id} txn={txn} showYear={false} />)}
                    </ul>
                  </Card>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
