import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAccounts } from './cloud.js'

const ME = 'u-me'
const FRIEND = 'u-friend'
const rows = {
  userId: ME,
  accounts: [
    { id: 'b', name: 'Group', owner_id: FRIEND, members_see_all: false, invite_code: null, created_at: '2026-11-02T10:00:00Z' },
    { id: 'a', name: 'Mine', owner_id: ME, members_see_all: true, invite_code: 'xyz', created_at: '2026-11-01T10:00:00Z' },
  ],
  members: [
    { account_id: 'a', user_id: ME, role: 'owner', goal_target: 5000, goal_monthly: 200, joined_at: '2026-11-01T10:00:00Z' },
    { account_id: 'b', user_id: ME, role: 'member', goal_target: null, goal_monthly: 0, joined_at: '2026-11-03T10:00:00Z' },
    { account_id: 'b', user_id: FRIEND, role: 'owner', goal_target: 9000, goal_monthly: 0, joined_at: '2026-11-02T10:00:00Z' },
  ],
  profiles: [
    { id: ME, name: 'Me Myself', avatar_url: null },
    { id: FRIEND, name: 'Friend', avatar_url: 'https://example.com/f.png' },
  ],
  rates: [
    { account_id: 'a', from_date: '2026-11-01', annual_rate: '40.000' },
    { account_id: 'a', from_date: '2026-10-01', annual_rate: '35' },
  ],
  transactions: [
    { id: 't1', account_id: 'b', member_id: ME, type: 'deposit', amount: '1500.50', date: '2026-11-04', note: null },
  ],
  activity: new Map([['b', [
    { member_key: 'k1', type: 'deposit', amount: '1500.50', date: '2026-11-04' },
    { member_key: 'k2', type: 'deposit', amount: '800', date: '2026-11-05' },
  ]]]),
}

test('accounts come back oldest first, with my role and my own goal', () => {
  const [mine, group] = buildAccounts(rows)
  assert.deepEqual([mine.id, group.id], ['a', 'b'])
  assert.equal(mine.role, 'owner')
  assert.equal(group.role, 'member')
  assert.deepEqual(mine.goal, { target: 5000, monthly: 200 })
  // My goal in the group, not the owner's.
  assert.deepEqual(group.goal, { target: null, monthly: 0 })
  assert.equal(mine.inviteCode, 'xyz')
  assert.equal(group.membersSeeAll, false)
})

test('rates are sorted, numeric, and always carry the fixed 10% charge', () => {
  const [mine, group] = buildAccounts(rows)
  assert.deepEqual(mine.rates, [
    { from: '2026-10-01', annualRate: 35, serviceCharge: 10 },
    { from: '2026-11-01', annualRate: 40, serviceCharge: 10 },
  ])
  // No rates saved (shouldn't happen): a sensible default from the start.
  assert.deepEqual(group.rates, [{ from: '2026-11-02', annualRate: 40, serviceCharge: 10 }])
})

test('members list the owner first, with names from profiles', () => {
  const group = buildAccounts(rows)[1]
  assert.deepEqual(group.members.map(m => [m.id, m.role, m.name]), [[FRIEND, 'owner', 'Friend'], [ME, 'member', 'Me Myself']])
  assert.equal(group.members[0].avatarUrl, 'https://example.com/f.png')
})

test('transactions keep whose they are; amounts become numbers', () => {
  const group = buildAccounts(rows)[1]
  assert.deepEqual(group.transactions, [{ id: 't1', type: 'deposit', amount: 1500.5, date: '2026-11-04', note: '', memberId: ME }])
  assert.deepEqual(group.activity.map(a => [a.memberKey, a.amount]), [['k1', 1500.5], ['k2', 800]])
})
