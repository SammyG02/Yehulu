import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planNotifications } from './notify.js'
import { simulateLedger, summarize } from './interest.js'

const SUNDAY = '2026-11-22'
const MONDAY = '2026-11-23'
const account = (over = {}) => ({
  id: 'acc', name: 'My savings',
  goal: { target: null, monthly: 0 },
  rates: [{ from: '2026-01-01', annual_rate: 40 }],
  my_rates: null,
  transactions: [{ type: 'deposit', amount: 100000, date: '2026-10-01', no_fee: false }],
  ...over,
})
const user = (over = {}) => ({ settings: {}, sent: [], accounts: [account()], ...over })

test('weekly summary on Sundays only, with the week\'s interest and today\'s balance from the app\'s maths', () => {
  const [n] = planNotifications(user(), SUNDAY)
  assert.equal(n.kind, 'weekly')
  assert.equal(n.key, SUNDAY)
  const ledger = simulateLedger({ transactions: [{ type: 'deposit', amount: 100000, date: '2026-10-01' }], rates: [{ from: '2026-01-01', annualRate: 0.4, serviceCharge: 0.1 }], fromDate: SUNDAY, endDate: SUNDAY })
  const week = ledger.filter(r => r.date >= '2026-11-15' && r.date < SUNDAY).reduce((s, r) => s + r.interest, 0)
  const balance = summarize(ledger, SUNDAY).balance
  assert.equal(n.body, `You earned Br ${Math.round(week).toLocaleString('en-US')} interest this week in My savings. Balance Br ${Math.round(balance).toLocaleString('en-US')}.`)
  assert.equal(planNotifications(user(), MONDAY).length, 0)
})

test('goal reached: sent once per account and target', () => {
  // Crossed this week: a deposit on Nov 20 took the balance past 50,000.
  const recent = [{ type: 'deposit', amount: 60000, date: '2026-11-20', no_fee: false }]
  const u = user({ accounts: [account({ goal: { target: 50000, monthly: 0 }, transactions: recent })] })
  const goal = planNotifications(u, MONDAY).find(n => n.kind === 'goal')
  assert.equal(goal.key, 'acc:50000')
  assert.match(goal.body, /passed your Br 50,000 goal/)
  assert.equal(planNotifications({ ...u, sent: ['goal|acc:50000'] }, MONDAY).filter(n => n.kind === 'goal').length, 0, 'not twice')
  const higher = user({ accounts: [account({ goal: { target: 500000, monthly: 0 } })] })
  assert.equal(planNotifications(higher, MONDAY).filter(n => n.kind === 'goal').length, 0, 'not before it is reached')
})

test('monthly reminder: on the chosen day, once a month, only with a monthly amount', () => {
  const u = user({ settings: { reminder_day: 23 }, accounts: [account({ goal: { target: null, monthly: 10000 } })] })
  const r = planNotifications(u, MONDAY).find(n => n.kind === 'reminder')
  assert.equal(r.key, 'acc:2026-11')
  assert.match(r.body, /Br 10,000 deposit to My savings/)
  assert.equal(planNotifications(u, '2026-11-24').filter(n => n.kind === 'reminder').length, 0, 'other days: nothing')
  assert.equal(planNotifications(user({ settings: { reminder_day: 23 } }), MONDAY).filter(n => n.kind === 'reminder').length, 0, 'no monthly amount: nothing')
})

test('switched off means off', () => {
  const u = user({ settings: { weekly: false, goal: false, reminder: false, reminder_day: 22 }, accounts: [account({ goal: { target: 1, monthly: 5 } })] })
  assert.deepEqual(planNotifications(u, SUNDAY), [])
})

test('several accounts: one weekly summary adding them up; a member\'s own rate is used', () => {
  const u = user({ accounts: [account(), account({ id: 'b', name: 'Family pot', my_rates: [{ from: '2026-01-01', annual_rate: 2 }] })] })
  const weekly = planNotifications(u, SUNDAY).filter(n => n.kind === 'weekly')
  assert.equal(weekly.length, 1)
  assert.ok(!weekly[0].body.includes(' in '), 'no single account named')
})

test('a goal passed long ago is not announced when notifications start', () => {
  // 100,000 since October, goal 50,000: passed weeks before; no "Goal reached" now.
  const u = user({ accounts: [account({ goal: { target: 50000, monthly: 0 } })] })
  assert.equal(planNotifications(u, MONDAY).filter(n => n.kind === 'goal').length, 0)
})
