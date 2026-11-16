import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CURRENCY, formatAmount, formatCompact, formatDate, formatDuration, formatMoney, formatPercent, formatSigned, greeting,
} from './format.js'

test('formatAmount: two decimals with thousands separators', () => {
  assert.equal(formatAmount(0), '0.00')
  assert.equal(formatAmount(5), '5.00')
  assert.equal(formatAmount(1234.5), '1,234.50')
  assert.equal(formatAmount(1234567.891), '1,234,567.89')
  assert.equal(formatAmount(-250), '-250.00')
})

test('formatAmount: values that round to zero never show a minus sign', () => {
  assert.equal(formatAmount(-0.004), '0.00')
  assert.equal(formatAmount(-0), '0.00')
  assert.equal(formatAmount(0.004), '0.00')
  assert.equal(formatAmount(-1e-12), '0.00', 'float dust from subtracting balances')
  assert.equal(formatAmount(-0.004, { whole: true }), '0')
})

test('formatAmount: whole amounts round to the nearest Birr', () => {
  assert.equal(formatAmount(1234.5, { whole: true }), '1,235')
  assert.equal(formatAmount(1234.4, { whole: true }), '1,234')
  assert.equal(formatAmount(5000, { whole: true }), '5,000')
})

test('formatMoney and formatSigned put the currency first', () => {
  assert.equal(CURRENCY, 'Br')
  assert.equal(formatMoney(1234.5), 'Br 1,234.50')
  assert.equal(formatMoney(1234.5, { whole: true }), 'Br 1,235')
  assert.equal(formatSigned(1000, 'deposit'), '+Br 1,000.00')
  assert.equal(formatSigned(250, 'withdrawal'), '−Br 250.00')
})

test('formatCompact and formatPercent', () => {
  assert.equal(formatCompact(950), '950')
  assert.equal(formatCompact(12300), '12.3K')
  assert.equal(formatCompact(2500000), '2.5M')
  assert.equal(formatPercent(0.433075), '43.31%')
  assert.equal(formatPercent(0), '0.00%')
  assert.equal(formatPercent(0.36 / 365, 4), '0.0986%')
})

test('formatDuration: days, then months, then years and months', () => {
  const cases = [
    [0, 'today'], [-3, 'today'],
    [1, '1 day'], [12, '12 days'], [30, '30 days'],
    [31, '1 month'], [61, '2 months'], [364, '11 months'],
    [365, '1 year'], [395, '1 year'], [396, '1 year, 1 month'],
    [500, '1 year, 4 months'], [729, '1 year, 11 months'],
    [730, '2 years'], [30 * 365, '30 years'],
  ]
  for (const [days, expected] of cases) assert.equal(formatDuration(days), expected, `${days} days`)
})

test('formatDate shows the stored calendar day, whatever the locale', () => {
  // The locale decides the wording, so only check the parts that must appear.
  const text = formatDate('2026-11-16')
  assert.match(text, /16/)
  assert.match(text, /2026/)
  assert.match(formatDate('2026-01-01'), /1/)
  assert.doesNotMatch(formatDate('2026-01-01', { year: 'numeric' }), /2025/, 'no slip into the previous day')
  assert.doesNotMatch(formatDate('2026-11-16', { day: 'numeric', month: 'short' }), /2026/, 'options are respected')
})

test('greeting follows the time of day', () => {
  const at = (hour, minute = 0) => greeting(new Date(2026, 10, 16, hour, minute))
  assert.equal(at(0), 'Good morning')
  assert.equal(at(11, 59), 'Good morning')
  assert.equal(at(12), 'Good afternoon')
  assert.equal(at(16, 59), 'Good afternoon')
  assert.equal(at(17), 'Good evening')
  assert.equal(at(23, 59), 'Good evening')
})

// ---- known bugs (QA review 2026-11-16). Remove `todo` when fixed. -----------

test('BUG: a small negative whole amount shows "0", not "-0"', { todo: true }, () => {
  assert.equal(formatAmount(-0.3, { whole: true }), '0')
})

test('BUG: formatDuration(0) reads wrongly after "sooner" in the goal planner', { todo: true }, () => {
  // GoalPlanner prints `${formatDuration(without.days - plan.days)} sooner`, which gives "today sooner"
  // when top-ups make no difference. Either the helper or the caller needs a zero case.
  assert.notEqual(`${formatDuration(0)} sooner`, 'today sooner')
})
