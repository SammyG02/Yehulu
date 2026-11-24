import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chargeFound, chargeOn, sanitizeCharges, withCharges } from './charge.js'
import { coveredUntil, findNewOverdraft, planGoal, simulateGroupLedger, simulateLedger } from './interest.js'
import { migrate, plainRatesOf, ratesOf } from './storage.js'
import { planNotifications } from './notify.js'

const RATE = [{ from: '2026-01-01', annualRate: 0, serviceCharge: 0.1 }]
const FORTY = [{ from: '2026-01-01', annualRate: 0.4, serviceCharge: 0.1 }]
const DAILY = [{ from: '2026-11-02', amount: 10 }] // a Monday
const dep = (amount, date) => ({ id: date, type: 'deposit', amount, date })
const charged = (transactions, charges = DAILY, endDate = '2026-11-15', rates = RATE) =>
  simulateLedger({ transactions, rates: withCharges(rates, charges), fromDate: '2026-11-01', endDate })
const perDay = (rows) => rows.filter(r => r.charges > 0).map(r => `${Number(r.date.slice(8))}:${r.charges}`).join(' ')

test('a charge each day, none on Sunday, two on Monday', () => {
  const rows = charged([dep(1000, '2026-11-01')])
  assert.equal(perDay(rows), '2:10 3:10 4:10 5:10 6:10 7:10 9:20 10:10 11:10 12:10 13:10 14:10')
  assert.equal(rows.at(-1).balance, 870)
})

test('a charge that is off, or has not started, changes nothing at all', () => {
  assert.equal(withCharges(RATE, []), RATE)
  assert.equal(withCharges(RATE, undefined), RATE)
  const plain = simulateLedger({ transactions: [dep(1000, '2026-11-01')], rates: FORTY, fromDate: '2026-11-01', endDate: '2026-12-31' })
  assert.deepEqual(charged([dep(1000, '2026-11-01')], [{ from: '2027-01-01', amount: 10 }], '2026-12-31', FORTY), plain)
})

test('it never applies before its first day, even when that is before the first rate', () => {
  const rates = [{ from: '2026-11-10', annualRate: 0, serviceCharge: 0.1 }]
  assert.equal(perDay(charged([dep(1000, '2026-11-01')], [{ from: '2026-11-05', amount: 5 }], '2026-11-06', rates)), '5:5 6:5')
})

test('it changes and stops on the chosen day; a Sunday before that is still taken', () => {
  const rows = charged([dep(1000, '2026-11-01')], [...DAILY, { from: '2026-11-04', amount: 15 }, { from: '2026-11-09', amount: 0 }])
  assert.equal(perDay(rows), '2:10 3:10 4:15 5:15 6:15 7:15 9:15')
})

test('the rate history and the charge history mix', () => {
  const merged = withCharges([...FORTY, { from: '2026-11-03', annualRate: 0.35, serviceCharge: 0.1 }], DAILY)
  assert.deepEqual(merged.map(p => [p.from, p.annualRate, p.dailyCharge]), [['2026-01-01', 0.4, 0], ['2026-11-02', 0.4, 10], ['2026-11-03', 0.35, 10]])
})

test('it lowers the balance that earns interest, with no 0.2% fee', () => {
  const [, row] = charged([dep(100000, '2026-11-01')], DAILY, '2026-11-02', FORTY)
  const line = { type: 'withdrawal', amount: 10, date: '2026-11-02', noFee: true }
  const [, same] = simulateLedger({ transactions: [dep(100000, '2026-11-01'), line], rates: FORTY, fromDate: '2026-11-01', endDate: '2026-11-02' })
  assert.deepEqual({ ...row, charges: 0 }, same)
  assert.equal(row.fees, 0)
})

test('without enough money it is not taken, and not owed later', () => {
  const rows = charged([dep(25, '2026-11-01'), dep(100, '2026-11-10')])
  assert.equal(perDay(rows), '2:10 3:10 10:10 11:10 12:10 13:10 14:10')
  assert.ok(rows.every(r => r.available >= 0))
})

test('days a statement covers count only its own lines', () => {
  const line = { id: 's', type: 'withdrawal', amount: 10, date: '2026-11-04', noFee: true, ref: 'y:1:a', source: 'f.pdf|2026-11-01|2026-11-06' }
  assert.equal(coveredUntil([line]), '2026-11-06')
  assert.equal(perDay(charged([dep(1000, '2026-11-01'), line])), '7:10 9:20 10:10 11:10 12:10 13:10 14:10')
  // Older imports have no file: their last line. Your own entries and stand-ins don't count.
  assert.equal(coveredUntil([{ ...line, source: undefined }, dep(5, '2026-11-09')]), '2026-11-04')
  assert.equal(coveredUntil([dep(5, '2026-11-09'), { ref: 'gap-2026-11-08:5', date: '2026-11-09' }]), null)
  assert.equal(coveredUntil([{ ref: 'opening-2026-11-01', date: '2026-11-01', source: 'a|b.pdf|2026-11-01|2026-11-30' }]), '2026-11-30')
})

test('a statement ending on Saturday: Sunday and Monday are taken on Monday', () => {
  const line = { id: 's', type: 'withdrawal', amount: 10, date: '2026-11-07', noFee: true, ref: 'y:1:a', source: 'f|2026-11-01|2026-11-07' }
  assert.match(perDay(charged([dep(1000, '2026-11-01'), line])), /^9:20 /)
})

test('goals, groups and overdraft checks include it', () => {
  const list = [dep(20000, '2026-11-01')]
  const goal = (rates) => planGoal({ transactions: list, rates, today: '2026-11-02', target: 25000 })
  assert.ok(goal(withCharges(FORTY, DAILY)).days > goal(FORTY).days)
  const groups = [{ transactions: list, rates: withCharges(FORTY, DAILY) }, { transactions: list, rates: FORTY }]
  const total = simulateGroupLedger({ groups, rates: FORTY, fromDate: '2026-11-01', endDate: '2026-11-03' })
  assert.deepEqual(total.map(r => r.charges), [0, 10, 10])
  const all = { id: 'w', type: 'withdrawal', amount: 100, date: '2026-11-04', noFee: true }
  assert.equal(findNewOverdraft([dep(100, '2026-11-01')], [dep(100, '2026-11-01'), all], withCharges(RATE, DAILY)), '2026-11-04')
})

test('charge histories are cleaned', () => {
  assert.deepEqual(sanitizeCharges([
    { from: '2026-02-01', amount: 5 }, { from: '2026-01-01', amount: 0 }, { from: 'x', amount: 1 }, { from: '2026-03-01', amount: -1 },
    { from: '2026-03-02', amount: null }, { from: '2026-04-01', amount: '7.456' }, { from: '2026-05-01', amount: 7.46 }, { from: '2026-06-01', amount: 1e9 },
  ]), [{ from: '2026-02-01', amount: 5 }, { from: '2026-04-01', amount: 7.46 }])
  assert.deepEqual(sanitizeCharges('no'), [])
  assert.deepEqual(['2026-11-01', '2026-11-02', '2027-01-01'].map(d => chargeOn(DAILY, d)), [0, 10, 10])
})

test('the suggestion: a regular charge still going when the statements end', () => {
  const so = (date, amount = 10) => ({ type: 'withdrawal', amount, date, noFee: true, ref: `y:1:${date}${amount}`, source: 'f|2026-10-01|2026-10-31' })
  const days = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`)
  assert.deepEqual(chargeFound(days.map(d => so(d))), { amount: 10, since: '2026-10-01' })
  assert.equal(chargeFound(days.slice(0, 20).map(d => so(d))), null, 'it stopped')
  assert.equal(chargeFound(days.slice(0, 5).map(d => so(d))), null)
  assert.equal(chargeFound(days.map(d => ({ ...so(d), noFee: false }))), null)
  assert.deepEqual(chargeFound([so('2026-07-23'), ...days.map(d => so(d))]), { amount: 10, since: '2026-10-01' })
})

test('saved with the account, kept in backups, and left out of statement maths', () => {
  const raw = { version: 4, activeId: 'a', accounts: [{ id: 'a', name: 'A', rates: [{ from: '2026-01-01', annualRate: 40, serviceCharge: 10 }], transactions: [], charges: [...DAILY, { from: 'bad', amount: 1 }] }] }
  const [account] = migrate(raw, '2026-11-24').accounts
  assert.deepEqual(account.charges, DAILY)
  assert.equal(ratesOf(account, null).at(-1).dailyCharge, 10)
  assert.equal('dailyCharge' in plainRatesOf(account, null)[0], false)
  assert.equal('charges' in migrate({ ...raw, accounts: [{ ...raw.accounts[0], charges: [] }] }, '2026-11-24').accounts[0], false)
  const shared = { ...account, members: [{ id: 'me', charges: DAILY }, { id: 'abe' }] }
  assert.deepEqual([ratesOf(shared, 'me').at(-1).dailyCharge, ratesOf(shared, 'abe').at(-1).dailyCharge], [10, undefined])
})

test('notifications use it too', () => {
  const user = (charges) => ({ settings: {}, accounts: [{ id: 'a', name: 'A', goal: {}, rates: [{ from: '2026-01-01', annual_rate: 40 }], my_charges: charges, transactions: [{ type: 'deposit', amount: '100000', date: '2026-01-01', no_fee: false, ref: null, source: null }] }] })
  const body = (charges) => planNotifications(user(charges), '2026-11-22')[0].body
  assert.notEqual(body([{ from: '2026-01-01', amount: 100 }]), body(null))
})
