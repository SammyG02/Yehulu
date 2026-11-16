import React, { useState, useEffect, useMemo } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { TrendingUp, Wallet, History, Plus, Calendar, ArrowUpRight, ArrowDownRight, BarChart3, Clock } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { EFFECTIVE_ANNUAL_RATE, simulateLedger, toDateKey, parseDateKey, addDays } from './lib/interest'

const STORAGE_KEY = 'yehuluSavings'

const formatMoney = (value, decimals = 2) =>
  value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

// Read once, synchronously, on first render. Loading in an effect let the save
// effect overwrite stored data with empty state under React StrictMode.
const loadSavedState = () => {
  const today = toDateKey(new Date())
  let saved = {}
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    saved = {}
  }
  const transactions = Array.isArray(saved.transactions) ? saved.transactions : []
  // Older saves had no start date for the starting balance: assume it was there
  // from the first transaction (or today if there are none).
  const earliestTxn = transactions.map(t => t.date).sort()[0]
  return {
    initialBalance: saved.initialBalance ?? 0,
    startDate: saved.startDate ?? earliestTxn ?? today,
    transactions,
  }
}

function App() {
  const [saved] = useState(loadSavedState)
  const [initialBalance, setInitialBalance] = useState(saved.initialBalance)
  const [startDate, setStartDate] = useState(saved.startDate)
  const [transactions, setTransactions] = useState(saved.transactions)
  const [daysToProject, setDaysToProject] = useState(30)

  const today = toDateKey(new Date())

  const [txnAmount, setTxnAmount] = useState('')
  const [txnType, setTxnType] = useState('deposit')
  const [txnDate, setTxnDate] = useState(today)
  const [txnDescription, setTxnDescription] = useState('')

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ initialBalance, startDate, transactions }))
  }, [initialBalance, startDate, transactions])

  // One continuous day-by-day ledger: past days give today's balance, and the
  // next `daysToProject` days (today included) are the projection.
  const ledger = useMemo(() => simulateLedger({
    startingBalance: Number(initialBalance) || 0,
    startDate,
    transactions,
    fromDate: today,
    endDate: addDays(today, daysToProject - 1),
  }), [initialBalance, startDate, transactions, today, daysToProject])

  const projectionData = useMemo(() => ledger.filter(row => row.date >= today), [ledger, today])

  const handleTransaction = (e) => {
    e.preventDefault()
    if (!txnAmount || parseFloat(txnAmount) <= 0) return

    const newTransaction = {
      id: Date.now(),
      type: txnType,
      amount: parseFloat(txnAmount),
      date: txnDate,
      description: txnDescription || (txnType === 'deposit' ? 'Deposit' : 'Withdrawal')
    }

    setTransactions([...transactions, newTransaction])
    setTxnAmount('')
    setTxnDescription('')
  }

  const deleteTransaction = (id) => {
    setTransactions(transactions.filter(t => t.id !== id))
  }

  // Today's balance includes today's transactions; today's interest is credited at day end.
  const todayRow = projectionData[0]
  const currentBalance = todayRow.balanceBeforeInterest
  const currentDailyInterest = todayRow.dailyInterest
  const totalInterestEarned = projectionData.reduce((acc, row) => acc + row.dailyInterest, 0)
  const finalProjectedBalance = projectionData[projectionData.length - 1].balance

  return (
    <div className="flex h-screen w-full bg-slate-900 text-slate-200 overflow-hidden font-sans">

      {/* SIDEBAR PANEL */}
      <div className="w-[420px] bg-slate-800 border-r border-slate-700 h-full flex flex-col shadow-2xl relative z-20 flex-shrink-0">

        {/* Header */}
        <div className="p-8 border-b border-slate-700 bg-slate-800/50">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Yehulu <span className="text-blue-400">Digital</span></h1>
          </div>
          <p className="text-slate-400 text-sm">40% p.a. • 10% fee on interest • compounds daily ≈ {(EFFECTIVE_ANNUAL_RATE * 100).toFixed(1)}%/yr</p>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">

          {/* Initial Balance */}
          <div>
            <h2 className="text-sm uppercase tracking-wider font-bold text-slate-500 mb-3 flex items-center gap-2">
              <Wallet className="w-4 h-4" /> Root Capital
            </h2>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <span className="text-slate-400 font-semibold">Br</span>
              </div>
              <input
                type="number"
                value={initialBalance}
                onChange={(e) => setInitialBalance(e.target.value === '' ? '' : parseFloat(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 text-white rounded-xl pl-10 pr-4 py-4 text-xl font-bold focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all shadow-inner"
              />
            </div>
            <label className="block text-xs font-medium text-slate-400 mt-3 mb-1">Held since</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => e.target.value && setStartDate(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style={{ colorScheme: 'dark' }}
            />
          </div>

          {/* Projection Slider */}
          <div className="bg-slate-900/50 rounded-xl p-5 border border-slate-700/50">
            <div className="flex justify-between items-end mb-4">
              <h2 className="text-sm uppercase tracking-wider font-bold text-slate-500 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Horizon
              </h2>
              <span className="text-blue-400 font-bold text-lg">{daysToProject} Days</span>
            </div>
            <input
              type="range"
              min="1"
              max="365"
              value={daysToProject}
              onChange={(e) => setDaysToProject(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-2 font-medium">
              <span>1 Day</span>
              <span>1 Year</span>
            </div>
          </div>

          {/* Add Transaction */}
          <div>
            <h2 className="text-sm uppercase tracking-wider font-bold text-slate-500 mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4" /> New Transaction
            </h2>
            <form onSubmit={handleTransaction} className="bg-slate-900/30 p-5 rounded-xl border border-slate-700/50 space-y-4">

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
                    <button
                      type="button"
                      onClick={() => setTxnType('deposit')}
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${txnType === 'deposit' ? 'bg-green-500/20 text-green-400 shadow-sm' : 'text-slate-400 hover:text-white'}`}
                    >
                      Deposit
                    </button>
                    <button
                      type="button"
                      onClick={() => setTxnType('withdrawal')}
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${txnType === 'withdrawal' ? 'bg-red-500/20 text-red-400 shadow-sm' : 'text-slate-400 hover:text-white'}`}
                    >
                      Withdraw
                    </button>
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1">Amount (Birr)</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="text-slate-500 font-medium">Br</span>
                    </div>
                    <input
                      type="number"
                      value={txnAmount}
                      onChange={(e) => setTxnAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg pl-10 pr-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required
                    />
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1">Execution Date</label>
                  <input
                    type="date"
                    value={txnDate}
                    onChange={(e) => setTxnDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent color-scheme-dark"
                    required
                    style={{ colorScheme: 'dark' }}
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-400 mb-1">Memo (Optional)</label>
                  <input
                    type="text"
                    value={txnDescription}
                    onChange={(e) => setTxnDescription(e.target.value)}
                    placeholder="e.g. Salary, Rent"
                    className="w-full bg-slate-800 border border-slate-700 text-white rounded-lg px-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <button
                type="submit"
                className={`w-full py-3 px-4 rounded-lg font-bold text-white transition-all transform active:scale-[0.98] ${txnType === 'deposit'
                  ? 'bg-green-600 hover:bg-green-500 shadow-[0_0_15px_rgba(22,163,74,0.4)]'
                  : 'bg-red-600 hover:bg-red-500 shadow-[0_0_15px_rgba(220,38,38,0.4)]'
                  }`}
              >
                Execute {txnType === 'deposit' ? 'Deposit' : 'Withdrawal'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* MAIN WORKSPACE */}
      <div className="flex-1 h-full overflow-y-auto bg-slate-900 p-8 custom-scrollbar relative">

        {/* KPI Cards Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Current Balance */}
          <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 relative overflow-hidden group">
            <div className="absolute w-32 h-32 bg-blue-500/10 rounded-full blur-2xl -top-10 -right-10 group-hover:bg-blue-500/20 transition-all"></div>
            <p className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-2">Available Balance</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl text-slate-300">Br</span>
              <span className="text-4xl font-black text-white tracking-tight">
                {formatMoney(currentBalance)}
              </span>
            </div>
          </div>

          {/* Daily Yield */}
          <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 relative overflow-hidden group">
            <div className="absolute w-32 h-32 bg-green-500/10 rounded-full blur-2xl -top-10 -right-10 group-hover:bg-green-500/20 transition-all"></div>
            <p className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-2">Today's Yield</p>
            <div className="flex items-baseline gap-1 text-green-400">
              <span className="text-2xl">+Br</span>
              <span className="text-4xl font-black tracking-tight">
                {formatMoney(currentDailyInterest)}
              </span>
            </div>
          </div>

          {/* Projected Target */}
          <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 relative overflow-hidden group">
            <div className="absolute w-32 h-32 bg-purple-500/10 rounded-full blur-2xl -top-10 -right-10 group-hover:bg-purple-500/20 transition-all"></div>
            <p className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-2">Target ({daysToProject}d)</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl text-slate-300">Br</span>
              <span className="text-4xl font-black text-white tracking-tight">
                {formatMoney(finalProjectedBalance)}
              </span>
            </div>
            <p className="text-sm font-medium text-purple-400 mt-2">
              + Br {formatMoney(totalInterestEarned)} earned
            </p>
          </div>
        </div>

        {/* Growth Chart */}
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700 mb-8 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              Wealth Trajectory
            </h2>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={projectionData} margin={{ top: 10, right: 10, left: 20, bottom: 0 }}>
                <defs>
                  <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickFormatter={(value) => parseDateKey(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  minTickGap={40}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fill: '#64748b' }}
                  tickFormatter={(value) => `Br ${(value / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}k`}
                  dx={-10}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  cursor={{ stroke: '#475569', strokeWidth: 1, strokeDasharray: '5 5' }}
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-xl shadow-2xl border border-slate-700">
                          <p className="text-sm font-semibold text-slate-400 mb-2 uppercase tracking-wide">{parseDateKey(label).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                          <p className="text-2xl font-bold text-white mb-1">
                            Br {formatMoney(payload[0].value)}
                          </p>
                          {payload[0].payload.dailyInterest > 0 && (
                            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700">
                              <span className="w-2 h-2 rounded-full bg-green-400"></span>
                              <p className="text-sm font-medium text-green-400">
                                +Br {formatMoney(payload[0].payload.dailyInterest)} yield
                              </p>
                            </div>
                          )}
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#3b82f6"
                  strokeWidth={4}
                  fillOpacity={1}
                  fill="url(#chartGlow)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Tables Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">

          {/* Daily Breakdown */}
          <div className="bg-slate-800 rounded-2xl shadow-lg border border-slate-700 flex flex-col h-[500px]">
            <div className="p-6 border-b border-slate-700 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-purple-400" />
              <h2 className="text-lg font-bold text-white">Ledger Projection</h2>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-slate-900/50 text-slate-400 sticky top-0 backdrop-blur-md">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Date</th>
                    <th className="px-6 py-4 font-semibold text-right">Start</th>
                    <th className="px-6 py-4 font-semibold text-right">Flow</th>
                    <th className="px-6 py-4 font-semibold text-right">Yield</th>
                    <th className="px-6 py-4 font-semibold text-right">End</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {projectionData.map((data, idx) => {
                    const flow = data.deposits - data.withdrawals;
                    return (
                      <tr key={idx} className="hover:bg-slate-700/30 transition-colors">
                        <td className="px-6 py-4 text-slate-300 whitespace-nowrap">
                          {parseDateKey(data.date).toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}
                        </td>
                        <td className="px-6 py-4 text-slate-400 text-right">
                          {formatMoney(data.opening, 0)}
                        </td>
                        <td className={`px-6 py-4 text-right font-medium ${flow > 0 ? 'text-green-400' : flow < 0 ? 'text-red-400' : 'text-slate-600'}`}>
                          {flow > 0 ? '+' : ''}{flow !== 0 ? flow.toLocaleString('en-US') : '-'}
                        </td>
                        <td className="px-6 py-4 text-blue-400 text-right font-medium">
                          +{formatMoney(data.dailyInterest, 0)}
                        </td>
                        <td className="px-6 py-4 text-white font-bold text-right">
                          {formatMoney(data.balance, 0)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Transaction History */}
          <div className="bg-slate-800 rounded-2xl shadow-lg border border-slate-700 flex flex-col h-[500px]">
            <div className="p-6 border-b border-slate-700 flex items-center gap-2">
              <History className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg font-bold text-white">Transaction Log</h2>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar">
              {transactions.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 p-8 text-center">
                  <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center mb-4">
                    <History className="w-8 h-8 text-slate-700" />
                  </div>
                  <p>No transactions executed yet.</p>
                  <p className="text-sm mt-1">Use the sidebar form to add deposits or withdrawals.</p>
                </div>
              ) : (
                <table className="w-full text-sm text-left">
                  <thead className="text-xs uppercase bg-slate-900/50 text-slate-400 sticky top-0 backdrop-blur-md">
                    <tr>
                      <th className="px-6 py-4 font-semibold">Date</th>
                      <th className="px-6 py-4 font-semibold">Type</th>
                      <th className="px-6 py-4 font-semibold text-right">Amount</th>
                      <th className="px-6 py-4 font-semibold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {[...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).map((txn) => (
                      <tr key={txn.id} className="hover:bg-slate-700/30 transition-colors">
                        <td className="px-6 py-4 text-slate-300 whitespace-nowrap">
                          {parseDateKey(txn.date).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold ${txn.type === 'deposit' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                            }`}>
                            {txn.type === 'deposit' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            {txn.type.toUpperCase()}
                          </span>
                        </td>
                        <td className={`px-6 py-4 text-right font-bold ${txn.type === 'deposit' ? 'text-green-400' : 'text-red-400'
                          }`}>
                          {txn.type === 'deposit' ? '+' : '-'}Br {txn.amount.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={() => deleteTransaction(txn.id)}
                            className="text-slate-500 hover:text-red-400 transition-colors bg-slate-900/50 hover:bg-slate-900 px-3 py-1.5 rounded-md text-xs font-semibold"
                          >
                            VOID
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Scrollbar CSS */}
      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #334155;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #475569;
        }
      `}} />
      <Analytics />
    </div>
  )

}

export default App
