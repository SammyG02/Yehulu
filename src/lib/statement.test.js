import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildImport, compareWithStatement, importChoices, mergeRates, parseStatementPages, planImport, suggestChoice } from './statement.js'
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
  assert.deepEqual(calls[0][1].new_rows, [{ id: 'x', type: 'withdrawal', amount: 10, date: '2026-03-01', note: 'Standing Order', no_fee: true, ref: 'y:1:abc', source: null }])
  assert.deepEqual(calls[0][1].remove_ids, ['old'])
  assert.deepEqual(calls[0][1].member_rates, [{ from: '2026-01-01', annual_rate: 2 }])
  assert.equal(await cloudApi(client({ message: 'Could not find the function public.import_statement', code: 'PGRST202' })).importStatement('acc', 'me', [], [], null, null), false)
  await assert.rejects(cloudApi(client({ message: 'permission denied for function import_statement', code: '42501' })).importStatement('acc', 'me', [], [], null, null), /permission denied/)
  await assert.rejects(cloudApi(client({ message: 'Could not choose the best candidate function between: public.import_statement', code: 'PGRST203' })).importStatement('acc', 'me', [], [], null, null), /best candidate/)
  await assert.rejects(cloudApi(client({ message: 'permission denied' })).importStatement('acc', 'me', [], [], null, null), /permission denied/)
})

// ---- removing imported statements -----------------------------------------------

const removeFrom = async (acc, from, to) => {
  const { planRemoval, importedPeriods } = await import('./statement.js')
  const [p] = importedPeriods(acc.transactions)
  const plan = planRemoval({ existing: acc.transactions, accountNo: p.accountNo, from, to, rates: pct(acc.rates), newId })
  const gone = new Set(plan.remove)
  return { ...acc, transactions: [...acc.transactions.filter(t => !gone.has(t.id)), ...plan.add], plan }
}

test('imported statements are listed one per file, with their period', async () => {
  const { importedPeriods } = await import('./statement.js')
  const named = [jan, feb, mar, apr].map((s, i) => ({ ...s, fileName: `STMT(${i + 1}).pdf` }))
  const acc = importInto(empty, named)
  assert.deepEqual(importedPeriods(acc.transactions).map(p => [p.file, p.from, p.to]), [
    ['STMT(1).pdf', '2026-01-01', '2026-01-31'], ['STMT(2).pdf', '2026-02-01', '2026-02-28'],
    ['STMT(3).pdf', '2026-03-01', '2026-03-31'], ['STMT(4).pdf', '2026-04-01', '2026-04-30'],
  ])
  // Lines imported before files were recorded show as one group per account.
  const old = acc.transactions.map(({ source: _s, ...t }) => t)
  assert.deepEqual(importedPeriods(old).map(p => [p.file, p.accountNo]), [[null, '3000123456']])
})

test('removing one file removes only its lines; days another file covers stay; re-import restores it', async () => {
  const { planRemoval, importedPeriods } = await import('./statement.js')
  // Two overlapping files: Jan 1 - Mar 10, and Feb 15 - end.
  const a = { ...printout('2026-01-01', '2026-03-11'), fileName: 'A.pdf' }
  const b = { ...printout('2026-02-15'), fileName: 'B.pdf' }
  let acc = importInto(importInto(empty, [a]), [b])
  const files = importedPeriods(acc.transactions)
  assert.deepEqual(files.map(f => f.file), ['A.pdf', 'B.pdf'])
  const fileA = files[0]
  const plan = planRemoval({ existing: acc.transactions, accountNo: fileA.accountNo, from: fileA.from, to: fileA.to, source: fileA.source, rates: pct(acc.rates), newId })
  const gone = new Set(plan.remove)
  const after = { ...acc, transactions: [...acc.transactions.filter(t => !gone.has(t.id)), ...plan.add] }
  // A's deposit (Jan 1) and withdrawal (Feb 10) go; the Mar 5 deposit stays: B covers it.
  assert.equal(plan.removed.deposits + plan.removed.withdrawals, 2)
  assert.equal(plan.removed.keptForOthers, 1)
  assert.ok(after.transactions.some(t => t.date === '2026-03-05' && t.type === 'deposit'))
  assert.equal(balanceOn(after, months.last), months.final, 'B still matches the bank')
  acc = importInto(after, [a])
  assert.equal(balanceOn(acc, months.last), months.final)
  assert.equal(standIns(acc), 0, 'A back: no stand-ins left')
})

test('removing a middle statement: later balances still match the bank; importing it again restores everything', async () => {
  const full = importInto(empty, [jan, feb, mar, apr])
  const cut = await removeFrom(full, '2026-03-01', '2026-03-31')
  assert.equal(cut.plan.removed.deposits, 1, 'the March deposit')
  assert.equal(balanceOn(cut, months.last), months.final, 'later balances unchanged')
  assert.equal(cut.transactions.filter(t => t.ref.startsWith('gap-')).length, 1, 'bridged')
  const back = importInto(cut, [mar])
  assert.equal(balanceOn(back, months.last), months.final)
  assert.equal(standIns(back), 0)
  assert.equal(realLines(back).length, 4)
})

test('removing the newest statement removes its money; earlier days unchanged', async () => {
  const full = importInto(empty, [jan, feb, mar, apr])
  const cut = await removeFrom(full, '2026-04-01', '2026-12-31')
  assert.equal(cut.plan.add.length, 0, 'nothing later to keep in step')
  assert.equal(balanceOn(cut, '2026-03-31'), balanceOn(full, '2026-03-31'))
  assert.ok(balanceOn(cut, months.last) !== months.final)
})

test('removing never touches your own entries, and removing everything leaves only them', async () => {
  const full = importInto(empty, [jan, feb, mar, apr])
  const withOwn = { ...full, transactions: [...full.transactions, { id: 'mine', type: 'deposit', amount: 123, date: '2026-03-10', note: 'mine' }] }
  const cut = await removeFrom(withOwn, '2026-01-01', '2026-12-31')
  assert.deepEqual(cut.transactions.map(t => t.id), ['mine'])
})

// ---- code review regressions -------------------------------------------------------

test('removing a file also removes a line dated before the statement\'s first booking day (value date)', async () => {
  const { planRemoval, importedPeriods } = await import('./statement.js')
  // The deposit is booked on Mar 3 but valued Mar 1, so the line is dated Mar 1.
  const rows = statementRows({ from: '2026-03-03', days: 3, rate: 40, moves: { '2026-03-03': [{ type: 'Transfer Credit', amount: 10000000 }] } })
  rows[0].value = '2026-03-01'
  const stmt = { ...parseStatementPages([page(rows)]), fileName: 'A.pdf' }
  const acc = importInto(empty, [stmt])
  assert.ok(acc.transactions.some(t => t.date === '2026-03-01'), 'line dated by its value date')
  const [file] = importedPeriods(acc.transactions)
  assert.equal(file.from, '2026-03-03', 'the file\'s period is its booking dates')
  const plan = planRemoval({ existing: acc.transactions, accountNo: file.accountNo, from: file.from, to: file.to, source: file.source, rates: pct(acc.rates), newId })
  assert.equal(plan.removed.deposits, 1, 'the Mar 1 deposit goes with its file')
})

test('two Yehulu accounts with the same file name are listed separately', async () => {
  const { importedPeriods } = await import('./statement.js')
  const a = { ...feb, fileName: 'statement.pdf' }
  const accA = importInto(empty, [a])
  const other = accA.transactions.map(t => ({ ...t, id: `o-${t.id}`, ref: t.ref?.replace('y:3000123456:', 'y:3000999999:') }))
  const list = importedPeriods([...accA.transactions, ...other])
  assert.deepEqual(list.map(p => p.accountNo).sort(), ['3000123456', '3000999999'])
})

// ---- where an import goes -------------------------------------------------------

const LINES = [{ ref: 'y:111:a', legacyRefs: ['y:a', 'FT1:100'] }]
const acct = (id, refs) => ({ id, name: id, transactions: refs.map(ref => ({ ref })) })
const kinds = (accounts) => importChoices({ accounts, me: 'me', accountNo: '111', lines: LINES }).map(c => c.kind)

test('finds the account that already has this Yehulu account', () => {
  assert.deepEqual(kinds([acct('a', []), acct('b', [undefined]), acct('c', ['y:111:z']), acct('d', ['y:222:z'])]), ['empty', 'open', 'same', 'other'])
  assert.deepEqual(kinds([acct('old', ['FT1:100']), acct('opening', ['opening-2026-01-01'])]), ['same', 'open'])
})

test('in a shared account the owner is matched to whoever has it; a member only to themselves', () => {
  const shared = (role) => ({ id: 's', name: 's', cloud: true, role, members: [{ id: 'me' }, { id: 'abe' }], transactions: [{ memberId: 'abe', ref: 'y:111:z' }] })
  const pick = (role) => importChoices({ accounts: [shared(role)], me: 'me', accountNo: '111', lines: LINES })[0]
  assert.deepEqual([pick('owner').memberId, pick('owner').kind], ['abe', 'same'])
  assert.deepEqual([pick('member').memberId, pick('member').kind], ['me', 'empty'])
})

test('starts on the matching account, asks when two match, and makes a new one only when none does', () => {
  const start = (accounts, canAdd = true) => suggestChoice(importChoices({ accounts, me: 'me', accountNo: '111', lines: LINES }), accounts, canAdd)
  assert.equal(start([acct('a', []), acct('b', ['y:111:z'])]), 'b')
  assert.equal(start([acct('a', ['y:111:z']), acct('b', ['y:111:z'])]), null)
  assert.equal(start([acct('a', [])]), 'a')
  assert.equal(start([acct('a', [undefined])]), 'new')
  assert.equal(start([acct('a', ['y:222:z'])], false), null)
})

test("interest posted late doesn't include the next day's lines printed before it", () => {
  for (const late of [1, 2]) {
    const a = statementRows({ from: '2026-03-01', days: 5, rate: 40, moves: { '2026-03-01': [{ type: 'Transfer Credit', amount: 213067866 }] } })
    // The standing orders are printed first, then the interest of the `late` days before them.
    let bal = a.at(-1).balance
    let real = bal
    const rows = [...a]
    const add = (type, amount, value, book = `2026-03-0${6 + late}`) => { bal += amount; rows.push({ book, ref: `FT${rows.length}`.padEnd(16, 'Q'), type, value, amount, balance: bal }) }
    for (let k = 0; k < 2; k++) add('Standing Order', -1000, `2026-03-0${6 + late}`)
    for (let d = 0; d < late + 4; d++) {
      if (d === late) real -= 2000
      const interest = Math.round(real * 40 / 36500)
      const charge = Math.round(interest / 10)
      real += interest - charge
      const value = `2026-03-${String(7 + d).padStart(2, '0')}`
      add('Interest - Capitalise', interest, value)
      add('Debit Arrangement', -charge, value)
    }
    const imp = buildImport([parseStatementPages([page(rows)])])
    assert.deepEqual(imp.transactions.filter(t => t.noFee).map(t => t.date), Array(2).fill(`2026-03-0${6 + late}`))
    const rates = imp.rates.map(r => ({ from: r.from, annualRate: r.annualRate / 100, serviceCharge: 0.1 }))
    const cmp = compareWithStatement(simulateLedger({ transactions: imp.transactions, rates, fromDate: imp.to, endDate: imp.to }), imp.expected)
    assert.deepEqual([cmp.matched, cmp.end.app], [cmp.days, bal / 100])
  }
})

// ---- interest posted late: code review findings --------------------------------

const nextDay = (key, n = 1) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** Prints statement lines one by one, keeping the running balance (cents). */
const printer = (opening = 0) => {
  const p = { rows: [], balance: opening }
  p.line = (type, amount, book, value = book) => {
    p.balance += amount
    p.rows.push({ book, ref: `R${p.rows.length}`.padEnd(16, 'Q'), type, value, amount, balance: p.balance })
  }
  /** Interest for `day` on `closing`; returns what it adds. */
  p.interest = (closing, rate, day, book = day) => {
    const gross = Math.round((closing * rate) / 36500)
    const charge = Math.round(gross / 10)
    p.line('Interest - Capitalise', gross, book, nextDay(day))
    p.line('Debit Arrangement', -charge, book, nextDay(day))
    return gross - charge
  }
  /** Yehulu takes the interest of `day` back. */
  p.reverse = (gross, day, book) => {
    p.line('Debit Arrangement', Math.round(gross / 10), book, nextDay(day))
    p.line('Interest - Capitalise', -gross, book, nextDay(day))
  }
  p.read = () => buildImport([parseStatementPages([page(p.rows)])])
  return p
}
const D = (n) => nextDay('2026-03-01', n - 1)
const dated = (imp, amount) => imp.transactions.find(t => t.amount === amount / 100).date
/** Every day the statement shows, against the app's own maths over the import. */
const appAgrees = (imp) => {
  const cmp = compareWithStatement(simulateLedger({ transactions: imp.transactions, rates: pct(imp.rates), fromDate: imp.to, endDate: imp.to }), imp.expected)
  assert.deepEqual([cmp.matched, cmp.firstDifference], [cmp.days, null])
}
/** `days` ordinary days at 40% from 1 March; returns the true balance after them. */
const ordinary = (p, deposit, days) => {
  p.line('Transfer Credit', deposit, D(1))
  let real = deposit
  for (let n = 1; n <= days; n++) real += p.interest(real, 40, D(n))
  return real
}

test('review 1: a deposit printed before two late days is not read as a rate change, however small the balance', () => {
  for (const deposit of [20000, 100000, 100000000]) {
    const p = printer()
    let real = ordinary(p, deposit, 4)
    const big = deposit + 7
    p.line('Transfer Credit', big, D(7))
    real += p.interest(real, 40, D(5), D(7))
    real += p.interest(real, 40, D(6), D(7))
    real += big
    for (let n = 7; n <= 10; n++) real += p.interest(real, 40, D(n))
    const imp = p.read()
    assert.deepEqual(imp.rates, [{ from: D(1), annualRate: 40 }])
    assert.equal(dated(imp, big), D(7))
    appAgrees(imp)
  }
})

test('review 1: with only one ordinary day to go by, two late days still are not a rate', () => {
  const p = printer()
  let real = ordinary(p, 100000, 1)
  p.line('Transfer Credit', 100007, D(4))
  real += p.interest(real, 40, D(2), D(4))
  p.interest(real, 40, D(3), D(4))
  const imp = p.read()
  assert.deepEqual(imp.rates, [{ from: D(1), annualRate: 40 }])
  assert.equal(dated(imp, 100007), D(4))
  appAgrees(imp)
})

test('review 1: what cannot be explained changes nothing: dates stay, no rate is made up, the difference shows', () => {
  const p = printer()
  const real = ordinary(p, 10000000, 5)
  p.line('Transfer Credit', 10000007, D(8))
  // Two days at a figure neither balance gives.
  for (const n of [6, 7]) { p.line('Interest - Capitalise', Math.round(real * 13 / 36500), D(8), D(n + 1)); p.line('Debit Arrangement', -Math.round(real * 13 / 365000), D(8), D(n + 1)) }
  for (let n = 8; n <= 11; n++) p.interest(p.balance, 40, D(n))
  const imp = p.read()
  assert.deepEqual(imp.rates, [{ from: D(1), annualRate: 40 }])
  assert.equal(dated(imp, 10000007), D(6))
})

test('a real rate change is still found, from its first day, when that day has a deposit dated the day after', () => {
  const p = printer()
  let real = ordinary(p, 10000000, 5)
  p.line('Transfer Credit', 300007, D(6), D(7)) // counted on the 6th, value date the 7th
  real += 300007
  for (let n = 6; n <= 10; n++) real += p.interest(real, 35, D(n))
  const imp = p.read()
  assert.deepEqual(imp.rates, [{ from: D(1), annualRate: 40 }, { from: D(6), annualRate: 35 }])
  assert.equal(dated(imp, 300007), D(6))
  appAgrees(imp)
})

test('a late day right where the rate changes', () => {
  for (const rate of [40, 35]) { // the late day's own rate: the old or the new
    const p = printer()
    let real = ordinary(p, 10000000, 5)
    p.line('Transfer Credit', 300007, D(7))
    real += p.interest(real, rate, D(6), D(7))
    real += 300007
    for (let n = 7; n <= 10; n++) real += p.interest(real, 35, D(n))
    const imp = p.read()
    assert.deepEqual(imp.rates, [{ from: D(1), annualRate: 40 }, { from: D(rate === 40 ? 7 : 6), annualRate: 35 }])
    assert.equal(dated(imp, 300007), D(7))
    appAgrees(imp)
  }
})

test('review 3: lines before a late day in any order', () => {
  const moves = [['Transfer Credit', 300007, D(7)], ['Transfer Credit', 200003, D(6)], ['Transfer Credit', 100009, D(8)]]
  for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const p = printer()
    let real = ordinary(p, 10000000, 5)
    for (const k of order) p.line(moves[k][0], moves[k][1], D(8), moves[k][2])
    for (const [n, amount] of [[6, 200003], [7, 300007], [8, 100009]]) {
      real += amount
      real += p.interest(real, 40, D(n), D(8))
    }
    for (let n = 9; n <= 11; n++) real += p.interest(real, 40, D(n))
    const imp = p.read()
    assert.deepEqual(moves.map(([, amount]) => dated(imp, amount)), [D(7), D(6), D(8)], `printed in order ${order}`)
    appAgrees(imp)
  }
})

test('review 4: a reversal between the lines and the recalculated interest', () => {
  for (const newRate of [40, 35]) {
    const p = printer()
    let real = ordinary(p, 10000000, 4)
    p.line('Cash Withdrawal', -100200, D(6))
    const wrong = Math.round(real * 41 / 36500)
    p.line('Interest - Capitalise', wrong, D(6), D(6)); p.line('Debit Arrangement', -Math.round(wrong / 10), D(6), D(6))
    p.reverse(wrong, D(5), D(6))
    real += p.interest(real, newRate, D(5), D(6))
    real -= 100200
    for (let n = 6; n <= 10; n++) real += p.interest(real, newRate, D(n))
    const imp = p.read()
    assert.equal(dated(imp, 100000), D(6))
    appAgrees(imp)
  }
})

test('review 4: several days taken back and recalculated, with money moved on each', () => {
  const p = printer()
  let real = ordinary(p, 10000000, 4)
  const start = real
  const gross = []
  for (const [n, amount] of [[5, 100003], [6, 200009], [7, 300001]]) {
    p.line('Transfer Credit', amount, D(n))
    real += amount
    gross.push(Math.round(real * 40 / 36500))
    real += p.interest(real, 40, D(n))
  }
  for (const n of [7, 6, 5]) p.reverse(gross[n - 5], D(n), D(8))
  real = start
  for (const [n, amount] of [[5, 100003], [6, 200009], [7, 300001]]) { real += amount; real += p.interest(real, 35, D(n), D(8)) }
  for (let n = 8; n <= 12; n++) real += p.interest(real, 35, D(n))
  const imp = p.read()
  assert.deepEqual(imp.rates, [{ from: D(1), annualRate: 40 }, { from: D(5), annualRate: 35 }])
  assert.deepEqual([100003, 200009, 300001].map(a => dated(imp, a)), [D(5), D(6), D(7)])
  appAgrees(imp)
})

test('review 5: the first interest after a missing statement uses its own balance', () => {
  const p = printer()
  let real = ordinary(p, 10000000, 5)
  const q = printer(real + 5000000)
  real += 5000000
  for (let n = 20; n <= 25; n++) real += q.interest(real, 35, D(n))
  const imp = buildImport([parseStatementPages([page(p.rows)]), parseStatementPages([page(q.rows)])])
  assert.equal(imp.gaps.length, 1)
  assert.deepEqual(imp.rates, [{ from: D(1), annualRate: 40 }, { from: D(20), annualRate: 35 }])
})

/** A statement with one late day, and what the app stored for it before this was understood. */
const lateStatement = ({ from = 1 } = {}) => {
  const p = printer()
  let real = ordinary(p, 213067866, 5)
  const cut = p.rows.length
  const before = p.balance
  p.line('Standing Order', -1000, D(7)); p.line('Standing Order', -1000, D(7))
  real += p.interest(real, 40, D(6), D(7))
  real -= 2000
  for (let n = 7; n <= 12; n++) real += p.interest(real, 40, D(n))
  const read = (rows) => parseStatementPages([page(rows)])
  return { whole: read(p.rows), early: read(p.rows.slice(0, cut)), rest: from === 1 ? null : read(p.rows.slice(cut)), before, real }
}
const asStoredBefore = (account) => ({ ...account, transactions: account.transactions.map(t => (t.noFee && t.date === D(7) && t.type === 'withdrawal' ? { ...t, date: D(6) } : t)) })
const applyMoves = (a) => ({ ...a, transactions: a.transactions.map(t => ({ ...t, date: a.plan.moved.find(m => m.id === t.id)?.date ?? t.date })) })

test('review 2: importing again puts right the dates an earlier version stored', () => {
  const { whole, real } = lateStatement()
  const right = importInto(empty, [whole])
  assert.deepEqual(right.plan.moved, [])
  const old = asStoredBefore(right)
  assert.notEqual(balanceOn(old, D(12)), real / 100, 'it was wrong before')
  const again = applyMoves(importInto(old, [whole]))
  assert.equal(again.plan.moved.length, 2)
  assert.deepEqual([again.plan.add, again.plan.remove], [[], []], 'no bridge, nothing added twice')
  assert.equal(balanceOn(again, D(12)), real / 100)
  assert.deepEqual(importInto(again, [whole]).plan.moved, [], 'done once')
  assert.ok(right.transactions.every(t => !('oldDate' in t) && !('legacyRefs' in t)), 'working notes are not stored')
})

test('review 2: no false bridge when the late day is the first of the statement', () => {
  const { early, rest } = lateStatement({ from: 2 })
  // `rest` starts with the late day, so it is read with the one before it.
  const right = importInto(empty, [early, rest])
  const again = applyMoves(importInto(asStoredBefore(right), [early, rest]))
  assert.equal(again.plan.moved.length, 2)
  assert.deepEqual(again.transactions.filter(t => t.ref?.startsWith('gap-')), [])
  // A bridge an earlier version left there goes too, whichever file is imported again.
  const bridged = asStoredBefore(right)
  bridged.transactions = [...bridged.transactions, { id: 'b', type: 'withdrawal', amount: 20, date: D(7), noFee: true, ref: `gap-${D(6)}:-20`, note: 'Missing statement (until it is imported)' }]
  const { whole } = lateStatement()
  const fixed = applyMoves(importInto(bridged, [whole]))
  assert.deepEqual(fixed.transactions.filter(t => t.ref?.startsWith('gap-')), [])
})

test('review 2: a date you changed yourself is left alone', () => {
  const { whole } = lateStatement()
  const right = importInto(empty, [whole])
  const mine = { ...right, transactions: right.transactions.map(t => (t.noFee ? { ...t, date: D(9) } : t)) }
  assert.deepEqual(importInto(mine, [whole]).plan.moved, [])
})

test('made-up statements by the hundred: late days, mixed order, corrections, small and large balances', () => {
  let seed = 7
  const rnd = () => { // mulberry32
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = (list) => list[Math.floor(rnd() * list.length)]
  for (let run = 0; run < 150; run++) {
    const p = printer()
    let rate = pick([2, 7, 20, 35, 40, 50])
    const unit = pick([20000, 300000, 5000000, 200000000])
    let real = unit + Math.floor(rnd() * unit)
    p.line('Transfer Credit', real, D(1))
    const truth = [] // [cents moved, day]
    let n = 1
    const used = new Set() // each amount once, so a line can be told by it
    const amount = () => { for (;;) { const a = Math.floor(unit * (rnd() < 0.2 ? 0.02 : 0.2 + rnd())) + 11 + Math.floor(rnd() * 500); if (!used.has(a)) { used.add(a); return a } } }
    while (n <= 45) {
      const kind = rnd()
      if (n > 5 && n < 38 && kind < 0.12) {
        // 1 or 2 late days, printed after money of the days up to then (any order).
        const days = pick([1, 2])
        const money = []
        for (let d = 0; d <= days; d++) if (d === days || rnd() < 0.4) money.push([amount(), n + d])
        money.sort(() => rnd() - 0.5)
        for (const [a, d] of money) { p.line('Transfer Credit', a, D(n + days), D(d)); truth.push([a, D(d), rate]) }
        for (let d = 0; d < days; d++) {
          for (const [a, m] of money) if (m === n + d) real += a
          real += p.interest(real, rate, D(n + d), D(n + days))
        }
        for (const [a, m] of money) if (m === n + days) real += a
        n += days
        real += p.interest(real, rate, D(n)); n++
      } else if (n > 5 && n < 38 && kind < 0.17) {
        // Two days credited, then taken back and recalculated at a new rate.
        const start = real
        const gross = []
        const money = [amount(), amount()]
        for (let d = 0; d < 2; d++) {
          p.line('Transfer Credit', money[d], D(n + d)); truth.push([money[d], D(n + d), 2])
          real += money[d]; gross.push(Math.round(real * rate / 36500)); real += p.interest(real, rate, D(n + d))
        }
        rate = pick([2, 7, 20, 35, 40, 50])
        for (const d of [1, 0]) p.reverse(gross[d], D(n + d), D(n + 2))
        real = start
        for (let d = 0; d < 2; d++) { real += money[d]; real += p.interest(real, rate, D(n + d), D(n + 2)) }
        n += 2
        for (let d = 0; d < 3; d++, n++) real += p.interest(real, rate, D(n))
      } else {
        if (rnd() < 0.25) { const a = amount(); p.line('Transfer Credit', a, D(n)); truth.push([a, D(n), rate]); real += a }
        real += p.interest(real, rate, D(n)); n++
      }
    }
    assert.equal(p.balance, real)
    const imp = p.read()
    assert.equal(imp.expected.get(D(n - 1)), real / 100, `run ${run}: final balance`)
    appAgrees(imp)
    const got = new Map(imp.transactions.map(t => [Math.round(t.amount * 100), t.date]))
    for (const [a, day, r] of truth) {
      // A day's interest on it must be more than rounding to tell the day at all.
      if (a * r / 36500 > 2) assert.equal(got.get(a), day, `run ${run}: ${a}`)
    }
  }
})

// The oldest imports know a line only by "reference or booking date:amount".
test('older references: equal lines are paired one to one, and every date comes out right', () => {
  const { whole } = lateStatement()
  const right = importInto(empty, [whole])
  const oldRef = `${D(7)}:-1000`
  const orders = right.transactions.filter(t => t.noFee)
  assert.equal(orders.length, 2)
  const lines = buildImport([whole]).transactions.map(t => (t.noFee ? { ...t, id: newId(), legacyRefs: [oldRef] } : { ...t, id: newId() }))
  const plan = (stored, incoming = lines) => planImport({
    existing: [...right.transactions.filter(t => !t.noFee), ...stored], lines: incoming, anchors: [],
    currentRates: right.rates, foundRates: [], useRates: false, period: { from: D(1), to: D(12) }, newId,
  })
  const old = (t, date) => ({ ...t, ref: oldRef, date })
  // The standing orders' dates once the plan is carried out.
  const dates = (stored, incoming) => {
    const p = plan(stored, incoming)
    assert.equal(new Set(p.moved.map(m => m.id)).size, p.moved.length, 'no line is moved twice')
    return [...stored.map(t => p.moved.find(m => m.id === t.id)?.date ?? t.date), ...p.add.filter(t => t.noFee).map(t => t.date)].sort()
  }
  const [a, b] = orders
  const one = lines.filter(l => l.ref !== b.ref)
  assert.deepEqual(dates([old(a, D(6)), old(b, D(6))]), [D(7), D(7)], 'two stored, two on the statement')
  assert.deepEqual(dates([old(a, D(6))]), [D(7), D(7)], 'one stored, two on the statement: the other is added')
  assert.deepEqual(dates([old(a, D(6)), old(b, D(6))], one), [D(6), D(7)], 'two stored, one on the statement')
  assert.deepEqual(dates([old(a, D(6)), old(b, D(9))]), [D(7), D(9)], 'one you changed yourself stays')
  assert.deepEqual(dates([a, b].map(t => ({ ...t, date: D(6) }))), [D(7), D(7)], 'full references')
  assert.deepEqual(dates([{ ...a, date: D(6) }, old(b, D(6))]), [D(7), D(7)], 'one of each')
  // Only one of the two is late: the other keeps its date.
  const mixed = lines.map(l => { if (l.ref !== b.ref) return l; return { ...l, oldDate: undefined, date: D(6) } })
  for (const stored of [[old(a, D(6)), old(b, D(6))], [old(b, D(6)), old(a, D(6))], [old(a, D(6))]]) assert.deepEqual(dates(stored, mixed), [D(6), D(7)])
  // Nothing is added twice when both kinds of old reference are stored.
  const keyed = lines.map((l, k) => (l.noFee ? { ...l, legacyRefs: [`y:key${k}`, oldRef] } : l))
  const firstKey = keyed.find(l => l.noFee).legacyRefs[0]
  for (const stored of [[{ ...a, ref: firstKey }, old(b, D(7))], [old(b, D(7)), { ...a, ref: firstKey }]]) assert.deepEqual(plan(stored, keyed).add, [])
  // A different line that happens to share the older reference is not its pair.
  const other = { ...lines.find(l => l.ref === a.ref), id: 'cash', ref: 'y:other', noFee: false, amount: 9.98, date: D(6), legacyRefs: [oldRef] }
  delete other.oldDate
  assert.deepEqual(plan([old(a, D(6))], [other, ...one]).add.map(t => t.id), ['cash'])
})

test('second review 1: a single old line is still corrected by its old reference', () => {
  const { whole } = lateStatement()
  const right = importInto(empty, [whole])
  const [one] = right.transactions.filter(t => t.noFee)
  const line = { ...buildImport([whole]).transactions.find(t => t.ref === one.ref), id: 'new', legacyRefs: ['OLD:-1000'] }
  const { moved, add } = planImport({
    existing: [{ ...one, ref: 'OLD:-1000', date: D(6) }], lines: [line], anchors: [],
    currentRates: right.rates, foundRates: [], useRates: false, period: { from: D(1), to: D(12) }, newId,
  })
  assert.deepEqual([moved, add], [[{ id: one.id, from: D(6), date: D(7) }], []])
})

test('second review 2: a deposit you entered by hand is not added again when its date is corrected', () => {
  const rates = [{ from: D(1), annualRate: 40, serviceCharge: 10 }]
  const plan = (own, lines) => planImport({
    existing: own, lines, anchors: [], currentRates: rates, foundRates: [], useRates: false, period: { from: D(1), to: D(30) }, newId,
  })
  const line = (id, date, oldDate) => ({ id, type: 'deposit', amount: 500, date, ref: `y:1:${id}`, noFee: false, legacyRefs: [], ...(oldDate ? { oldDate } : {}) })
  const own = (id, date) => ({ id, type: 'deposit', amount: 500, date })
  // Matched at its old date by an earlier version: still the same money.
  const p = plan([own('mine', D(6))], [line('a', D(20), D(6))])
  assert.deepEqual([p.add, p.matched.map(m => m.own.id)], [[], ['mine']])
  // A line on the entry's own date has first claim to it.
  for (const order of [[0, 1], [1, 0]]) {
    const lines = [line('a', D(20), D(6)), line('b', D(6))]
    const q = plan([own('mine', D(6))], order.map(k => lines[k]))
    assert.deepEqual([q.add.map(t => t.id), q.matched.map(m => m.line.id)], [['a'], ['b']])
  }
  // Without an old date nothing changes: two weeks apart is other money.
  assert.equal(plan([own('mine', D(6))], [line('a', D(20))]).add.length, 1)
  assert.ok(!('oldDate' in plan([], [line('a', D(20), D(6))]).add[0]), 'working notes are not stored')
})

test('entries you added by hand are shared out so that none is counted twice', () => {
  const rates = [{ from: D(1), annualRate: 40, serviceCharge: 10 }]
  const line = (id, date, oldDate) => ({ id, type: 'deposit', amount: 500, date: D(date), ref: `y:1:${id}`, noFee: false, legacyRefs: [], ...(oldDate ? { oldDate: D(oldDate) } : {}) })
  const added = (own, lines) => planImport({
    existing: own.map(n => ({ id: `own${n}`, type: 'deposit', amount: 500, date: D(n) })), lines, anchors: [],
    currentRates: rates, foundRates: [], useRates: false, period: { from: D(1), to: D(40) }, newId,
  }).add.map(t => t.id)
  // Every order of the lines gives the same answer.
  const orders = (list) => (list.length < 2 ? [list] : list.flatMap((x, i) => orders([...list.slice(0, i), ...list.slice(i + 1)]).map(rest => [x, ...rest])))
  const always = (own, lines, expected) => { for (const o of orders(lines)) assert.deepEqual(added(own, o).sort(), expected, `${o.map(l => l.id)}`) }
  always([4, 9], [line('a', 8, 6), line('b', 10)], [])
  // Two corrected lines, one entry each: the one with a choice makes room.
  always([4, 9], [line('a', 8, 6), line('b', 30, 10)], [])
  always([4, 9, 14], [line('a', 8, 6), line('b', 13, 10), line('c', 30, 15)], [])
  // Not enough entries: exactly one line is new.
  for (const o of orders([line('a', 8, 6), line('b', 10), line('c', 30, 9)])) assert.equal(added([4, 9], o).length, 1)
  // Ordinary lines are matched as before: to the nearest entry.
  assert.deepEqual(added([1, 4], [line('a', 4), line('b', 7)]), ['b'])
})
