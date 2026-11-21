import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import { makeXlsx } from './xlsx.js'
import { buildExport, exportFileName } from './exportBook.js'
import { simulateLedger } from './interest.js'

const open = (bytes) => Object.fromEntries(Object.entries(unzipSync(bytes)).map(([k, v]) => [k, strFromU8(v)]))

test('an .xlsx has every part Excel needs, one sheet file per sheet', () => {
  const parts = open(makeXlsx([{ name: 'One', rows: [['a']] }, { name: 'Two', rows: [[1]] }]))
  for (const p of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    assert.ok(parts[p], p)
  }
  assert.match(parts['xl/workbook.xml'], /name="One".*name="Two"/)
})

test('cells: text is escaped, numbers stay numbers, dates become Excel dates, money is formatted', () => {
  const sheet = open(makeXlsx([{ name: 'S', rows: [['A & <B>', 12.5, { v: '2026-11-21', as: 'date' }, { v: 1000, as: 'money' }, null]] }]))['xl/worksheets/sheet1.xml']
  assert.match(sheet, /A &amp; &lt;B&gt;/)
  assert.match(sheet, /<c r="B1"><v>12.5<\/v><\/c>/)
  // 21 Nov 2026 is day 46347 in Excel's calendar.
  assert.match(sheet, /<c r="C1" s="3"><v>46347<\/v><\/c>/)
  assert.match(sheet, /<c r="D1" s="2"><v>1000<\/v><\/c>/)
  assert.ok(!sheet.includes('r="E1"'), 'empty cells are left out')
})

test('sheet names are made safe and unique', () => {
  const book = open(makeXlsx([{ name: 'a/b:c', rows: [] }, { name: 'a/b:c', rows: [] }, { name: 'x'.repeat(40), rows: [] }]))['xl/workbook.xml']
  assert.match(book, /name="a b c".*name="a b c 2".*name="x{31}"/)
})

test('the export: transactions with fees, every day with interest and charge, months with totals', () => {
  const transactions = [
    { id: '1', type: 'deposit', amount: 200000, date: '2026-10-05', note: '', ref: 'y:3000:k1' },
    { id: '2', type: 'withdrawal', amount: 5000, date: '2026-10-20', note: 'Cash' },
  ]
  const today = '2026-11-19'
  const ledger = simulateLedger({ transactions, rates: [{ from: '2026-01-01', annualRate: 0.4, serviceCharge: 0.1 }], fromDate: today, endDate: today })
  const [tx, daily, monthly] = buildExport({ account: { name: 'My savings' }, view: null, transactions, ledger, today, rate: { annualRate: 40 } })

  const header = 4
  assert.deepEqual(tx.rows[3].map(c => c.v), ['Date', 'Type', 'Amount', 'Fee', 'Money in / out', 'Note', 'Source'])
  const w = tx.rows[header + 1]
  assert.equal(w[3].v, 10, '0.2% fee')
  assert.equal(w[4].v, -5010, 'money out incl. fee')
  assert.equal(tx.rows[header][6], 'Statement')

  assert.equal(daily.rows.length - header, ledger.filter(r => r.date < today).length, 'one row per day before today')
  const first = daily.rows[header]
  assert.equal(first[5].v, 219.18, '200,000 x 40% / 365 = 219.18')
  assert.equal(first[6].v, 21.92)
  assert.equal(first[7].v, 197.26)
  assert.equal(daily.rows.at(-1)[8].v, ledger.find(r => r.date === '2026-11-18').balance)

  assert.deepEqual(monthly.rows.slice(header).map(r => r[0].v ?? r[0]), ['2026-10', '2026-11 (so far)', 'Total'])
  const interestTotal = monthly.rows.at(-1)[4].v
  const ledgerTotal = Math.round(ledger.filter(r => r.date < today).reduce((s, r) => s + r.interest, 0) * 100) / 100
  assert.equal(interestTotal, ledgerTotal)
})

test('shared accounts get a Whose column; file names are safe', () => {
  const [tx] = buildExport({
    account: { name: 'Family' }, view: 'Everyone', today: '2026-11-19', rate: { annualRate: 40 },
    transactions: [{ id: '1', type: 'deposit', amount: 10, date: '2026-11-01', memberId: 'm' }],
    ledger: [], whose: () => 'Hana',
  })
  assert.ok(tx.rows[3].some(c => c.v === 'Whose'))
  assert.equal(exportFileName({ name: 'A/B: savings' }, 'Everyone', '2026-11-19'), 'AB savings - Everyone - 2026-11-19.xlsx')
})
