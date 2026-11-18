import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findNewOverdraft, findOverdraft, simulateLedger, withdrawalFee } from './interest.js'
import { addDays } from './dates.js'

// Tests for the S1-1b fix: an overdraft that already exists must not block
// unrelated changes, but any change that creates or deepens one is caught.

const TODAY = '2026-11-16'
const RATES = { annualRate: 0.40, serviceCharge: 0.10 }
const deposit = (daysFromToday, amount) => ({ id: `d${daysFromToday}`, type: 'deposit', amount, date: addDays(TODAY, daysFromToday) })
const withdrawal = (daysFromToday, amount) => ({ id: `w${daysFromToday}`, type: 'withdrawal', amount, date: addDays(TODAY, daysFromToday) })

test('PM repro: after deleting the only deposit, a later deposit is still accepted', () => {
  const dep = { id: 'a', type: 'deposit', amount: 100, date: '2026-01-01' }
  const wd = { id: 'b', type: 'withdrawal', amount: 50, date: '2026-01-05' }
  // Deleting the deposit overdraws Jan 5, which is worth a warning.
  assert.equal(findNewOverdraft([dep, wd], [wd], RATES), '2026-01-05')
  // Once deleted, a 1,000 deposit on Jun 1 must succeed.
  const big = { id: 'c', type: 'deposit', amount: 1000, date: '2026-06-01' }
  assert.equal(findNewOverdraft([wd], [wd, big], RATES), null)
})

test('an existing overdraft does not block unrelated changes', () => {
  const overdrawn = [deposit(-10, 100), withdrawal(-5, 500)]
  assert.ok(findOverdraft(overdrawn, RATES), 'precondition: account is overdrawn')
  assert.equal(findNewOverdraft(overdrawn, [...overdrawn, deposit(0, 1000)], RATES), null)
  const recovered = [...overdrawn, deposit(-2, 1000)]
  assert.equal(findNewOverdraft(recovered, [...recovered, withdrawal(-1, 100)], RATES), null)
})

test('new overdrafts are still caught, including from an empty account', () => {
  const ok = [deposit(-10, 100)]
  assert.equal(findNewOverdraft(ok, [...ok, withdrawal(-1, 500)], RATES), addDays(TODAY, -1))
  assert.equal(findNewOverdraft(ok, [...ok, withdrawal(-1, 50)], RATES), null)
  // First transaction ever (empty `before`).
  assert.equal(findNewOverdraft([], [withdrawal(0, 1)], RATES), TODAY)
  assert.equal(findNewOverdraft([], [deposit(0, 1)], RATES), null)
})

test('making an existing overdraft deeper, or earlier, is caught', () => {
  const overdrawn = [deposit(-10, 100), withdrawal(-5, 500)]
  assert.equal(findNewOverdraft(overdrawn, [...overdrawn, withdrawal(-3, 50)], RATES), addDays(TODAY, -3))
  assert.equal(findNewOverdraft(overdrawn, [...overdrawn, withdrawal(-8, 200)], RATES), addDays(TODAY, -8))
})

test('deleting a deposit that deepens an existing overdraft still warns', () => {
  const overdrawn = [deposit(-10, 100), withdrawal(-5, 500), deposit(-4, 50)]
  const withoutLater = overdrawn.slice(0, 2)
  assert.equal(findNewOverdraft(overdrawn, withoutLater, RATES), addDays(TODAY, -4))
})

test('editing a deposit to a later date can create an overdraft', () => {
  const before = [deposit(-10, 1000), withdrawal(-5, 800)]
  const after = [{ ...before[0], date: addDays(TODAY, -2) }, before[1]]
  assert.equal(findNewOverdraft(before, after, RATES), addDays(TODAY, -5))
})

// QA plan S1-1b, numbered as in the plan.
const overdrawnHistory = () => [deposit(-10, 100), withdrawal(-5, 500)]

test('QA 1-3: deposits are accepted on overdrawn history, wherever they land', () => {
  const h = overdrawnHistory()
  assert.equal(findNewOverdraft(h, [...h, deposit(0, 50)], RATES), null)
  assert.equal(findNewOverdraft(h, [...h, deposit(-7, 1000)], RATES), null)
  assert.equal(findNewOverdraft(h, [...h, deposit(-12, 30)], RATES), null)
})

test('QA 5: a withdrawal that makes a later existing withdrawal overdraw is rejected at that later date', () => {
  const h = [deposit(-10, 1000), withdrawal(-1, 900)]
  assert.equal(findNewOverdraft(h, [...h, withdrawal(-3, 200)], RATES), addDays(TODAY, -1))
})

test('QA 7-8: earlier or future overdrafts are named by their own date', () => {
  const h = overdrawnHistory()
  // 10 on D-8 is affordable that day but deepens the existing overdraft on D-5.
  assert.equal(findNewOverdraft(h, [...h, withdrawal(-8, 10)], RATES), addDays(TODAY, -5))
  // 200 on D-8 overdraws that day itself.
  assert.equal(findNewOverdraft(h, [...h, withdrawal(-8, 200)], RATES), addDays(TODAY, -8))
  const ok = [deposit(-10, 100)]
  assert.equal(findNewOverdraft(ok, [...ok, withdrawal(20, 1000)], RATES), addDays(TODAY, 20))
})

test('QA 9-11: edits on overdrawn history', () => {
  const h = overdrawnHistory()
  const edit = (changes) => [h[0], { ...h[1], ...changes }]
  assert.equal(findNewOverdraft(h, edit({ note: 'Rent' }), RATES), null)
  assert.equal(findNewOverdraft(h, edit({ amount: 300 }), RATES), null)
  assert.equal(findNewOverdraft(h, edit({ amount: 600 }), RATES), addDays(TODAY, -5))
})

test('QA 12: turning a needed deposit into a withdrawal is rejected', () => {
  const before = [deposit(-10, 1000), withdrawal(-5, 800)]
  const after = [{ ...before[0], type: 'withdrawal' }, before[1]]
  assert.equal(findNewOverdraft(before, after, RATES), addDays(TODAY, -10))
})

test('QA 15-16, 19: deleting a withdrawal, deleting everything, and identical lists are fine', () => {
  const h = overdrawnHistory()
  assert.equal(findNewOverdraft(h, [h[0]], RATES), null)
  assert.equal(findNewOverdraft([deposit(0, 5)], [], RATES), null)
  assert.equal(findNewOverdraft(h, [...h], RATES), null)
})

test('QA 18: withdrawing everything is accepted once the 0.2% fee is counted', () => {
  const h = [deposit(0, 250)]
  // 249.50 + its 0.50 fee is exactly the balance; 250 + 0.50 is not.
  assert.equal(findNewOverdraft(h, [...h, withdrawal(0, 249.5)], RATES), null)
  assert.equal(findNewOverdraft(h, [...h, withdrawal(0, 250)], RATES), TODAY)
  const elsewhere = [...overdrawnHistory(), deposit(-2, 1000)]
  // Balance available on D-1 after the -5 overdraft was cured.
  assert.equal(findNewOverdraft(elsewhere, [...elsewhere, withdrawal(-1, 590)], RATES), null)
})

test('QA 20: rates matter: withdrawing earned interest needs a non-zero rate', () => {
  const h = [deposit(-100, 1000)]
  const earned = [...h, withdrawal(0, 1050)]
  assert.equal(findNewOverdraft(h, earned, RATES), null)
  assert.equal(findNewOverdraft(h, earned, { annualRate: 0, serviceCharge: 0.1 }), TODAY)
})

// ---- withdrawal fee (0.2%) --------------------------------------------------

test('each withdrawal pays a 0.2% fee on its date; deposits pay nothing', () => {
  const { ledger } = { ledger: simulateLedger({ transactions: [deposit(-5, 10000), withdrawal(-2, 1000)], rates: RATES, fromDate: TODAY, endDate: TODAY }) }
  const day = (n) => ledger.find(r => r.date === addDays(TODAY, n))
  assert.equal(day(-5).fees, 0)
  assert.equal(day(-2).fees, 2)
  assert.equal(day(-2).available, day(-2).opening - 1000 - 2)
  assert.equal(withdrawalFee(1234.56), 2.47)
  assert.equal(withdrawalFee(1), 0)
})

test('editing a withdrawal recalculates its one fee; editing a deposit adds none', () => {
  const fees = (txns) => simulateLedger({ transactions: txns, rates: RATES, fromDate: TODAY, endDate: TODAY })
    .reduce((sum, r) => sum + r.fees, 0)
  const w = withdrawal(-2, 1000)
  const d = deposit(-5, 10000)
  assert.equal(fees([d, w]), 2)
  assert.equal(fees([d, { ...w, amount: 500 }]), 1)
  assert.equal(fees([d, { ...w, date: addDays(TODAY, -1), note: 'edited' }]), 2)
  assert.equal(fees([{ ...d, amount: 20000 }, w]), 2)
})
