import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildImport, compareWithStatement, mergeRates, parseStatementPages, planImport } from './statement.js'
import { simulateLedger } from './interest.js'

// Made-up statements laid out like a real Yehulu "Account Statement" PDF (the
// positions PDF.js gives): debits right-aligned before the Credit column,
// credits starting in it, the closing balance right-aligned in the last one.
// Real statements hold private details, so none are kept in the code.
const COL = { book: 38, ref: 114, desc: 189, value: 264, debit: 339, credit: 414, balance: 490 }
const W = 5 // width per character, roughly
const text = (str, x, y) => ({ str, x, y, width: str.length * W })
const right = (str, edge, y) => text(str, edge - str.length * W, y)
const money = (cents) => (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })
const DAY = (key) => { const [y, m, d] = key.split('-'); return `${d} ${'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ')[m - 1]} ${y.slice(2)}` }

const header = (y) => [
  text('Account Statement', 38, 732), text('Account :', 38, 715), text('3000123456', 170, 715),
  text('Customer :', 38, 698), text('30011111', 170, 698), text('TEST SAVER', 433, 698),
  ...['Book Date', 'Reference', 'Description', 'Value Date', 'Debit', 'Credit', 'Closing Balance']
    .map((h, i) => text(h, Object.values(COL)[i], y)),
]

/** rows: [{ book, ref, type, value, amount (cents, signed), balance (cents) }] -> one page of items */
const page = (rows, { withHeader = true } = {}) => {
  const items = withHeader ? header(664) : [text('30 September 2026', 496, 768)]
  let y = withHeader ? 640 : 740
  for (const r of rows) {
    items.push(text(DAY(r.book), COL.book, y), text(r.ref.slice(0, 14), COL.ref, y), text(r.ref.slice(14), COL.ref, y - 9))
    items.push(text(r.type, COL.desc, y), text(DAY(r.value ?? r.book), COL.value, y))
    items.push(r.amount < 0 ? right(money(r.amount), 392, y) : text(money(r.amount), COL.credit, y))
    items.push(right(money(r.balance), 542, y))
    y -= 25
  }
  return items
}

/** Builds the rows Yehulu would print for a run of days at `rate` %, with deposits/withdrawals. */
const statementRows = ({ from, days, rate, opening = 0, moves = {} }) => {
  const rows = []
  let bal = opening
  let n = 0
  for (let d = 0; d < days; d++) {
    const date = new Date(`${from}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + d)
    const day = date.toISOString().slice(0, 10)
    const next = new Date(date); next.setUTCDate(next.getUTCDate() + 1)
    const value = next.toISOString().slice(0, 10)
    for (const m of moves[day] ?? []) {
      bal += m.amount
      rows.push({ book: day, ref: `FT${day.replace(/-/g, '')}${m.amount}X`.padEnd(18, 'Q'), type: m.type, amount: m.amount, balance: bal })
    }
    const interest = Math.round(bal * rate / 36500)
    const charge = Math.round(interest / 10)
    const ref = `AAACT${String(++n).padStart(9, '0')}ZZZZ`
    bal += interest
    rows.push({ book: day, ref, type: 'Interest - Capitalise', value, amount: interest, balance: bal })
    bal -= charge
    rows.push({ book: day, ref, type: 'Debit Arrangement', value, amount: -charge, balance: bal })
  }
  return rows
}

test('reads a statement page by page, including pages without the header', () => {
  const rows = statementRows({ from: '2026-03-01', days: 6, rate: 40, moves: { '2026-03-01': [{ type: 'Transfer Credit', amount: 10000000 }] } })
  const s = parseStatementPages([page(rows.slice(0, 7)), page(rows.slice(7), { withHeader: false })])
  assert.equal(s.accountNo, '3000123456')
  assert.equal(s.holder, 'TEST SAVER')
  assert.equal(s.rows.length, rows.length)
  assert.equal(s.opening, 0)
  assert.equal(s.closing, rows.at(-1).balance)
  assert.deepEqual(s.rows[0], { bookDate: '2026-03-01', ref: rows[0].ref, type: 'Transfer Credit', narrative: '', valueDate: '2026-03-01', amount: 10000000, balance: 10000000 })
  assert.equal(s.rows[2].amount < 0, true, 'the charge is a debit')
})

test("refuses things that aren't a Yehulu statement", () => {
  assert.throws(() => parseStatementPages([[text('Hello', 10, 10)]]), /looks like a scan/)
  assert.throws(() => parseStatementPages([[text('Dear customer, thank you for banking with us. Your card is ready.', 10, 10)]]), /doesn't look like/)
})

test('withdrawals lose the 0.2% fee (the app adds it back); standing orders have none', () => {
  const rows = statementRows({
    from: '2026-03-01', days: 4, rate: 40,
    moves: {
      '2026-03-01': [{ type: 'Transfer Credit', amount: 50000000 }],
      '2026-03-02': [{ type: 'Cash Withdrawal', amount: -1002000 }, { type: 'Standing Order', amount: -1000 }],
      '2026-03-03': [{ type: 'Transfer Debit', amount: -3006000 }],
    },
  })
  const imp = buildImport([parseStatementPages([page(rows)])])
  assert.deepEqual(imp.transactions.map(t => [t.type, t.amount, t.noFee, t.date]), [
    ['deposit', 500000, false, '2026-03-01'],
    ['withdrawal', 10000, false, '2026-03-02'],
    ['withdrawal', 10, true, '2026-03-02'],
    ['withdrawal', 30000, false, '2026-03-03'],
  ])
})

test("the app's maths lands on the statement's balance every day, and the rates are found", () => {
  const moves = { '2026-03-01': [{ type: 'Transfer Credit', amount: 30000000 }], '2026-03-20': [{ type: 'Cash Withdrawal', amount: -501000 }] }
  const a = statementRows({ from: '2026-03-01', days: 30, rate: 40, moves })
  const b = statementRows({ from: '2026-03-31', days: 20, rate: 35, opening: a.at(-1).balance })
  const imp = buildImport([parseStatementPages([page([...a, ...b])])])
  assert.deepEqual(imp.rates, [{ from: '2026-03-01', annualRate: 40 }, { from: '2026-03-31', annualRate: 35 }])
  const rates = imp.rates.map(r => ({ from: r.from, annualRate: r.annualRate / 100, serviceCharge: 0.1 }))
  const cmp = compareWithStatement(simulateLedger({ transactions: imp.transactions, rates, fromDate: imp.to, endDate: imp.to }), imp.expected)
  assert.equal(cmp.days, 50)
  assert.equal(cmp.matched, 50)
  assert.equal(cmp.end.app, b.at(-1).balance / 100)
})

test('backdated rate changes: reversed interest is ignored, the recalculated line counts', () => {
  const rows = statementRows({ from: '2026-03-01', days: 5, rate: 40, moves: { '2026-03-01': [{ type: 'Transfer Credit', amount: 10000000 }] } })
  // Yehulu takes back the last day's interest and charge, and re-credits it at 35%.
  const last = rows.at(-2)
  const charge = rows.at(-1)
  let bal = charge.balance
  bal -= charge.amount; rows.push({ ...charge, amount: -charge.amount, balance: bal })
  bal -= last.amount; rows.push({ ...last, amount: -last.amount, balance: bal })
  const redo = Math.round(bal * 35 / 36500)
  bal += redo; rows.push({ ...last, amount: redo, balance: bal })
  bal -= Math.round(redo / 10); rows.push({ ...charge, amount: -Math.round(redo / 10), balance: bal })
  const imp = buildImport([parseStatementPages([page(rows)])])
  assert.equal(imp.expected.size, 5, 'one balance per day')
  assert.equal(imp.expected.get('2026-03-05'), bal / 100)
})

test('overlapping statements: nothing is added twice; the opening balance comes from the oldest', () => {
  const rows = statementRows({ from: '2026-03-01', days: 10, rate: 40, moves: { '2026-03-02': [{ type: 'Transfer Credit', amount: 2000000 }] }, opening: 5000000 })
  const first = parseStatementPages([page(rows.slice(0, 12))])
  const second = parseStatementPages([page(rows.slice(8))])
  const imp = buildImport([second, first])
  assert.equal(imp.transactions.filter(t => t.note.startsWith('Opening')).length, 1)
  assert.equal(imp.transactions.find(t => t.note.startsWith('Opening')).amount, 50000)
  assert.equal(imp.expected.size, 10)
  assert.deepEqual(imp.gaps, [])
})

test('a missing statement in between is reported', () => {
  const rows = statementRows({ from: '2026-03-01', days: 10, rate: 40, opening: 5000000 })
  const imp = buildImport([parseStatementPages([page(rows.slice(0, 4))]), parseStatementPages([page(rows.slice(12))])])
  assert.equal(imp.gaps.length, 1)
})

test('statements of different accounts are refused', () => {
  const rows = statementRows({ from: '2026-03-01', days: 2, rate: 40, opening: 100000 })
  const a = parseStatementPages([page(rows)])
  assert.throws(() => buildImport([a, { ...a, accountNo: '3000999999' }]), /different Yehulu accounts/)
})

// ---- importing into an account, in any order ------------------------------

let ids = 0
const newId = () => `t${++ids}`
const pct = (rates) => rates.map(r => ({ from: r.from, annualRate: r.annualRate / 100, serviceCharge: 0.1 }))
/** Imports statements into `account` ({ transactions, rates }) the way the app does. */
const importInto = (account, statements) => {
  const result = buildImport(statements)
  const found = result.rates.map(r => ({ ...r, serviceCharge: 10 }))
  const plan = planImport({
    existing: account.transactions, lines: result.transactions.map(t => ({ ...t, id: newId() })), anchors: result.anchors,
    currentRates: account.rates.length ? account.rates : found, foundRates: found, useRates: true,
    period: { from: result.from, to: result.to }, newId,
  })
  const gone = new Set(plan.remove)
  return { transactions: [...account.transactions.filter(t => !gone.has(t.id)), ...plan.add], rates: plan.rates ?? account.rates, plan }
}
const empty = { transactions: [], rates: [] }
const balanceOn = (account, day) => simulateLedger({ transactions: account.transactions, rates: pct(account.rates), fromDate: day, endDate: day })
  .find(r => r.date === day).balance

// Four months, cut into four statements (deposits and withdrawals along the way).
const months = (() => {
  const moves = {
    '2026-01-01': [{ type: 'Transfer Credit', amount: 20000000 }],
    '2026-02-10': [{ type: 'Cash Withdrawal', amount: -1002000 }],
    '2026-03-05': [{ type: 'Transfer Credit', amount: 5000000 }],
    '2026-04-12': [{ type: 'Standing Order', amount: -1000 }],
  }
  const rows = statementRows({ from: '2026-01-01', days: 120, rate: 40, moves })
  const cuts = ['2026-02-01', '2026-03-01', '2026-04-01'].map(d => rows.findIndex(r => r.book === d))
  const parts = [rows.slice(0, cuts[0]), rows.slice(cuts[0], cuts[1]), rows.slice(cuts[1], cuts[2]), rows.slice(cuts[2])]
  return { final: rows.at(-1).balance / 100, last: rows.at(-1).book, parts: parts.map(p => parseStatementPages([page(p)])) }
})()
const [jan, feb, mar, apr] = months.parts

test('all statements at once: exact, and no bridges', () => {
  const acc = importInto(empty, [jan, feb, mar, apr])
  assert.equal(balanceOn(acc, months.last), months.final)
  assert.equal(acc.transactions.filter(t => t.ref?.startsWith('gap-')).length, 0)
})

test('a statement missing in the middle is bridged, and the bridge goes when it arrives', () => {
  let acc = importInto(empty, [jan, feb, apr])
  assert.equal(acc.transactions.filter(t => t.ref?.startsWith('gap-')).length, 1, 'bridged')
  assert.equal(balanceOn(acc, months.last), months.final, 'right after the gap')
  acc = importInto(acc, [mar])
  assert.equal(acc.transactions.filter(t => t.ref?.startsWith('gap-')).length, 0, 'bridge removed')
  assert.equal(balanceOn(acc, months.last), months.final)
  assert.equal(acc.plan.remove.length, 1)
})

test('newest first, then older ones: the later opening balance is replaced by real history', () => {
  let acc = importInto(empty, [apr])
  assert.equal(acc.transactions.filter(t => t.ref?.startsWith('opening-')).length, 1)
  assert.equal(balanceOn(acc, months.last), months.final)
  acc = importInto(acc, [feb])
  assert.equal(balanceOn(acc, months.last), months.final, 'gap before April bridged')
  acc = importInto(acc, [jan, mar])
  assert.equal(balanceOn(acc, months.last), months.final)
  assert.equal(acc.transactions.filter(t => t.ref?.startsWith('gap-') || t.ref?.startsWith('opening-')).length, 0, 'nothing stand-in left')
})

test('importing the same statements again adds nothing', () => {
  const acc = importInto(empty, [jan, feb, mar, apr])
  const again = importInto(acc, [feb, apr])
  assert.equal(again.plan.add.length, 0)
  assert.equal(again.plan.remove.length, 0)
  assert.equal(again.plan.skipped, feb.rows.filter(r => !r.type.startsWith('Interest') && r.type !== 'Debit Arrangement').length
    + apr.rows.filter(r => !r.type.startsWith('Interest') && r.type !== 'Debit Arrangement').length + 1, 'incl. the opening balance')
})

test("a statement's rates only change the days it covers", () => {
  const existing = [{ from: '2025-01-01', annualRate: 40 }, { from: '2026-06-01', annualRate: 45 }]
  assert.deepEqual(mergeRates(existing, [{ from: '2026-02-01', annualRate: 35 }], '2026-02-01', '2026-02-28'), [
    { from: '2025-01-01', annualRate: 40 }, { from: '2026-02-01', annualRate: 35 }, { from: '2026-03-01', annualRate: 40 }, { from: '2026-06-01', annualRate: 45 },
  ])
  // The newest statement: its rate carries on (nothing to go back to).
  assert.deepEqual(mergeRates([{ from: '2025-01-01', annualRate: 40 }], [{ from: '2026-02-01', annualRate: 35 }], '2026-02-01', '2026-02-28'),
    [{ from: '2025-01-01', annualRate: 40 }, { from: '2026-02-01', annualRate: 35 }])
  // Same rate as around it: nothing changes.
  assert.deepEqual(mergeRates(existing, [{ from: '2026-02-01', annualRate: 40 }], '2026-02-01', '2026-02-28'), existing)
})

// ---- the questions people ask about importing --------------------------------

const standIns = (acc) => acc.transactions.filter(t => t.ref?.startsWith('gap-') || t.ref?.startsWith('opening-')).length
const realLines = (acc) => acc.transactions.filter(t => !t.ref?.startsWith('gap-') && !t.ref?.startsWith('opening-'))
/** A statement printed for the days [from, to) of the four months, as a separate printout. */
const printout = (from, to = '2027-01-01', { wrap = null } = {}) => {
  const all = [...jan.rows, ...feb.rows, ...mar.rows, ...apr.rows].filter(r => r.bookDate >= from && r.bookDate < to)
  const rows = all.map(r => ({ book: r.bookDate, ref: r.ref, type: r.type, value: r.valueDate, amount: r.amount, balance: r.balance }))
  // Page breaks / wrapping can differ between printouts; the reference text then does too.
  const items = page(rows).map(t => (wrap && t.x === COL.ref && t.y < 660 ? { ...t, str: t.str.slice(0, wrap) } : t))
  return parseStatementPages([items])
}

test('Q: the same statement twice -> nothing is added the second time', () => {
  const once = importInto(empty, [feb])
  const twice = importInto(once, [feb])
  assert.equal(twice.plan.add.length, 0)
  assert.equal(twice.transactions.length, once.transactions.length)
})

test('Q: statements that overlap in dates -> the shared days are added once', () => {
  const acc = importInto(importInto(empty, [printout('2026-01-01', '2026-03-10')]), [printout('2026-02-15')])
  assert.equal(balanceOn(acc, months.last), months.final)
  assert.equal(realLines(acc).length, 4, 'four deposits/withdrawals, none doubled')
  assert.equal(standIns(acc), 0)
})

test('Q: same transactions in a different file / printout (name, page breaks) -> recognised', () => {
  const acc = importInto(empty, [printout('2026-01-01')])
  const again = importInto(acc, [printout('2026-01-01', '2027-01-01', { wrap: 6 })])
  assert.equal(again.plan.add.length, 0)
})

test('Q: part of a statement first, the full one later -> exact, nothing doubled', () => {
  let acc = importInto(empty, [printout('2026-02-05', '2026-03-20')])
  assert.equal(standIns(acc), 1, 'the part starts with an opening balance')
  acc = importInto(acc, [printout('2026-01-01')])
  assert.equal(balanceOn(acc, months.last), months.final)
  assert.equal(realLines(acc).length, 4)
  assert.equal(standIns(acc), 0, 'opening balance replaced by the real history')
})

test('Q: statements in random order -> the same result as in order', () => {
  for (const order of [[mar, jan, apr, feb], [apr, mar, feb, jan], [feb, apr, jan, mar]]) {
    const acc = order.reduce((a, s) => importInto(a, [s]), empty)
    assert.equal(balanceOn(acc, months.last), months.final, order.map(s => s.rows[0].bookDate).join(' '))
    assert.equal(realLines(acc).length, 4)
    assert.equal(standIns(acc), 0)
  }
})

// ---- financial accuracy ------------------------------------------------------

/** One page with "Balance at Period Start/End" lines and hand-written rows. */
const handPage = ({ opening, closing, rows, currency = 'ETB', amount = (c) => money(c) }) => {
  const items = header(664)
  items.push(text('Currency :', 38, 681), text(currency, 170, 681))
  items.push(text('Balance at Period S', COL.ref, 650), text('tart', COL.ref, 642), right(amount(opening), 542, 650))
  let y = 625
  for (const r of rows) {
    items.push(text(DAY(r.book), COL.book, y), text(r.ref ?? 'FT0001', COL.ref, y), text(r.type, COL.desc, y), text(DAY(r.book), COL.value, y))
    if (r.debit != null) items.push(right(amount(r.debit), 392, y))
    if (r.credit != null) items.push(text(amount(r.credit), COL.credit, y))
    items.push(right(amount(r.balance), 542, y))
    y -= 25
  }
  items.push(text('Balance at Period E', COL.ref, y), text('nd', COL.ref, y - 8), right(amount(closing), 542, y))
  return [items]
}

test('Q: totals that do not add up -> refused (closing balance, opening balance)', () => {
  const rows = [{ book: '2026-03-01', type: 'Transfer Credit', credit: 100000, balance: 600000 }]
  assert.doesNotThrow(() => parseStatementPages(handPage({ opening: 500000, closing: 600000, rows })))
  assert.throws(() => parseStatementPages(handPage({ opening: 500000, closing: 650000, rows })), /closing balance .* doesn't match/)
  assert.throws(() => parseStatementPages(handPage({ opening: 400000, closing: 600000, rows })), /opening balance .* doesn't match/)
  // A line in the middle that doesn't move the balance by its amount.
  const bad = [...rows, { book: '2026-03-02', type: 'Cash Withdrawal', debit: 10000, balance: 580000 }]
  assert.throws(() => parseStatementPages(handPage({ opening: 500000, closing: 580000, rows: bad })), /doesn't match the change in balance/)
})

test('Q: a debit that the balance shows is a credit -> follows the balance, and says so', () => {
  const rows = [{ book: '2026-03-01', type: 'Transfer Credit', debit: 100000, balance: 600000 }]
  const s = parseStatementPages(handPage({ opening: 500000, closing: 600000, rows }))
  assert.equal(s.rows[0].amount, 100000)
  assert.match(s.fixes[0].what, /swapped/)
})

test('Q: a line with a missing amount -> worked out from the balance, and says so', () => {
  const rows = [
    { book: '2026-03-01', type: 'Transfer Credit', credit: 100000, balance: 600000 },
    { book: '2026-03-02', type: 'Cash Withdrawal', balance: 549900 },
  ]
  const s = parseStatementPages(handPage({ opening: 500000, closing: 549900, rows }))
  assert.equal(s.rows[1].amount, -50100)
  assert.match(s.fixes[0].what, /missing amount/)
})

test('Q: negative balances are read in every common style', () => {
  for (const style of [(c) => `-${money(c)}`, (c) => `(${money(c)})`, (c) => `${money(c)}-`, (c) => `${money(c)} DR`]) {
    const amount = (c) => (c < 0 ? style(-c) : money(c))
    const rows = [{ book: '2026-03-01', type: 'Cash Withdrawal', debit: 150000, balance: -50000 }]
    const s = parseStatementPages(handPage({ opening: 100000, closing: -50000, rows, amount }))
    assert.equal(s.closing, -50000, style(1))
  }
})

test('Q: 1.000,50 and 1 000.50 style numbers are read the same as 1,000.50', () => {
  for (const fmt of [(c) => money(c).replace(/,/g, '#').replace('.', ',').replace(/#/g, '.'), (c) => money(c).replace(/,/g, ' ')]) {
    const rows = [{ book: '2026-03-01', type: 'Transfer Credit', credit: 123456789, balance: 123556789 }]
    const s = parseStatementPages(handPage({ opening: 100000, closing: 123556789, rows, amount: fmt }))
    assert.equal(s.rows[0].amount, 123456789, fmt(123456789))
  }
})

test('Q: another currency -> refused; mixing currencies -> refused', () => {
  const rows = [{ book: '2026-03-01', type: 'Transfer Credit', credit: 100000, balance: 600000 }]
  assert.throws(() => parseStatementPages(handPage({ opening: 500000, closing: 600000, rows, currency: 'USD' })), /USD.*Birr/)
  const etb = parseStatementPages(handPage({ opening: 500000, closing: 600000, rows }))
  assert.throws(() => buildImport([etb, { ...etb, currency: 'EUR' }]), /different currencies/)
})

test('Q: a reversed withdrawal (money back, fee included) nets to exactly nothing', () => {
  const moves = {
    '2026-03-01': [{ type: 'Transfer Credit', amount: 10000000 }],
    '2026-03-03': [{ type: 'Cash Withdrawal', amount: -1002000 }],
    '2026-03-05': [{ type: 'Reversal', amount: 1002000 }],
  }
  const rows = statementRows({ from: '2026-03-01', days: 10, rate: 40, moves })
  const imp = buildImport([parseStatementPages([page(rows)])])
  const rates = imp.rates.map(r => ({ from: r.from, annualRate: r.annualRate / 100, serviceCharge: 0.1 }))
  const cmp = compareWithStatement(simulateLedger({ transactions: imp.transactions, rates, fromDate: imp.to, endDate: imp.to }), imp.expected)
  assert.equal(cmp.matched, cmp.days, 'every day still matches')
  assert.deepEqual(imp.transactions.map(t => [t.type, t.amount]), [['deposit', 100000], ['withdrawal', 10000], ['deposit', 10020]])
})

// ---- data integrity ------------------------------------------------------------

test('long lists are read in full, past the 1,000-row page limit, with nothing repeated', async () => {
  const { readAll } = await import('./cloud.js')
  const table = Array.from({ length: 2345 }, (_, i) => ({ id: i }))
  const calls = []
  const query = () => ({ range: async (from, to) => { calls.push([from, to]); return { data: table.slice(from, Math.min(to + 1, from + 1000)), error: null } } })
  const rows = await readAll(query)
  assert.equal(rows.length, 2345)
  assert.equal(new Set(rows.map(r => r.id)).size, 2345)
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]])
})

test('your own entries that a statement also shows are not added twice; others are listed, not touched', () => {
  const own = [
    { id: 'm1', type: 'deposit', amount: 200000, date: '2026-01-02', note: 'typed in' }, // statement: Jan 1
    { id: 'm2', type: 'withdrawal', amount: 777, date: '2026-01-20', note: 'not on the statement' },
  ]
  const acc = importInto({ transactions: own, rates: [{ from: '2025-01-01', annualRate: 40, serviceCharge: 10 }] }, [jan])
  assert.equal(acc.plan.matched.length, 1)
  assert.equal(acc.plan.matched[0].own.id, 'm1')
  assert.deepEqual(acc.plan.unmatchedOwn.map(t => t.id), ['m2'])
  assert.equal(acc.transactions.filter(t => t.type === 'deposit' && t.amount === 200000).length, 1, 'the 200,000 is there once')
  assert.ok(acc.transactions.some(t => t.id === 'm1' && t.date === '2026-01-02'), 'your entry is unchanged')
  assert.ok(acc.transactions.some(t => t.id === 'm2'), 'never deleted')
})

test('two of your entries for two statement lines of the same amount: both matched, one each', () => {
  const stmt = parseStatementPages([page(statementRows({
    from: '2026-03-01', days: 6, rate: 40,
    moves: { '2026-03-01': [{ type: 'Transfer Credit', amount: 5000000 }], '2026-03-04': [{ type: 'Transfer Credit', amount: 5000000 }] },
  }))])
  const own = [{ id: 'a', type: 'deposit', amount: 50000, date: '2026-03-01' }, { id: 'b', type: 'deposit', amount: 50000, date: '2026-03-04' }]
  const acc = importInto({ transactions: own, rates: [{ from: '2025-01-01', annualRate: 40, serviceCharge: 10 }] }, [stmt])
  assert.deepEqual(acc.plan.matched.map(m => [m.own.id, m.line.date]), [['a', '2026-03-01'], ['b', '2026-03-04']])
  assert.equal(acc.transactions.filter(t => t.amount === 50000).length, 2)
})

test('an imported line you edited is kept as you edited it; one you deleted comes back', () => {
  const acc = importInto(empty, [jan, feb])
  const edited = acc.transactions.map(t => (t.note === 'Cash Withdrawal' ? { ...t, amount: 9999 } : t))
  const again = importInto({ ...acc, transactions: edited }, [feb])
  assert.equal(again.plan.add.filter(t => !t.ref.startsWith('gap-')).length, 0, 'not added a second time')
  const deleted = acc.transactions.filter(t => t.note !== 'Cash Withdrawal')
  const restored = importInto({ ...acc, transactions: deleted }, [feb])
  assert.equal(restored.plan.add.filter(t => t.note === 'Cash Withdrawal').length, 1)
})

test('a recalculated bridge gets a new reference (so add-then-remove never collides)', () => {
  const a = importInto(empty, [jan, apr])
  const b = importInto(a, [mar])
  const before = a.transactions.find(t => t.ref.startsWith('gap-'))
  const after = b.transactions.find(t => t.ref.startsWith('gap-'))
  assert.ok(before && after)
  assert.notEqual(before.ref, after.ref)
})

// ---- PDF reading edge cases ----------------------------------------------------

const twoDays = () => statementRows({ from: '2026-03-01', days: 3, rate: 40, moves: { '2026-03-01': [{ type: 'Transfer Credit', amount: 10000000 }] } })

test('Q: a scanned PDF (no text) -> told it is a scan', () => {
  assert.throws(() => parseStatementPages([[], []]), /looks like a scan/)
})

test("Q: a line's kind wrapped onto two lines is still recognised (interest is never taken for a deposit)", () => {
  const rows = twoDays()
  const items = page(rows).flatMap(t => (t.str === 'Interest - Capitalise' ? [{ ...t, str: 'Interest -' }, { ...t, str: 'Capitalise', y: t.y - 8 }] : [t]))
  const s = parseStatementPages([items])
  assert.equal(s.rows.filter(r => r.type === 'Interest - Capitalise').length, 3)
  const imp = buildImport([s])
  assert.equal(imp.transactions.length, 1, 'only the real deposit')
})

test('Q: a description on two lines -> the kind, plus the rest as narrative', () => {
  const rows = twoDays()
  const items = page(rows).flatMap(t => (t.str === 'Transfer Credit' ? [t, { ...t, str: 'FROM ABEBE', y: t.y - 8 }] : [t]))
  const s = parseStatementPages([items])
  assert.deepEqual([s.rows[0].type, s.rows[0].narrative], ['Transfer Credit', 'FROM ABEBE'])
})

test('Q: a row cut off at the bottom of a page carries on at the top of the next', () => {
  const rows = twoDays()
  const all = page(rows)
  // Move the deposit's amount and balance to the top of a second page.
  const depositY = all.find(t => t.str === 'Transfer Credit').y
  const moved = all.filter(t => t.y === depositY && t.x >= COL.debit)
  const first = all.filter(t => !moved.includes(t) && t.y >= depositY)
  const second = [text('30 September 2026', 496, 768), ...moved.map(t => ({ ...t, y: 740 })), ...all.filter(t => t.y < depositY).map(t => ({ ...t, y: t.y + 100 }))]
  const s = parseStatementPages([first, second])
  assert.equal(s.rows.length, rows.length)
  assert.equal(s.rows[0].amount, 10000000)
})

test('Q: a page missing in the middle (300 of 500 lines) -> refused, never imported in part', () => {
  const rows = statementRows({ from: '2026-03-01', days: 20, rate: 40, moves: { '2026-03-01': [{ type: 'Transfer Credit', amount: 10000000 }] } })
  assert.throws(() => parseStatementPages([page(rows.slice(0, 15)), page(rows.slice(25), { withHeader: false })]), /doesn't match the change in balance/)
})

test("Q: lines cut off at the very end can't be seen without the printed closing balance -> flagged", () => {
  const rows = twoDays()
  assert.equal(parseStatementPages([page(rows)]).closingConfirmed, false)
  assert.equal(buildImport([parseStatementPages([page(rows)])]).unconfirmed, 1)
})

test('Q: a statement printed newest first is read oldest first', () => {
  const rows = twoDays()
  const s = parseStatementPages([page([...rows].reverse())])
  assert.equal(s.rows[0].type, 'Transfer Credit')
  assert.equal(s.closing, rows.at(-1).balance)
})

test('Q: two lines on the same day keep their order and both count', () => {
  const rows = statementRows({ from: '2026-03-01', days: 2, rate: 40, moves: { '2026-03-01': [{ type: 'Transfer Credit', amount: 10000000 }, { type: 'Transfer Credit', amount: 10000000 }] } })
  const imp = buildImport([parseStatementPages([page(rows)])])
  assert.equal(imp.transactions.length, 2)
  assert.notEqual(imp.transactions[0].ref, imp.transactions[1].ref)
})

test("Q: another Yehulu account's statement -> its account number is recognised", async () => {
  const { statementAccounts } = await import('./statement.js')
  const acc = importInto(empty, [jan])
  assert.deepEqual([...statementAccounts(acc.transactions)], ['3000123456'])
})

// ---- adversarial: page continuation ---------------------------------------------

test('page continuation never merges a dateless row into the one before it silently', () => {
  const rows = statementRows({
    from: '2026-03-01', days: 4, rate: 40,
    moves: { '2026-03-01': [{ type: 'Transfer Credit', amount: 10000000 }], '2026-03-03': [{ type: 'Transfer Credit', amount: 3000000 }] },
  })
  const split = rows.findIndex(r => r.amount === 3000000)
  const firstPage = page(rows.slice(0, split))
  // Page 2 starts with the 30,000 deposit, but its date didn't come through.
  const secondPage = page(rows.slice(split), { withHeader: false }).filter(t => !(t.y === 740 && t.x === COL.book))
  assert.throws(() => parseStatementPages([firstPage, secondPage]), /doesn't match the change in balance|closing balance/)
})

test('the closing-balance line at the top of the last page is not taken into the row before it', () => {
  const rows = statementRows({ from: '2026-03-01', days: 2, rate: 40, moves: { '2026-03-01': [{ type: 'Transfer Credit', amount: 10000000 }] } })
  const last = rows.at(-1).balance
  const endPage = [text('Balance at Period E', COL.ref, 740), text('nd', COL.ref, 732), right(money(last), 542, 740)]
  const s = parseStatementPages([page(rows), endPage])
  assert.equal(s.rows.length, rows.length)
  assert.equal(s.closingConfirmed, true)
  assert.equal(s.rows.at(-1).balance, last)
  assert.throws(() => parseStatementPages([page(rows), [text('Balance at Period E', COL.ref, 740), right(money(last + 100), 542, 740)]]), /closing balance/)
})

// ---- adversarial: second-level audit regressions -----------------------------

test('another Yehulu account is refused at the import core (no balance corruption)', async () => {
  const { AccountMismatch } = await import('./statement.js')
  const acc = importInto(empty, [jan])
  const other = { ...feb, accountNo: '3000999999' }
  assert.throws(() => importInto(acc, [other]), (err) => err instanceof AccountMismatch && /••9999/.test(err.message))
  // Same account: fine.
  assert.doesNotThrow(() => importInto(acc, [feb]))
})

test('a statement without printed opening/closing balances is flagged as unverified', () => {
  const rows = statementRows({ from: '2026-03-01', days: 2, rate: 40, moves: { '2026-03-01': [{ type: 'Transfer Credit', amount: 10000000 }] } })
  const s = parseStatementPages([page(rows)])
  assert.equal(s.openingConfirmed, false)
  assert.equal(buildImport([s]).unconfirmed, 1)
  const ok = parseStatementPages(handPage({ opening: 0, closing: 100000, rows: [{ book: '2026-03-01', type: 'Transfer Credit', credit: 100000, balance: 100000 }] }))
  assert.equal(buildImport([ok]).unconfirmed, 0)
})

test('atomic cloud import: sends one request; falls back only when the database lacks it', async () => {
  const { cloudApi } = await import('./cloud.js')
  const calls = []
  const client = (error) => ({ rpc: async (name, args) => { calls.push([name, args]); return { error } } })
  const txn = { id: 'x', type: 'withdrawal', amount: 10, date: '2026-03-01', note: 'Standing Order', noFee: true, ref: 'y:1:abc' }
  assert.equal(await cloudApi(client(null)).importStatement('acc', 'me', [txn], ['old'], null, [{ from: '2026-01-01', annualRate: 2 }]), true)
  assert.deepEqual(calls[0][1].new_rows, [{ id: 'x', type: 'withdrawal', amount: 10, date: '2026-03-01', note: 'Standing Order', no_fee: true, ref: 'y:1:abc' }])
  assert.deepEqual(calls[0][1].remove_ids, ['old'])
  assert.deepEqual(calls[0][1].member_rates, [{ from: '2026-01-01', annual_rate: 2 }])
  assert.equal(await cloudApi(client({ message: 'Could not find the function public.import_statement', code: 'PGRST202' })).importStatement('acc', 'me', [], [], null, null), false)
  await assert.rejects(cloudApi(client({ message: 'permission denied' })).importStatement('acc', 'me', [], [], null, null), /permission denied/)
})
