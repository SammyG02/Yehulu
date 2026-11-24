import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAccounts, cloudApi } from './cloud.js'

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
    { account_id: 'b', user_id: 'g-1', role: 'guest', guest_name: 'Grandma', goal_target: null, goal_monthly: 0, joined_at: '2026-11-04T10:00:00Z' },
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
  assert.deepEqual(group.members.map(m => [m.id, m.role, m.name]),
    [[FRIEND, 'owner', 'Friend'], [ME, 'member', 'Me Myself'], ['g-1', 'guest', 'Grandma']])
  assert.equal(group.members[0].avatarUrl, 'https://example.com/f.png')
})

test('name-only members are named by the owner and marked as guests', () => {
  const grandma = buildAccounts(rows)[1].members.find(m => m.id === 'g-1')
  assert.deepEqual(grandma, {
    id: 'g-1', role: 'guest', guest: true, name: 'Grandma', avatarUrl: null, goal: { target: null, monthly: 0 }, rates: null,
  })
})

test("each member's own goal comes along, for viewing as them", () => {
  const friend = buildAccounts(rows)[1].members.find(m => m.id === FRIEND)
  assert.deepEqual(friend.goal, { target: 9000, monthly: 0 })
})

test('transactions keep whose they are; amounts become numbers', () => {
  const group = buildAccounts(rows)[1]
  assert.deepEqual(group.transactions, [{ id: 't1', type: 'deposit', amount: 1500.5, date: '2026-11-04', note: '', memberId: ME }])
  assert.deepEqual(group.activity.map(a => [a.memberKey, a.amount]), [['k1', 1500.5], ['k2', 800]])
})

test("a member's own rate comes along; without one they earn the account rate", async () => {
  const { ratesOf } = await import('./storage.js')
  const withRate = rows.members.map(m => (m.user_id === 'g-1' ? { ...m, rates: [{ from: '2026-01-01', annual_rate: 2 }] } : m))
  const account = buildAccounts({ ...rows, members: withRate })[1]
  assert.deepEqual(account.members.find(m => m.id === 'g-1').rates, [{ from: '2026-01-01', annualRate: 2, serviceCharge: 10 }])
  assert.deepEqual(ratesOf(account, 'g-1'), [{ from: '2026-01-01', annualRate: 0.02, serviceCharge: 0.1 }])
  assert.deepEqual(ratesOf(account, ME), account.rates.map(r => ({ ...r, annualRate: r.annualRate / 100, serviceCharge: r.serviceCharge / 100 })))
})

/** A pretend database: records each call and answers with `error`. */
const pretend = (error = null) => {
  const calls = []
  return { calls, api: cloudApi({ rpc: async (name, args) => { calls.push([name, args]); return { data: 1, error } }, from: () => { throw new Error('separate request') } }) }
}
const MISSING = { code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' }
const MOVES = [{ id: 't1', from: '2026-11-01', date: '2026-11-02' }]

test('an import saves corrected dates in the same single call', async () => {
  const { api, calls } = pretend()
  assert.equal(await api.importStatement('a', ME, [], ['b1'], null, null, MOVES), true)
  assert.deepEqual(calls.map(c => c[0]), ['import_statement_dated'])
  assert.deepEqual(calls[0][1].moves, [{ id: 't1', from: '2026-11-01', to: '2026-11-02' }])
})

test('an import without corrected dates works on a database without migration 014', async () => {
  const { api, calls } = pretend()
  await api.importStatement('a', ME, [], [], null, null)
  assert.deepEqual([calls[0][0], 'moves' in calls[0][1]], ['import_statement', false])
  assert.equal(await pretend(MISSING).api.importStatement('a', ME, [], [], null, null), false, 'the caller saves it the older way')
})

test('corrected dates are refused, never saved in pieces, on a database without migration 014', async () => {
  const { api, calls } = pretend(MISSING)
  await assert.rejects(api.importStatement('a', ME, [], [], null, null, MOVES), /014.*Nothing was changed/)
  assert.equal(calls.length, 1)
})

test('any other failure is reported as it is, not as a missing update', async () => {
  for (const error of [
    { code: '42501', message: 'permission denied for function import_statement_dated' },
    { code: 'P0001', message: 'Some of these lines changed meanwhile.' },
    { code: '', message: 'TypeError: Failed to fetch' },
  ]) await assert.rejects(pretend(error).api.importStatement('a', ME, [], [], null, null, MOVES), { message: error.message })
  await assert.rejects(pretend({ code: '42501', message: 'permission denied for function remove_statement_lines' }).api.removeStatementLines('a', ME, [], []), /permission denied/)
})
