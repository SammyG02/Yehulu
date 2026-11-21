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

const call = async ({ auth = `Bearer ${KEY}`, method = 'GET', query = {}, db, check = { ok: true, user_id: ME }, handle = handler, body }) => {
  const sent = []
  globalThis.fetch = async (url, init) => {
    sent.push({ url, body: JSON.parse(init.body) })
    if (url.endsWith('/app_check')) return { ok: true, json: async () => check }
    return { ok: true, json: async () => db }
  }
  const res = {
    statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v },
    status(c) { this.statusCode = c; return this },
    send(b) { this.body = b; return this },
  }
  await handle({ method, headers: { authorization: auth }, query, body }, res)
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
  assert.equal((await call({ db, check: { ok: false, reason: 'key' } })).status, 401)
  assert.equal((await call({ method: 'POST', db })).status, 405, 'read-only')
})

test('the key goes to the database check; the response never echoes it', async () => {
  const r = await call({ db })
  assert.equal(r.status, 200)
  assert.equal(r.sent[0].body.access_key, KEY)
  assert.ok(r.sent[0].url.endsWith('/app_check') && r.sent[1].url.endsWith('/app_read'))
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

test('too many requests -> 429 with Retry-After, and no data is read', async () => {
  const r = await call({ db, check: { ok: false, reason: 'limit', retry_after: 42 } })
  assert.equal(r.status, 429)
  assert.equal(r.headers['Retry-After'], '42')
  assert.equal(r.json.retry_after, 42)
  assert.equal(r.sent.length, 1, 'stopped before reading any data')
})

// ---- goal calculator --------------------------------------------------------------

const { default: goal, duration } = await import('../../api/chinka/v1/goal.js')
const { planGoal } = await import('./interest.js')

test('goal: 100,000 saving 10,000 a month to 500,000 at 40% -> same date as the app planner', async () => {
  const r = await call({ handle: goal, db, query: { target: '500000', amount: '100000', monthly: '10000', rate: '40' } })
  assert.equal(r.status, 200)
  const today = r.json.today
  const app = planGoal({
    transactions: [{ id: 's', type: 'deposit', amount: 100000, date: today }],
    rates: [{ from: today, annualRate: 0.4, serviceCharge: 0.1 }], today, target: 500000, monthlyDeposit: 10000,
  })
  assert.equal(r.json.reached, true)
  assert.equal(r.json.goal.date, app.date)
  assert.equal(r.json.goal.interest_from_today, Math.round(app.interest * 100) / 100)
  assert.ok(r.json.goal.takes.text.includes('year'))
  assert.equal(r.json.yearly.length, Math.ceil(app.days / 365))
})

test('goal: "by" gives the monthly deposit needed, and it really gets there', async () => {
  const r = await call({ handle: goal, db, query: { target: '200000', amount: '50000', by: '2028-12-31' } })
  const need = r.json.by.monthly_needed
  assert.equal(r.json.by.possible, true)
  const today = r.json.today
  const at = (m) => planGoal({ transactions: [{ id: 's', type: 'deposit', amount: 50000, date: today }], rates: [{ from: today, annualRate: 0.4, serviceCharge: 0.1 }], today, target: 200000, monthlyDeposit: m })
  assert.ok(at(need).date <= '2028-12-31', 'enough')
  assert.ok(need === 0 || at(need - 1).date > '2028-12-31', 'and not a Birr more than needed')
})

test('goal: bad input -> 400 with what is wrong; never reached -> said so', async () => {
  const bad = await call({ handle: goal, db, query: { target: '-5', rate: '500', by: 'soon' } })
  assert.equal(bad.status, 400)
  assert.match(bad.json.error, /target.*rate.*by/)
  const never = await call({ handle: goal, db, query: { target: '1000000000', amount: '10', rate: '0' } })
  assert.equal(never.json.reached, false)
})

test('goal: from a real account starts at its balance and rate', async () => {
  const r = await call({ handle: goal, db, query: { target: '400000', account: 'acc-1' } })
  const data = await call({ db, query: { daily: '0' } })
  assert.equal(r.json.input.start_balance, data.json.accounts[0].you.balance)
  assert.equal(r.json.input.rate, 40)
  assert.equal((await call({ handle: goal, db, query: { target: '1', account: 'nope' } })).status, 404)
})

test('goal: limits apply here too', async () => {
  assert.equal((await call({ handle: goal, db, query: { target: '1' }, check: { ok: false, reason: 'limit', retry_after: 3 } })).status, 429)
})

test('durations read naturally', () => {
  assert.equal(duration('2026-01-15', '2027-03-20').text, '1 year, 2 months, 5 days')
  assert.equal(duration('2026-01-15', '2026-01-15').text, 'today')
})
