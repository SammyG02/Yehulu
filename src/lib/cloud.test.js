import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildAccounts, cloudApi, seenOf } from './cloud.js'

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

/** A pretend database: answers each call with the next of `answers` (the last one again after that). */
const pretend = (...answers) => {
  const calls = []
  const api = cloudApi({
    rpc: (name, args) => {
      calls.push([name, args])
      const answer = answers[Math.min(calls.length, answers.length) - 1]
      return Object.assign(Promise.resolve(answer), {
        abortSignal: (signal) => (answer === 'silence'
          ? new Promise(r => signal.addEventListener('abort', () => r({ data: null, error: { code: '', message: 'AbortError: aborted' } })))
          : Promise.resolve(answer)),
      })
    },
    from: () => { throw new Error('separate request') },
  })
  return { calls, api }
}
const SAVED = { data: { account_id: 'a', added: 1 }, error: null }
const LOST = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }
const refused = (code, message) => ({ data: null, error: { code, message } })
const IMPORT = {
  importId: 'i1', accountId: 'a', memberId: ME, newAccount: { name: 'New', yehuluNo: '300', refs: ['y:300:a'] }, seen: seenOf([]),
  rows: [{ id: 'x', type: 'withdrawal', amount: 10, date: '2026-03-01', noFee: true, ref: 'y:300:a', source: 's', memberId: ME }],
  removeIds: ['b'], accountRates: [{ from: '2026-01-01', annualRate: 35 }], memberRates: null, moves: [{ id: 't', from: '2026-11-01', date: '2026-11-02' }],
}

test('an import is one request with everything in it', async () => {
  const { api, calls } = pretend(SAVED)
  assert.deepEqual(await api.saveImport(IMPORT), { accountId: 'a', added: 1 })
  assert.deepEqual(calls, [['save_import', { req: {
    import_id: 'i1', account_id: 'a', member_id: ME, seen: { count: 0, cents: 0, days: 0 },
    new_account: { name: 'New', yehulu_no: '300', refs: ['y:300:a'] },
    rows: [{ id: 'x', type: 'withdrawal', amount: 10, date: '2026-03-01', note: '', no_fee: true, ref: 'y:300:a', source: 's' }],
    remove_ids: ['b'], account_rates: [{ from: '2026-01-01', annual_rate: 35 }], member_rates: null,
    moves: [{ id: 't', from: '2026-11-01', to: '2026-11-02' }],
  } }]])
})

test('an import without an answer is asked again with the same id, once', async () => {
  for (const nothing of [LOST, 'silence', refused(undefined, '<html>502</html>'), refused('08006', 'connection lost'), refused('57P01', 'shutting down'), refused('PGRST000', 'no connection')]) {
    const again = pretend(nothing, SAVED)
    assert.deepEqual(await again.api.saveImport(IMPORT, [20, 20]), { accountId: 'a', added: 1 })
    assert.deepEqual(again.calls[0], again.calls[1])
    const never = pretend(nothing)
    await assert.rejects(never.api.saveImport(IMPORT, [20, 20]), (err) => err.unknown === true && /never saved twice/.test(err.message))
    assert.equal(never.calls.length, 2)
  }
})

test('an import the database refuses is not asked again, and its own words are shown', async () => {
  for (const [code, message] of [['P0001', 'This account has just changed.'], ['42501', 'permission denied for function save_import'], ['23514', 'bad row'], ['57014', 'statement timeout'], ['PGRST301', 'JWT expired']]) {
    const { api, calls } = pretend(refused(code, message))
    await assert.rejects(api.saveImport(IMPORT), (err) => !err.unknown && err.message === message)
    assert.equal(calls.length, 1)
  }
  await assert.rejects(pretend(refused('PGRST202', 'Could not find the function')).api.saveImport(IMPORT), /016.*Nothing was changed/)
})

test('seenOf: any change to the transactions shows', () => {
  const a = { type: 'deposit', amount: 10.1, date: '2026-01-02' }
  const b = { type: 'withdrawal', amount: 0.2, date: '2026-01-03' }
  assert.deepEqual(seenOf([a, b]), { count: 2, cents: 990, days: 20455 + 20456 })
  for (const other of [[a], [a, { ...b, amount: 0.3 }], [a, { ...b, date: '2026-01-04' }], [a, { ...b, type: 'deposit' }]]) assert.notDeepEqual(seenOf(other), seenOf([a, b]))
})

test('removing a statement: a refusal is not mistaken for a missing update', async () => {
  await assert.rejects(pretend(refused('42501', 'permission denied for function remove_statement_lines')).api.removeStatementLines('a', ME, [], []), /permission denied/)
  assert.equal(await pretend(refused('PGRST202', 'Could not find the function')).api.removeStatementLines('a', ME, [], []), false)
})
