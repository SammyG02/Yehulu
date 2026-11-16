import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, addMonths, daysBetween, isDateKey, parseDateKey, toDateKey } from './dates.js'

test('toDateKey uses the local calendar day, right up to midnight', () => {
  // toISOString() would shift these by a day in any timezone that isn't UTC.
  assert.equal(toDateKey(new Date(2026, 10, 16, 0, 0, 0)), '2026-11-16')
  assert.equal(toDateKey(new Date(2026, 10, 16, 23, 59, 59)), '2026-11-16')
  assert.equal(toDateKey(new Date(2026, 10, 17, 0, 0, 1)), '2026-11-17')
  assert.equal(toDateKey(new Date(2026, 0, 5, 12)), '2026-01-05', 'pads month and day')
})

test('parseDateKey and toDateKey round-trip every day of a leap year and a normal year', () => {
  for (const [year, length] of [[2024, 366], [2026, 365]]) {
    let key = `${year}-01-01`
    const seen = new Set()
    for (let i = 0; i < length; i++) {
      assert.equal(toDateKey(parseDateKey(key)), key)
      seen.add(key)
      key = addDays(key, 1)
    }
    assert.equal(seen.size, length, `${year} has ${length} distinct days`)
    assert.equal(key, `${year + 1}-01-01`)
  }
})

test('addDays crosses month ends, year ends and leap days', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01')
  assert.equal(addDays('2026-02-28', 1), '2026-03-01')
  assert.equal(addDays('2024-02-28', 1), '2024-02-29')
  assert.equal(addDays('2024-02-29', 1), '2024-03-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2027-01-01', -1), '2026-12-31')
  assert.equal(addDays('2024-03-01', -1), '2024-02-29')
  assert.equal(addDays('2026-11-16', 0), '2026-11-16')
  assert.equal(addDays('2026-11-16', 365), '2027-11-16')
  assert.equal(addDays('2023-11-16', 366), '2024-11-16', 'spans 29 Feb 2024')
})

test('addMonths clamps to the last day of shorter months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonths('2026-03-31', 1), '2026-04-30')
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31', 'clamping does not stick to later months')
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28')
  assert.equal(addMonths('2026-11-16', 2), '2027-01-16', 'crosses the year end')
  assert.equal(addMonths('2026-11-16', 14), '2028-01-16')
  assert.equal(addMonths('2026-11-16', 0), '2026-11-16')
})

test('daysBetween counts whole days, across leap days and in both directions', () => {
  assert.equal(daysBetween('2026-11-16', '2026-11-16'), 0)
  assert.equal(daysBetween('2026-11-16', '2026-11-17'), 1)
  assert.equal(daysBetween('2026-11-17', '2026-11-16'), -1)
  assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365)
  assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366)
  assert.equal(daysBetween('2026-11-16', addDays('2026-11-16', 30 * 365)), 30 * 365)
})

test('isDateKey accepts only real calendar days in YYYY-MM-DD form', () => {
  for (const good of ['2026-11-16', '2024-02-29', '2026-12-31', '2000-01-01']) {
    assert.equal(isDateKey(good), true, good)
  }
  for (const bad of [
    '2026-02-30', '2026-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-01-00',
    '2026-1-5', '26-01-05', '2026/01/05', '2026-01-05T00:00:00Z', ' 2026-01-05', '',
    null, undefined, 20260105, new Date(), {},
  ]) {
    assert.equal(isDateKey(bad), false, String(bad))
  }
})

test('date keys sort chronologically as plain strings', () => {
  const keys = ['2027-01-01', '2026-12-31', '2026-02-10', '2026-02-09', '2026-10-01']
  const byString = [...keys].sort()
  const byTime = [...keys].sort((a, b) => parseDateKey(a) - parseDateKey(b))
  assert.deepEqual(byString, byTime)
})
