// GET /api/chinka/v1/data  - read-only Yehulu data for a connected app (Chinka).
//
//   Authorization: Bearer ykn_...      (the access key the user created in Yehulu)
//   ?account=<id>   only that account
//   ?daily=0        leave out the day-by-day interest rows (smaller response)
//
// The key decides whose data and which accounts; the database checks it
// (app_read in migration 008). Balances and interest are worked out with the
// app's own interest code, so they're the same numbers the user sees.
// See docs/chinka-api.md.

import { feeOf, interestByMonth, simulateLedger, summarize } from '../../../src/lib/interest.js'
import { admit, rpc, send, todayInAddis } from '../../_lib/app.js'

const SERVICE_CHARGE = 10

const round2 = (x) => Math.round(x * 100) / 100
const toFractions = (rates) => rates.map(r => ({ from: r.from, annualRate: Number(r.annual_rate) / 100, serviceCharge: SERVICE_CHARGE / 100 }))
const asTxn = (t) => ({ id: t.id, type: t.type, amount: Number(t.amount), date: t.date, noFee: Boolean(t.no_fee) })

/** One person's money in an account: balance, interest and (optionally) every day. */
function money(transactions, rates, today, withDaily) {
  if (!transactions.length || !rates.length) {
    return { balance: 0, interest: { to_date: 0, this_month: 0, today: 0 }, monthly: [], daily: withDaily ? [] : undefined }
  }
  const ledger = simulateLedger({ transactions, rates, fromDate: today, endDate: today })
  const s = summarize(ledger, today)
  return {
    balance: round2(s.balance),
    deposited: round2(s.deposited),
    withdrawn: round2(s.withdrawn),
    fees_paid: round2(s.feesPaid),
    interest: { to_date: round2(s.interestToDate), this_month: round2(s.interestThisMonth), today: round2(s.interestToday) },
    monthly: interestByMonth(ledger, today).map(m => ({ month: m.month, interest: round2(m.interest), balance: round2(m.balance), so_far: m.current })),
    daily: withDaily
      ? ledger.filter(r => r.date < today).map(r => ({
        date: r.date, balance: r.balance, interest: r.grossInterest, service_charge: r.serviceCharge, credited: r.interest,
        deposits: r.deposits, withdrawals: r.withdrawals, fees: r.fees,
      }))
      : undefined,
  }
}

export default async function handler(req, res) {
  const key = await admit(req, res, ['GET'])
  if (!key) return

  let data
  try {
    data = await rpc('app_read', { access_key: key })
  } catch {
    return send(res, 502, { error: 'Yehulu is unavailable. Try again shortly.' })
  }
  if (!data) return send(res, 401, { error: 'This access key is not valid or was disconnected by the user.' })

  const today = todayInAddis()
  const withDaily = req.query?.daily !== '0'
  const only = typeof req.query?.account === 'string' ? req.query.account : null
  const uid = data.user?.id

  const accounts = data.accounts
    .filter(a => !only || a.id === only)
    .map(a => {
      const accountRates = a.rates.map(x => ({ from: x.from, annual_rate: x.annual_rate }))
      const ratesFor = (memberId) => {
        const own = a.members.find(m => m.id === memberId)?.rates
        return toFractions(Array.isArray(own) && own.length ? own : accountRates)
      }
      const all = a.transactions
      const of = (memberId) => all.filter(t => t.member_id === memberId).map(asTxn)
      const seesAll = a.role === 'owner' || a.members_see_all
      const memberIds = [...new Set([...a.members.map(m => m.id), ...all.map(t => t.member_id)])]
      const members = seesAll
        ? memberIds.map(id => {
          const m = a.members.find(x => x.id === id)
          const mm = money(of(id), ratesFor(id), today, false)
          return { id, name: m?.name ?? '', role: m?.role ?? 'member', is_you: id === uid, balance: mm.balance, interest_to_date: mm.interest.to_date }
        })
        : undefined
      return {
        id: a.id,
        name: a.name,
        your_role: a.role,
        shared: a.members.length > 1 || (members?.length ?? 0) > 1,
        rates: accountRates.map(x => ({ from: x.from, annual_rate: Number(x.annual_rate), service_charge: SERVICE_CHARGE })),
        your_rates: ratesFor(uid).map(x => ({ from: x.from, annual_rate: round2(x.annualRate * 100), service_charge: SERVICE_CHARGE })),
        goal: { target: a.goal?.target == null ? null : Number(a.goal.target), monthly: Number(a.goal?.monthly ?? 0) },
        you: money(of(uid), ratesFor(uid), today, withDaily),
        total_balance: members ? round2(members.reduce((sum, m) => sum + m.balance, 0)) : undefined,
        members,
        transactions: all.map(t => ({
          id: t.id,
          member_id: t.member_id,
          is_you: t.member_id === uid,
          type: t.type,
          date: t.date,
          amount: Number(t.amount),
          fee: feeOf(asTxn(t)),
          note: t.note,
          from_statement: typeof t.ref === 'string' && t.ref.startsWith('y:'),
          stand_in: typeof t.ref === 'string' && /^(gap|opening)-/.test(t.ref),
        })),
      }
    })

  return send(res, 200, {
    version: 1,
    currency: 'ETB',
    today,
    generated_at: new Date().toISOString(),
    user: { name: data.user?.name ?? '' },
    accounts,
  })
}
