import { SERVICE_CHARGE, sanitizeGoal, sanitizeRates } from './storage.js'

/**
 * Shared accounts stored in Supabase (see supabase/migrations).
 *
 * buildAccounts turns database rows into the same account shape the app uses
 * on the device, plus the sharing details:
 *   { id, name, rates, goal, transactions, cloud: true, role, ownerId,
 *     membersSeeAll, inviteCode, members: [{ id, name, avatarUrl, role, guest, rates }],
 *     activity: [{ memberKey, type, amount, date, rates }] }
 * A member's `rates` is their own rate history, or null to earn the account's.
 * `transactions` holds every transaction the user may see, each with a
 * memberId. `activity` is every transaction in the account without names,
 * for the account total.
 */
export function buildAccounts({ userId, accounts, members, profiles, rates, transactions, activity }) {
  const profileById = new Map(profiles.map(p => [p.id, p]))
  const byAccount = (rows) => {
    const map = new Map()
    for (const row of rows) {
      const list = map.get(row.account_id) ?? []
      list.push(row)
      map.set(row.account_id, list)
    }
    return map
  }
  const membersOf = byAccount(members)
  const ratesOf = byAccount(rates)
  const txnsOf = byAccount(transactions)

  return accounts
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(a => {
      const accountMembers = (membersOf.get(a.id) ?? [])
        .slice()
        .sort((x, y) => (x.role === 'owner' ? -1 : y.role === 'owner' ? 1 : x.joined_at.localeCompare(y.joined_at)))
      const mine = accountMembers.find(m => m.user_id === userId)
      let accountRates = sanitizeRates((ratesOf.get(a.id) ?? []).map(r => ({
        from: r.from_date, annualRate: Number(r.annual_rate), serviceCharge: SERVICE_CHARGE,
      })))
      if (accountRates.length === 0) {
        accountRates = [{ from: a.created_at.slice(0, 10), annualRate: 40, serviceCharge: SERVICE_CHARGE }]
      }
      return {
        id: a.id,
        name: a.name,
        cloud: true,
        ownerId: a.owner_id,
        role: mine?.role ?? 'member',
        membersSeeAll: a.members_see_all,
        inviteCode: a.invite_code ?? null,
        rates: accountRates,
        goal: sanitizeGoal({ target: mine?.goal_target, monthly: mine?.goal_monthly }),
        members: accountMembers.map(m => ({
          id: m.user_id,
          role: m.role,
          // Name-only members (no sign-in) are named by the owner.
          guest: m.role === 'guest',
          name: (m.role === 'guest' ? m.guest_name : profileById.get(m.user_id)?.name) || 'Member',
          avatarUrl: m.role === 'guest' ? null : profileById.get(m.user_id)?.avatar_url ?? null,
          goal: sanitizeGoal({ target: m.goal_target, monthly: m.goal_monthly }),
          rates: memberRatesFrom(m.rates),
        })),
        transactions: (txnsOf.get(a.id) ?? []).map(fromRow),
        activity: (activity.get(a.id) ?? []).map(r => ({
          memberKey: r.member_key, type: r.type, amount: Number(r.amount), date: r.date, noFee: Boolean(r.no_fee),
          rates: memberRatesFrom(r.member_rates),
        })),
      }
    })
}

/** A member's own rates from the database (or null: they earn the account rate). */
const memberRatesFrom = (json) => {
  if (!Array.isArray(json) || json.length === 0) return null
  const rates = sanitizeRates(json.map(r => ({ from: r.from, annualRate: Number(r.annual_rate), serviceCharge: SERVICE_CHARGE })))
  return rates.length ? rates : null
}

const fromRow = (t) => ({
  id: t.id,
  type: t.type,
  amount: Number(t.amount),
  date: t.date,
  note: t.note ?? '',
  memberId: t.member_id,
  ...(t.no_fee ? { noFee: true } : {}),
  ...(t.ref ? { ref: t.ref } : {}),
})

const check = ({ data, error }) => {
  if (error) throw new Error(error.message)
  return data
}

/** Everything the signed-in user can see, in the app's account shape. */
// Supabase returns at most 1,000 rows per request and quietly drops the rest,
// so long lists are read page by page, in a fixed order (no row skipped or
// read twice between pages).
const PAGE = 1000
export async function readAll(query) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const page = check(await query().range(from, from + PAGE - 1))
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

/** The anonymous activity list, page by page (ordered by its row id once the database has it). */
async function readActivity(client, accountId) {
  try {
    return await readAll(() => client.rpc('account_activity', { acc: accountId }).order('row_id'))
  } catch (err) {
    // Database without migration 005 yet: one request (fine below 1,000 rows).
    if (!/row_id/.test(err.message)) throw err
    return check(await client.rpc('account_activity', { acc: accountId }))
  }
}

export async function fetchAccounts(client, userId) {
  const [accounts, members, profiles, rates, transactions] = await Promise.all([
    readAll(() => client.from('accounts').select('*').order('id')),
    readAll(() => client.from('account_members').select('*').order('account_id').order('user_id')),
    readAll(() => client.from('profiles').select('*').order('id')),
    readAll(() => client.from('rates').select('*').order('account_id').order('from_date')),
    readAll(() => client.from('transactions').select('*').order('date').order('created_at').order('id')),
  ])
  const activity = new Map(await Promise.all(accounts.map(async a => [a.id, await readActivity(client, a.id)])))
  return buildAccounts({ userId, accounts, members, profiles, rates, transactions, activity })
}

const toRateRows = (accountId, rates) =>
  rates.map(r => ({ account_id: accountId, from_date: r.from, annual_rate: r.annualRate }))

const toTxnRow = (accountId, t) => ({
  id: t.id, account_id: accountId, member_id: t.memberId, type: t.type, amount: t.amount, date: t.date, note: t.note ?? '',
  // Only sent when used, so adding ordinary transactions keeps working on a
  // database without these columns yet.
  ...(t.type === 'withdrawal' && t.noFee ? { no_fee: true } : {}),
  ...(t.ref ? { ref: t.ref } : {}),
})

/** Every change the app can make, one function each. All throw on failure. */
export const cloudApi = (client) => ({
  async createAccount({ id, name, rates, transactions = [], goal }, userId) {
    check(await client.from('accounts').insert({ id, name, owner_id: userId }).select('id'))
    check(await client.from('rates').insert(toRateRows(id, rates)))
    if (transactions.length) {
      check(await client.from('transactions').insert(transactions.map(t => toTxnRow(id, { ...t, memberId: userId }))))
    }
    if (goal?.target || goal?.monthly) await this.setGoal(id, userId, goal)
  },
  async renameAccount(accountId, name) {
    check(await client.from('accounts').update({ name }).eq('id', accountId))
  },
  async deleteAccount(accountId) {
    check(await client.from('accounts').delete().eq('id', accountId))
  },
  async setRates(accountId, rates) {
    // Replace the whole history: remove what's gone, upsert the rest.
    const keep = rates.map(r => r.from)
    check(await client.from('rates').delete().eq('account_id', accountId).not('from_date', 'in', `(${keep.join(',')})`))
    check(await client.from('rates').upsert(toRateRows(accountId, rates)))
  },
  async setGoal(accountId, userId, goal) {
    check(await client.from('account_members')
      .update({ goal_target: goal.target, goal_monthly: goal.monthly || 0 })
      .eq('account_id', accountId).eq('user_id', userId))
  },
  async addTransaction(accountId, txn) {
    check(await client.from('transactions').insert(toTxnRow(accountId, txn)))
  },
  /** Many at once (statement import), in chunks the server accepts. */
  async addTransactions(accountId, txns) {
    for (let i = 0; i < txns.length; i += 500) {
      const rows = txns.slice(i, i + 500).map(t => toTxnRow(accountId, t))
      // A statement line that's already there (another phone imported it a
      // moment ago) is skipped by the database, never added twice.
      const { error } = await client.from('transactions')
        .upsert(rows, { onConflict: 'account_id,member_id,ref', ignoreDuplicates: true })
      if (!error) continue
      // Database without migration 005 yet: plain insert (the app already
      // left out lines it knows are there).
      if (!/no unique|ON CONFLICT/i.test(error.message)) throw new Error(error.message)
      check(await client.from('transactions').insert(rows))
    }
  },
  async updateTransaction(id, changes) {
    const { type, amount, date, note, noFee, hadNoFee } = changes
    const row = { type, amount, date, note: note ?? '' }
    if (noFee || hadNoFee) row.no_fee = type === 'withdrawal' && Boolean(noFee)
    check(await client.from('transactions').update(row).eq('id', id))
  },
  async deleteTransaction(id) {
    check(await client.from('transactions').delete().eq('id', id))
  },
  async setMembersSeeAll(accountId, value) {
    check(await client.from('accounts').update({ members_see_all: value }).eq('id', accountId))
  },
  async setInvite(accountId, enabled) {
    return check(await client.rpc('set_invite', { acc: accountId, enabled }))
  },
  async removeMember(accountId, userId) {
    check(await client.from('account_members').delete().eq('account_id', accountId).eq('user_id', userId))
  },
  /** Adds someone by name (no sign-in). Returns their member id. */
  async addGuest(accountId, name) {
    return check(await client.rpc('add_guest', { acc: accountId, guest: name }))
  },
  /** Owner: a member's own rates, or null to use the account rate again. */
  async setMemberRates(accountId, memberId, rates) {
    const json = rates ? rates.map(r => ({ from: r.from, annual_rate: r.annualRate })) : null
    check(await client.rpc('set_member_rates', { acc: accountId, member: memberId, new_rates: json }))
  },
  async renameGuest(accountId, guestId, name) {
    check(await client.rpc('rename_guest', { acc: accountId, guest: guestId, new_name: name }))
  },
  async invitePreview(code) {
    return check(await client.rpc('invite_preview', { code }))?.[0] ?? null
  },
  async joinAccount(code) {
    return check(await client.rpc('join_account', { code }))
  },
})
