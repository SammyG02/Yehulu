import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dailyRate, findNewOverdraft, findOverdraft, periodOn, planGoal, simulateLedger, summarize } from './interest.js'
import { addDays } from './dates.js'
import { exportState, migrate as migrateAll, parseBackup, sanitizeRates, toRates } from './storage.js'

// These tests cover one account's data. Since v4 a save holds several accounts;
// `migrate` here returns the open one in the pre-v4 shape so the checks read the
// same. The multi-account wrapper itself is tested in accounts.test.js.
const only = (state) => {
  const a = state.accounts.find(x => x.id === state.activeId)
  return { version: state.version, account: { name: a.name, rates: a.rates }, goal: a.goal, transactions: a.transactions }
}
const migrate = (raw, today) => only(migrateAll(raw, today))

// S1-2: rate history. Numbered as in QA's S1-2 test plan. A period's `from`
// date is inclusive: interest credited that day uses the new rate.

const TODAY = '2026-11-16'
const D = (n) => addDays(TODAY, n)
const deposit = (n, amount, id = `d${n}`) => ({ id, type: 'deposit', amount, date: D(n) })
const withdrawal = (n, amount, id = `w${n}`) => ({ id, type: 'withdrawal', amount, date: D(n) })
const period = (n, annualRate, serviceCharge = 0.1) => ({ from: D(n), annualRate, serviceCharge })

const run = (transactions, rates, days = 30) => {
  const ledger = simulateLedger({ transactions, rates, fromDate: TODAY, endDate: D(days - 1) })
  return { ledger, summary: summarize(ledger, TODAY) }
}
const row = (ledger, n) => ledger.find(r => r.date === D(n))

// Each day's interest is rounded to the santim, so long stretches drift a few
// santim from smooth compounding.
const roughly = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 0.5, `${label}: got ${actual}, expected about ${expected}`)

const g1 = 1 + dailyRate({ annualRate: 0.4, serviceCharge: 0.1 })
const g2 = 1 + dailyRate({ annualRate: 0.3, serviceCharge: 0.1 })

// ---- ledger ----------------------------------------------------------------

test('1: a mid-ledger change affects only later days', () => {
  const txns = [deposit(-90, 10000)]
  const single = run(txns, [period(-90, 0.4)])
  const changed = run(txns, [period(-90, 0.4), period(-30, 0.3)])
  roughly(changed.summary.balance, 10000 * g1 ** 60 * g2 ** 30, 'balance today')
  for (const r of changed.ledger.filter(r => r.date < D(-30))) {
    assert.deepEqual(r, row(single.ledger, (Date.parse(r.date) - Date.parse(TODAY)) / 864e5), r.date)
  }
})

test('2 (done when): a rate change from today leaves interest earned exactly unchanged', () => {
  const txns = [deposit(-60, 20000), withdrawal(-20, 3000), deposit(-3, 1500)]
  const before = run(txns, [period(-60, 0.4)])
  const after = run(txns, [period(-60, 0.4), period(0, 0.3)])
  assert.equal(after.summary.interestToDate, before.summary.interestToDate)
  assert.equal(after.summary.interestThisMonth, before.summary.interestThisMonth)
  assert.equal(after.summary.balance, before.summary.balance)
  assert.ok(after.summary.interestToday < before.summary.interestToday)
  assert.ok(after.summary.projectedBalance < before.summary.projectedBalance)
})

test('3: a 0% period (or a 100% charge) earns nothing, and interest resumes after it', () => {
  const txns = [deposit(-40, 1000)]
  for (const pause of [period(-20, 0), period(-20, 0.4, 1)]) {
    const { ledger } = run(txns, [period(-40, 0.4), pause, period(-10, 0.4)])
    for (let n = -20; n <= -11; n++) assert.equal(row(ledger, n).interest, 0, D(n))
    assert.equal(row(ledger, -11).balance, row(ledger, -21).balance)
    assert.ok(row(ledger, -10).interest > 0)
  }
})

test('4: one period gives exactly the same ledger as a plain rate', () => {
  const txns = [deposit(-50, 5000), withdrawal(-10, 700)]
  const plain = run(txns, { annualRate: 0.4, serviceCharge: 0.1 })
  const history = run(txns, [period(-50, 0.4)])
  assert.deepEqual(history.ledger, plain.ledger)
})

test('5: days before the first period use the first period', () => {
  const txns = [deposit(-50, 1000)]
  const { ledger } = run(txns, [period(-30, 0.4), period(-10, 0.3)])
  roughly(row(ledger, -31).balance, 1000 * g1 ** 20, 'before the first period')
  assert.deepEqual(periodOn([period(-30, 0.4)], D(-99)), period(-30, 0.4))
})

test('6: unsorted input works, and duplicates on the same day keep the last one', () => {
  const txns = [deposit(-40, 1000)]
  const sorted = [period(-40, 0.4), period(-20, 0.3)]
  assert.deepEqual(run(txns, [...sorted].reverse()).ledger, run(txns, sorted).ledger)

  const pct = (n, annualRate) => ({ from: D(n), annualRate, serviceCharge: 10 })
  assert.deepEqual(sanitizeRates([pct(-20, 30), pct(-40, 40), pct(-20, 35)]), [pct(-40, 40), pct(-20, 35)])
})

test('7: a future period changes the projection and the goal plan only from its date', () => {
  const txns = [deposit(-10, 10000)]
  const now = run(txns, [period(-10, 0.4)], 60)
  const later = run(txns, [period(-10, 0.4), period(20, 0.1)], 60)
  for (let n = 0; n < 20; n++) assert.deepEqual(row(later.ledger, n), row(now.ledger, n), D(n))
  assert.ok(row(later.ledger, 20).interest < row(now.ledger, 20).interest)

  const goal = (rates) => planGoal({ transactions: txns, rates, today: TODAY, target: 12000 })
  assert.ok(goal([period(-10, 0.4), period(20, 0.1)]).days > goal([period(-10, 0.4)]).days)
})

test('8: overdraft checks use the rate history, including a lowered past rate', () => {
  // Needs the interest earned at 40% to cover the withdrawal.
  const txns = [deposit(-100, 1000), withdrawal(-1, 1050)]
  const high = [period(-100, 0.4)]
  const zero = [period(-100, 0)]
  assert.equal(findOverdraft(txns, high), null)
  assert.equal(findOverdraft(txns, zero), D(-1))
  assert.equal(findNewOverdraft(txns, txns, high, zero), D(-1))
  assert.equal(findNewOverdraft(txns, txns, zero, high), null)
  // Raising the rate, or not changing it, is never flagged.
  assert.equal(findNewOverdraft(txns, txns, high, high), null)
})

// ---- migration -------------------------------------------------------------

const v2 = (over = {}) => ({
  version: 2,
  account: { name: 'Gold', annualRate: 35, serviceCharge: 5 },
  goal: { target: null, monthly: 0 },
  transactions: [
    { id: 'a', type: 'deposit', amount: 8000, date: D(-80), note: '' },
    { id: 'b', type: 'withdrawal', amount: 500, date: D(-12), note: '' },
  ],
  ...over,
})

test('9: a v2 save becomes one period from its first transaction, with identical numbers', () => {
  const state = migrate(v2(), TODAY)
  assert.equal(state.version, 4)
  // The service charge is fixed at 10%, whatever an old save said.
  assert.deepEqual(state.account.rates, [{ from: D(-80), annualRate: 35, serviceCharge: 10 }])
  const before = run(v2().transactions, { annualRate: 0.35, serviceCharge: 0.1 })
  const after = run(state.transactions, toRates(state.account))
  assert.equal(after.summary.balance, before.summary.balance)
  assert.equal(after.summary.interestToDate, before.summary.interestToDate)
})

test('10-11: v2 with no transactions starts today; with only future ones, on the first of them', () => {
  assert.equal(migrate(v2({ transactions: [] }), TODAY).account.rates[0].from, TODAY)
  const future = migrate(v2({ transactions: [{ id: 'f', type: 'deposit', amount: 1, date: D(10) }] }), TODAY)
  assert.equal(future.account.rates[0].from, D(10))
  // It still applies today (days before the first period use it).
  assert.equal(periodOn(future.account.rates, TODAY).annualRate, 35)
})

test('12: a v1 save goes straight to the current version', () => {
  const state = migrate({ initialBalance: 5000, transactions: [{ id: 1, type: 'deposit', amount: 200, date: D(-30) }] }, TODAY)
  assert.equal(state.version, 4)
  assert.deepEqual(state.account.rates, [{ from: D(-30), annualRate: 40, serviceCharge: 10 }])
})

test('13: a corrupt rate history falls back to one sensible period, never none', () => {
  const v3 = (rates, account = {}) => migrate({ ...v2(), version: 3, account: { name: 'Gold', ...account, rates } }, TODAY)
  for (const rates of [undefined, [], 'x', 7, [null], [{ from: 'nope', annualRate: 40, serviceCharge: 10 }],
    [{ from: D(-5), annualRate: 140, serviceCharge: 10 }], [{ from: D(-5), annualRate: '', serviceCharge: 10 }]]) {
    const state = v3(rates)
    assert.equal(state.account.rates.length, 1, JSON.stringify(rates))
    assert.deepEqual(state.account.rates[0], { from: D(-80), annualRate: 40, serviceCharge: 10 }, JSON.stringify(rates))
  }
  // Bad entries are dropped, good ones kept.
  const mixed = v3([{ from: D(-80), annualRate: 30, serviceCharge: 5 }, { from: 'bad', annualRate: 1, serviceCharge: 1 }])
  assert.deepEqual(mixed.account.rates, [{ from: D(-80), annualRate: 30, serviceCharge: 10 }])
})

test('14: migrating twice is stable, and backups round-trip the rate history', () => {
  const once = migrate(v2(), TODAY)
  once.account.rates.push({ from: D(-10), annualRate: 30, serviceCharge: 10 })
  const twice = migrate(JSON.parse(JSON.stringify(once)), TODAY)
  assert.deepEqual(twice, once)
  assert.deepEqual(only(parseBackup(exportState(once))).account.rates, once.account.rates)
  // An old v2 backup file restores as the current version.
  assert.equal(parseBackup(JSON.stringify(v2())).version, 4)
})

// ---- user rules (2026-11-18) -----------------------------------------------

test('the service charge is always 10%, whatever is saved', () => {
  for (const serviceCharge of [0, 5, 50, 100, '', undefined]) {
    const pct = sanitizeRates([{ from: TODAY, annualRate: 40, serviceCharge }])
    assert.equal(pct[0].serviceCharge, 10, String(serviceCharge))
  }
})
