import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ACCOUNT, emptyState, exportState, migrate, parseBackup, sanitizeAccount, sanitizeGoal, toRates,
} from './storage.js'

const TODAY = '2026-11-16'
const txn = (over = {}) => ({ id: 'a', type: 'deposit', amount: 100, date: '2026-10-01', note: '', ...over })
const v2 = (over = {}) => ({
  version: 2,
  account: { name: 'Gold', annualRate: 35, serviceCharge: 5 },
  goal: { target: 50000, monthly: 1000 },
  transactions: [txn()],
  ...over,
})

// ---- corrupt saves ---------------------------------------------------------

test('anything that is not an object loads as an empty state', () => {
  for (const raw of [null, undefined, 'hello', 42, true, NaN]) {
    assert.deepEqual(migrate(raw, TODAY), emptyState(), String(raw))
  }
})

test('missing or wrongly typed sections fall back to defaults', () => {
  for (const raw of [{}, [], { transactions: 'nope' }, { transactions: null, account: 7, goal: 'x' }]) {
    const state = migrate(raw, TODAY)
    assert.deepEqual(state.transactions, [])
    assert.deepEqual(state.goal, { target: null, monthly: 0 })
    assert.equal(state.account.name, DEFAULT_ACCOUNT.name)
    assert.equal(typeof state.version, 'number')
  }
})

test('broken transactions are dropped and good ones kept', () => {
  const state = migrate(v2({
    transactions: [
      txn({ id: 'good' }),
      null,
      'text',
      42,
      {},
      txn({ id: 'neg', amount: -5 }),
      txn({ id: 'zero', amount: 0 }),
      txn({ id: 'nan', amount: 'abc' }),
      txn({ id: 'tiny', amount: 0.004 }),
      txn({ id: 'type', type: 'transfer' }),
      txn({ id: 'nodate', date: undefined }),
      txn({ id: 'feb30', date: '2026-02-30' }),
      txn({ id: 'iso', date: '2026-10-01T00:00:00.000Z' }),
    ],
  }), TODAY)
  assert.deepEqual(state.transactions.map(t => t.id), ['good'])
})

test('transactions are normalised: cents, string ids, trimmed notes', () => {
  const [t] = migrate(v2({
    transactions: [{ id: 7, type: 'withdrawal', amount: '250.129', date: '2026-10-02', note: `  ${'x'.repeat(80)}  `, extra: 'junk' }],
  }), TODAY).transactions
  assert.deepEqual(Object.keys(t).sort(), ['amount', 'date', 'id', 'note', 'type'])
  assert.equal(t.id, '7')
  assert.equal(t.amount, 250.13)
  assert.equal(t.note.length, 60)
})

test('a transaction without an id gets a unique one', () => {
  const state = migrate(v2({ transactions: [txn({ id: undefined }), txn({ id: null })] }), TODAY)
  const ids = state.transactions.map(t => t.id)
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0))
  assert.equal(new Set(ids).size, 2)
})

// ---- account and goal ------------------------------------------------------

test('sanitizeAccount keeps valid rates, including zero, and rejects the rest', () => {
  assert.deepEqual(sanitizeAccount({ name: '  Gold  ', annualRate: '35.5', serviceCharge: 0 }),
    { name: 'Gold', annualRate: 35.5, serviceCharge: 0 })
  assert.equal(sanitizeAccount({ annualRate: 0 }).annualRate, 0)
  assert.equal(sanitizeAccount({ annualRate: 100 }).annualRate, 100)
  for (const bad of [-1, 100.01, 'abc', NaN, Infinity, undefined, {}]) {
    assert.equal(sanitizeAccount({ annualRate: bad }).annualRate, DEFAULT_ACCOUNT.annualRate, `rate ${String(bad)}`)
    assert.equal(sanitizeAccount({ serviceCharge: bad }).serviceCharge, DEFAULT_ACCOUNT.serviceCharge, `charge ${String(bad)}`)
  }
  assert.equal(sanitizeAccount({ name: '   ' }).name, DEFAULT_ACCOUNT.name)
  assert.equal(sanitizeAccount({ name: 'n'.repeat(99) }).name.length, 40)
  assert.deepEqual(sanitizeAccount(null), DEFAULT_ACCOUNT)
})

test('toRates turns percentages into fractions', () => {
  assert.deepEqual(toRates({ annualRate: 40, serviceCharge: 10 }), { annualRate: 0.4, serviceCharge: 0.1 })
  assert.deepEqual(toRates({ annualRate: 0, serviceCharge: 0 }), { annualRate: 0, serviceCharge: 0 })
})

test('sanitizeGoal: positive numbers to the cent, everything else is "no goal"', () => {
  assert.deepEqual(sanitizeGoal({ target: '50000.555', monthly: '1000' }), { target: 50000.56, monthly: 1000 })
  for (const bad of [null, undefined, {}, { target: 0 }, { target: -5, monthly: -1 }, { target: 'abc', monthly: 'x' }, { target: '' }]) {
    assert.deepEqual(sanitizeGoal(bad), { target: null, monthly: 0 }, JSON.stringify(bad))
  }
})

// ---- old saves -------------------------------------------------------------

test('v1: root capital becomes an opening deposit, old notes are cleaned', () => {
  const v1 = {
    initialBalance: 5000,
    transactions: [{ id: 1, type: 'deposit', amount: 200, date: '2026-09-01', description: 'Deposit' }],
  }
  const state = migrate(v1, TODAY)
  assert.equal(state.version, emptyState().version)
  assert.deepEqual(state.account, { name: 'My savings', annualRate: 40, serviceCharge: 10 })
  assert.equal(state.transactions.length, 2)
  assert.deepEqual(
    { ...state.transactions[0], id: undefined },
    { id: undefined, type: 'deposit', amount: 5000, date: '2026-09-01', note: 'Opening balance' },
  )
  assert.equal(state.transactions[1].note, '')
  assert.equal(state.transactions[1].id, '1')
  assert.deepEqual(state.goal, { target: null, monthly: 0 })
})

test('v1: opening balance uses startDate, else the first transaction, else today', () => {
  const opening = (raw) => migrate(raw, TODAY).transactions.find(t => t.note === 'Opening balance')

  assert.equal(opening({ initialBalance: 5000, startDate: '2026-01-15', transactions: [txn()] }).date, '2026-01-15')
  assert.equal(opening({ initialBalance: 5000, transactions: [txn({ date: '2026-09-09' }), txn({ id: 'b', date: '2026-03-03' })] }).date, '2026-03-03')
  assert.equal(opening({ initialBalance: 5000 }).date, TODAY)
  assert.equal(opening({ initialBalance: 5000, startDate: 'garbage' }).date, TODAY)
  assert.equal(opening({ initialBalance: '5000.555' }).amount, 5000.56)
})

test('v1: no opening deposit when there was no starting balance', () => {
  for (const initialBalance of [0, -100, 'abc', undefined, null]) {
    const state = migrate({ initialBalance, transactions: [txn()] }, TODAY)
    assert.equal(state.transactions.length, 1, String(initialBalance))
  }
})

test('a current save never gets an opening balance added, and loads unchanged', () => {
  const saved = v2({ initialBalance: 9999 })
  const state = migrate(saved, TODAY)
  assert.equal(state.transactions.length, 1)
  assert.deepEqual(state.transactions, saved.transactions)
  assert.deepEqual(state.goal, saved.goal)
  assert.equal(state.account.name, 'Gold')
})

test('migrating twice changes nothing (load, save, load is stable)', () => {
  const once = migrate({ initialBalance: 5000, transactions: [txn({ description: 'Deposit' })] }, TODAY)
  const twice = migrate(JSON.parse(JSON.stringify(once)), TODAY)
  assert.deepEqual(twice, once)
})

// ---- backups ---------------------------------------------------------------

test('a backup restores to exactly the state that was exported', () => {
  const state = migrate(v2(), TODAY)
  assert.deepEqual(parseBackup(exportState(state)), state)
})

test('parseBackup rejects files that are not Yehulu backups, with a readable message', () => {
  assert.throws(() => parseBackup('not json {'), /valid JSON/)
  for (const text of ['null', '42', '"text"', '{}', '[]', '{"transactions":"x"}']) {
    assert.throws(() => parseBackup(text), /Yehulu backup/, text)
  }
})

// ---- known bugs (QA review 2026-11-16). Remove `todo` when fixed. -----------

test('BUG: an amount that overflows to Infinity is dropped', { todo: true }, () => {
  const state = migrate(v2({ transactions: [txn({ amount: '1e400' }), txn({ id: 'b', amount: Infinity })] }), TODAY)
  assert.equal(state.transactions.length, 0)
})

test('BUG: duplicate transaction ids are made unique', { todo: true }, () => {
  const state = migrate(v2({ transactions: [txn({ id: 1 }), txn({ id: 1 }), txn({ id: '1' })] }), TODAY)
  assert.equal(new Set(state.transactions.map(t => t.id)).size, 3)
})

test('BUG: a blank or null saved rate falls back to the default, not 0%', { todo: true }, () => {
  for (const blank of ['', null, '   ', [], false]) {
    assert.equal(sanitizeAccount({ annualRate: blank }).annualRate, DEFAULT_ACCOUNT.annualRate, JSON.stringify(blank))
  }
})
