import { test } from 'node:test'
import assert from 'node:assert/strict'
import { simulateLedger, summarize } from './interest.js'

// The Chinka endpoint (api/chinka/v1/data.js), with the database call faked.
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'
const { default: handler } = await import('../../api/chinka/v1/data.js')

const KEY = 'ykn_' + 'a'.repeat(64)
const ME = 'u-me'
const FRIEND = 'u-friend'

const call = async ({ auth = `Bearer ${KEY}`, method = 'GET', query = {}, db }) => {
  const sent = []
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) })
    return { ok: true, json: async () => db }
  }
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    send(b) { this.body = b; return this },
  }
  await handler({ method, headers: { authorization: auth }, query }, res)
  return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, headers: res.headers, sent }
}

const db = {
  app: 'chinka',
  user: { id: ME, name: 'Samuel' },
  accounts: [{
    id: 'acc-1', name: 'Family pot', role: 'owner', members_see_all: true,
    goal: { target: 500000, monthly: 10000 },
    rates: [{ from: '2025-01-01', annual_rate: 40 }],
    members: [{ id: ME, role: 'owner', name: 'Samuel', rates: null }, { id: FRIEND, role: 'member', name: 'Hana', rates: [{ from: '2025-01-01', annual_rate: 2 }] }],
    transactions: [
      { id: 't1', member_id: ME, type: 'deposit', amount: 200000, date: '2026-10-05', note: '', no_fee: false, ref: null },
      { id: 't2', member_id: ME, type: 'withdrawal', amount: 5000, date: '2026-10-20', note: '', no_fee: false, ref: 'y:3000:x' },
      { id: 't3', member_id: FRIEND, type: 'deposit', amount: 100000, date: '2026-10-01', note: '', no_fee: false, ref: null },
    ],
  }],
}

test('no key, a malformed key, or a disconnected key -> 401, and nothing is read', async () => {
  assert.equal((await call({ auth: '', db })).status, 401)
  const bad = await call({ auth: 'Bearer hello', db })
  assert.equal(bad.status, 401)
  assert.equal(bad.sent.length, 0, 'never asks the database with a malformed key')
  assert.equal((await call({ db: null })).status, 401, 'unknown / disconnected key')
  assert.equal((await call({ method: 'POST', db })).status, 405, 'read-only')
})

test('the key goes to the database check; the response never echoes it', async () => {
  const r = await call({ db })
  assert.equal(r.status, 200)
  assert.equal(r.sent[0].body.access_key, KEY)
  assert.ok(!JSON.stringify(r.json).includes(KEY))
  assert.equal(r.headers['Cache-Control'], 'no-store')
})

test("balances and interest are the app's own numbers, each person at their own rate", async () => {
  const r = await call({ db })
  const acc = r.json.accounts[0]
  const today = r.json.today
  const mine = summarize(simulateLedger({
    transactions: [{ type: 'deposit', amount: 200000, date: '2026-10-05' }, { type: 'withdrawal', amount: 5000, date: '2026-10-20' }],
    rates: [{ from: '2025-01-01', annualRate: 0.4, serviceCharge: 0.1 }], fromDate: today, endDate: today,
  }), today)
  assert.equal(acc.you.balance, Math.round(mine.balance * 100) / 100)
  assert.equal(acc.you.fees_paid, 10)
  const hana = acc.members.find(m => m.id === FRIEND)
  assert.ok(hana.balance > 100000 && hana.balance < 101000, 'Hana earns 2%, not 40%')
  assert.equal(acc.total_balance, Math.round((acc.members[0].balance + hana.balance) * 100) / 100)
  assert.equal(acc.transactions.find(t => t.id === 't2').fee, 10)
  assert.equal(acc.transactions.find(t => t.id === 't2').from_statement, true)
  assert.ok(acc.you.daily.length > 0 && acc.you.daily.every(d => d.date < today))
  assert.ok(acc.you.monthly.length > 0)
})

test('?daily=0 leaves out the daily rows; ?account= picks one account', async () => {
  assert.equal((await call({ db, query: { daily: '0' } })).json.accounts[0].you.daily, undefined)
  assert.equal((await call({ db, query: { account: 'nope' } })).json.accounts.length, 0)
})

test("a member who may not see everyone's money gets no member list or totals", async () => {
  const limited = structuredClone(db)
  limited.accounts[0].role = 'member'
  limited.accounts[0].members_see_all = false
  const acc = (await call({ db: limited })).json.accounts[0]
  assert.equal(acc.members, undefined)
  assert.equal(acc.total_balance, undefined)
})
