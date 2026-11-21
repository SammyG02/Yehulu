import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyAccount, emptyState, exportState, FIRST_ACCOUNT_ID, MAX_ACCOUNTS, migrate, parseBackup, YEHULU_RATES,
} from './storage.js'

const TODAY = '2026-11-19'
const txn = (over = {}) => ({ id: 'a', type: 'deposit', amount: 100, date: '2026-10-01', note: '', ...over })
const v3 = {
  version: 3,
  account: { name: 'Gold', rates: [{ from: '2026-10-01', annualRate: 35, serviceCharge: 10 }] },
  goal: { target: 50000, monthly: 1000 },
  transactions: [txn()],
}
const account = (id, over = {}) => ({ ...emptyAccount(TODAY, { id }), ...over })

test('a v3 save becomes the first account, with nothing lost', () => {
  const state = migrate(v3, TODAY)
  assert.equal(state.version, 4)
  assert.equal(state.activeId, FIRST_ACCOUNT_ID)
  assert.deepEqual(state.accounts, [{
    id: FIRST_ACCOUNT_ID,
    name: 'Gold',
    rates: v3.account.rates,
    goal: v3.goal,
    transactions: v3.transactions,
  }])
})

test('each account keeps its own name, rates, goal and transactions', () => {
  const raw = {
    version: 4,
    activeId: 'b',
    accounts: [
      account('a', { name: 'Regular', transactions: [txn({ id: 'x' })] }),
      account('b', { name: 'Fixed', rates: [{ from: TODAY, annualRate: 50, serviceCharge: 10 }], goal: { target: 9000, monthly: 0 } }),
    ],
  }
  const state = migrate(raw, TODAY)
  assert.equal(state.activeId, 'b')
  assert.deepEqual(state.accounts.map(a => [a.id, a.name, a.rates.at(-1).annualRate, a.goal.target, a.transactions.length]),
    [['a', 'Regular', 40, null, 1], ['b', 'Fixed', 50, 9000, 0]])
})

test('loading twice is stable, and backups restore every account', () => {
  const raw = { version: 4, activeId: 'b', accounts: [account('a', { transactions: [txn()] }), account('b', { name: 'Fixed' })] }
  const once = migrate(raw, TODAY)
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(once)), TODAY), once)
  assert.deepEqual(parseBackup(exportState(once)), once)
})

test('broken or duplicate accounts are repaired, never lost', () => {
  const state = migrate({
    version: 4,
    activeId: 'gone',
    accounts: [null, 'x', account('a'), account('a', { name: 'Twin' }), { name: 'No id' }],
  }, TODAY)
  assert.equal(state.accounts.length, 3)
  assert.equal(new Set(state.accounts.map(a => a.id)).size, 3)
  assert.deepEqual(state.accounts.map(a => a.name), ['My savings', 'Twin', 'No id'])
  // An unknown open account falls back to the first one.
  assert.equal(state.activeId, 'a')
})

test('an empty account list loads as a fresh start', () => {
  for (const accounts of [[], [null, 7]]) {
    assert.deepEqual(migrate({ version: 4, accounts }, TODAY), emptyState(TODAY))
  }
})

test(`at most ${MAX_ACCOUNTS} accounts are kept`, () => {
  const accounts = Array.from({ length: MAX_ACCOUNTS + 5 }, (_, i) => account(`id${i}`))
  assert.equal(migrate({ version: 4, accounts }, TODAY).accounts.length, MAX_ACCOUNTS)
})

test('a new account starts empty with the chosen rate', () => {
  const a = emptyAccount(TODAY, { id: 'n', name: 'Holiday', annualRate: 30 })
  assert.deepEqual(a, {
    id: 'n', name: 'Holiday', rates: [{ from: TODAY, annualRate: 30, serviceCharge: 10 }], goal: { target: null, monthly: 0 }, transactions: [],
  })
})

test('a new 40% account follows Yehulu\'s real rate history; other rates start today', () => {
  const standard = emptyAccount(TODAY)
  assert.deepEqual(standard.rates.map(r => [r.from, r.annualRate]),
    [['2025-08-01', 50], ['2025-11-01', 40], ['2026-01-27', 35], ['2026-09-18', 40]])
  assert.deepEqual(emptyAccount(TODAY, { annualRate: 12 }).rates, [{ from: TODAY, annualRate: 12, serviceCharge: 10 }])
  assert.equal(standard.rates[0] === YEHULU_RATES[0], false, 'a copy, not the shared list')
})
