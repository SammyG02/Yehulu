// Reads Yehulu account statements (the "Account Statement" PDF) and turns them
// into transactions the app can import. Checked against real statements.
//
// The PDF is a table: Book Date | Reference | Description | Value Date | Debit
// | Credit | Closing Balance. PDF.js gives each piece of text with its position,
// so every amount is read from the column it sits in.
//
// What becomes what:
//   - Credits (Transfer Credit, Cash Deposit, ...)        -> deposits
//   - Withdrawals and transfers out include Yehulu's 0.2% fee: 10,020.00 is a
//     withdrawal of 10,000 (the app adds the fee back itself)
//   - Standing orders have no fee                          -> withdrawals, no fee
//   - Interest and its service charge ("Debit Arrangement") are skipped: the
//     app works them out, and they are used only to find the rates.

import { addDays, daysBetween } from './dates.js'
import { periodOn, simulateLedger, withdrawalFee } from './interest.js'

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' }
const DATE = /^(\d\d) ([A-Z]{3}) (\d\d)$/
// Amounts: 1,000.50 (Yehulu's style) and also 1.000,50, 1 000.50 or 1000.50,
// with a minus written as -1,000.50, 1,000.50-, (1,000.50) or 1,000.50 DR.
const AMOUNT = /^(?:-\s?|\()?\d{1,3}(?:[.,\s\u00a0']?\d{3})*[.,]\d\d(?:\s?-|\)|\s?(?:DR|Dr|CR|Cr))?$/

/** "03 JAN 26" -> "2026-01-03" */
const toDateKey = (text) => {
  const m = DATE.exec(text.trim())
  return m && MONTHS[m[2]] ? `20${m[3]}-${MONTHS[m[2]]}-${m[1]}` : null
}
/** "1,000.50" / "1.000,50" / "(1,000.50)" / "1,000.50-" / "1,000.50 DR" -> santim (negative when marked so). */
const toCents = (text) => {
  const t = text.trim()
  const negative = /^-|^\(|-$|\)$|DR$/i.test(t)
  // The last . or , before two digits is the decimal point; the rest group thousands.
  const digits = t.replace(/\s?(DR|CR)$/i, '').replace(/[^\d.,]/g, '')
  const whole = digits.slice(0, -3).replace(/[.,]/g, '')
  const cents = Number(whole + digits.slice(-2))
  return negative ? -cents : cents
}
const round2 = (x) => Math.round(x * 100) / 100

const INTEREST = 'Interest - Capitalise'
const KNOWN_TYPES = ['Interest - Capitalise', 'Debit Arrangement', 'Standing Order', 'Cash Withdrawal', 'Cash Deposit', 'Transfer Credit', 'Transfer Debit']

/**
 * The line's kind and the rest of its text. The kind can wrap onto a second
 * line ("Interest -" / "Capitalise"), so known kinds are matched on the whole
 * text first: an interest line must never be mistaken for a deposit.
 */
const describe = (parts) => {
  const all = parts.join(' ').replace(/\s+/g, ' ').trim()
  const known = KNOWN_TYPES.find(k => all.toLowerCase().startsWith(k.toLowerCase()))
    ?? KNOWN_TYPES.find(k => all.replace(/\s/g, '').toLowerCase().startsWith(k.replace(/\s/g, '').toLowerCase()))
  if (known) {
    // Drop the words that make up the kind; the rest is the narrative.
    let rest = all
    for (const word of known.split(' ')) rest = rest.replace(new RegExp(`^\\s*${word.replace(/[-]/g, '\\-')}`, 'i'), '')
    return { type: known, narrative: rest.trim() }
  }
  return { type: parts[0] ?? '', narrative: parts.slice(1).join(' ') }
}
const CHARGE = 'Debit Arrangement'
const NO_FEE = /standing order/i

/**
 * One statement from PDF.js text, page by page:
 *   pages: [[{ str, x, y, width }], ...]   (x, y: bottom-left, PDF units)
 * Returns { accountNo, holder, printed, opening, closing, rows } with amounts
 * in santim and rows: [{ bookDate, ref, type, narrative, valueDate, amount, balance }]
 * (amount signed: + credit, - debit). Throws if it doesn't look like one.
 */
export function parseStatementPages(pages) {
  let columns = null
  let accountNo = null
  let holder = null
  let printed = null
  let currency = null
  let printedOpening = null
  let printedClosing = null
  const rows = []
  let row = null
  let textChars = 0

  for (const items of pages) {
    const texts = items.filter(t => t.str.trim())
    textChars += texts.reduce((n, t) => n + t.str.trim().length, 0)
    // A row cut off at the bottom of the previous page continues at the top
    // of this one (until the next row starts).
    if (row) row.continues = true
    // The table header gives the column positions (repeated on every page).
    const header = Object.fromEntries(['Book Date', 'Reference', 'Description', 'Value Date', 'Debit', 'Credit', 'Closing Balance']
      .map(name => [name, texts.find(t => t.str.trim() === name)]))
    const pageHasHeader = Object.values(header).every(Boolean)
    if (pageHasHeader) {
      columns = {
        y: header['Book Date'].y,
        ref: header.Reference.x,
        desc: header.Description.x,
        value: header['Value Date'].x,
        debit: header.Debit.x,
        credit: header.Credit.x,
        balance: header['Closing Balance'].x,
      }
    }
    if (!columns) continue

    const labelled = (label) => {
      const at = texts.find(t => t.str.trim() === label)
      return at ? texts.filter(t => Math.abs(t.y - at.y) < 2 && t.x > at.x).sort((a, b) => a.x - b.x) : []
    }
    accountNo ??= labelled('Account :')[0]?.str.trim() ?? null
    holder ??= labelled('Customer :').map(t => t.str.trim()).filter(s => !/^\d+$/.test(s)).join(' ') || null
    printed ??= texts.find(t => /^\d{1,2} [A-Z][a-z]+ \d{4}$/.test(t.str.trim()))?.str.trim() ?? null
    currency ??= labelled('Currency :')[0]?.str.trim() ?? null
    // "Balance at Period Start / End" lines, with their amount on the same row.
    for (const label of texts.filter(t => /^Balance at Period/i.test(t.str.trim()))) {
      const value = texts.find(t => Math.abs(t.y - label.y) < 2 && t.x > columns.debit && AMOUNT.test(t.str.trim()))
      if (!value) continue
      if (/Period S/i.test(label.str)) printedOpening ??= toCents(value.str)
      else if (/Period E/i.test(label.str)) printedClosing = toCents(value.str)
    }

    // Rows start with a book date in the first column; wrapped text below it
    // (a long reference or narrative) belongs to the same row. Only the first
    // page has the header; later pages start straight with rows.
    const top = pageHasHeader ? columns.y - 1 : Infinity
    const body = texts.filter(t => t.y < top).sort((a, b) => b.y - a.y || a.x - b.x)
    for (const t of body) {
      const str = t.str.trim()
      if (t.x < columns.ref - 2 && DATE.test(str)) {
        row = { y: t.y, bookDate: toDateKey(str), ref: '', desc: [], valueDate: null, debit: null, credit: null, balance: null }
        rows.push(row)
        continue
      }
      if (!row) continue
      if (!row.continues && t.y < row.y - 40) { row = null; continue }
      const right = t.x + (t.width ?? 0)
      if (AMOUNT.test(str)) {
        // Debits are right-aligned before the Credit column; credits start in
        // it; the closing balance is the last column.
        if (t.x >= columns.balance - 40 && right > columns.balance) row.balance ??= toCents(str)
        else if (t.x >= columns.credit - 2) row.credit ??= toCents(str)
        else if (right > columns.debit) row.debit ??= toCents(str)
      } else if (t.x >= columns.value - 2 && t.x < columns.debit && DATE.test(str)) {
        row.valueDate ??= toDateKey(str)
      } else if (t.x >= columns.desc - 2 && t.x < columns.value - 2) {
        row.desc.push(str)
      } else if (t.x >= columns.ref - 2 && t.x < columns.desc - 2) {
        row.ref += str
      }
    }
  }

  if (!columns) {
    throw new Error(textChars < 20
      ? 'This PDF has no readable text: it looks like a scan or photo. Download the statement from Yehulu as a PDF instead.'
      : "This doesn't look like a Yehulu account statement.")
  }
  if (currency && currency.toUpperCase() !== 'ETB') {
    throw new Error(`This statement is in ${currency}. Yehulu tracks Birr (ETB) only.`)
  }

  // The balance column is the bank's own running total, so it's the truth:
  // every line must move it by exactly its amount. Where the amount is
  // missing, it comes from the balance; where a debit/credit is the wrong way
  // round, the balance says which it is. Anything else is refused.
  // Newest first? Read it oldest first (the balance column then chains forwards).
  const dated = rows.filter(r => r.balance != null)
  const withBalance = dated.length > 1 && dated[0].bookDate > dated.at(-1).bookDate ? [...dated].reverse() : dated
  if (withBalance.length === 0) throw new Error('No transactions found in this statement.')
  const clean = []
  const fixes = []
  let prev = printedOpening
  for (const r of withBalance) {
    const written = r.credit != null ? r.credit : r.debit != null ? -Math.abs(r.debit) : null
    let amount = written
    if (prev != null) {
      const moved = r.balance - prev
      if (written == null) { amount = moved; fixes.push({ date: r.bookDate, what: 'missing amount, taken from the balance' }) }
      else if (written !== moved && -written === moved) { amount = moved; fixes.push({ date: r.bookDate, what: 'debit/credit swapped to match the balance' }) }
      else if (written !== moved && clean.length === 0 && prev === printedOpening) {
        throw new Error(`The statement's opening balance (${(printedOpening / 100).toFixed(2)}) doesn't match its first line. The statement may be damaged.`)
      } else if (written !== moved) {
        throw new Error(`On ${r.bookDate} the amount (${(written / 100).toFixed(2)}) doesn't match the change in balance (${(moved / 100).toFixed(2)}). The statement may be damaged.`)
      }
    } else if (written == null) {
      throw new Error(`The first line (${r.bookDate}) has no amount and there's no opening balance to work it out from.`)
    }
    if (amount === 0) { prev = r.balance; continue }
    clean.push({
      bookDate: r.bookDate,
      ref: r.ref,
      ...describe(r.desc),
      valueDate: r.valueDate ?? r.bookDate,
      amount,
      balance: r.balance,
    })
    prev = r.balance
  }
  if (clean.length === 0) throw new Error('No transactions found in this statement.')
  const opening = printedOpening ?? clean[0].balance - clean[0].amount
  const closing = clean.at(-1).balance
  if (printedClosing != null && printedClosing !== closing) {
    throw new Error(`The statement's closing balance (${(printedClosing / 100).toFixed(2)}) doesn't match its transactions (${(closing / 100).toFixed(2)}). Part of it may be missing.`)
  }
  // Without the printed closing balance, a statement cut off at the end can't be noticed.
  return {
    accountNo, holder, printed, currency, opening, closing, rows: clean, fixes,
    // The printed balances were found and agree: nothing is cut off at either end.
    openingConfirmed: printedOpening != null,
    closingConfirmed: printedClosing != null,
  }
}

const MAX_BYTES = 20 * 1024 * 1024
const MAX_PAGES = 500

/** A statement PDF that needs a password (`.needsPassword` on the error). */
export class PasswordNeeded extends Error {
  constructor(wrong) {
    super(wrong ? 'That password is not right.' : 'This PDF is protected with a password.')
    this.needsPassword = true
  }
}

/**
 * Reads a statement PDF file in the browser (or Node, for tests). PDF.js runs
 * in a separate worker with scripts and font code evaluation off, and only
 * text is taken from the file.
 */
export async function readStatementPdf(data, password = '') {
  if (data.byteLength > MAX_BYTES) throw new Error('This file is too big for a statement (over 20 MB).')
  // The "legacy" build also runs on older phones (e.g. iPhones before iOS 17.4).
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  }
  let doc
  try {
    doc = await pdfjs.getDocument({ data, password, isEvalSupported: false, enableXfa: false, verbosity: 0 }).promise
  } catch (err) {
    if (err?.name === 'PasswordException') throw new PasswordNeeded(Boolean(password))
    throw new Error("This file couldn't be opened as a PDF. It may be damaged.", { cause: err })
  }
  if (doc.numPages > MAX_PAGES) { await doc.destroy(); throw new Error(`This PDF has ${doc.numPages} pages; statements up to ${MAX_PAGES} pages can be read.`) }
  const pages = []
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const { items } = await (await doc.getPage(p)).getTextContent()
      pages.push(items.map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width })))
    }
  } catch (err) {
    throw new Error('Part of this PDF is damaged and could not be read.', { cause: err })
  } finally {
    // Always close the document (and the password it was opened with).
    await doc.destroy()
  }
  return parseStatementPages(pages)
}

/** The withdrawal that, with its 0.2% fee, comes to `totalCents`. Null if none does. */
const withoutFee = (totalCents) => {
  const guess = round2(totalCents / 100 / 1.002)
  for (const x of [guess - 0.01, guess, guess + 0.01].map(round2)) {
    if (Math.round((x + withdrawalFee(x)) * 100) === totalCents) return x
  }
  return null
}

/**
 * Rates from the interest lines: each day's interest = closing x rate / 365,
 * rounded to the santim, so each line pins the rate to a narrow range. Runs of
 * days with a common rate become one period, from the day it first applied.
 */
function findRates(lines) {
  const periods = []
  let lo = 0
  let hi = Infinity
  let start = null
  let days = 0
  const close = () => {
    if (start && days >= 2) {
      // The roundest rate that fits: whole percent, then halves, quarters, cents.
      const nice = [1, 2, 4, 100].map(step => Math.ceil(lo * step - 1e-9) / step).find(r => r <= hi + 1e-9) ?? round2((lo + hi) / 2)
      const last = periods.at(-1)
      if (!last || last.annualRate !== nice) periods.push({ from: start, annualRate: nice })
    }
  }
  for (const { day, interest, base } of lines) {
    if (base <= 0 || interest <= 0) continue
    // Annual rate (in %) that rounds to this interest.
    const a = ((interest - 0.5) * 36500) / base
    const b = ((interest + 0.5) * 36500) / base
    if (start && Math.max(lo, a) <= Math.min(hi, b)) {
      lo = Math.max(lo, a); hi = Math.min(hi, b); days++
    } else {
      close()
      lo = a; hi = b; start = day; days = 1
    }
  }
  close()
  return periods
}

/**
 * Turns one or more statements of the same account into what to import.
 * Overlapping statements are fine: rows already seen are skipped.
 * Returns {
 *   accountNo, holder, from, to, opening, closing (Br),
 *   transactions: [{ type, amount, date, note, ref, noFee }],
 *   rates: [{ from, annualRate }],
 *   expected: Map(day -> Yehulu's balance at the end of that day, after interest),
 *   gaps: [{ after, before }]   (statements that don't follow on from each other)
 * }
 */
export function buildImport(statements) {
  if (statements.length === 0) throw new Error('No statements.')
  const currencies = new Set(statements.map(s => s.currency?.toUpperCase()).filter(Boolean))
  if (currencies.size > 1) throw new Error('These statements are in different currencies.')
  const accounts = new Set(statements.map(s => s.accountNo).filter(Boolean))
  if (accounts.size > 1) throw new Error('These statements are for different Yehulu accounts. Import one account at a time.')
  const sorted = [...statements].sort((a, b) => a.rows[0].bookDate.localeCompare(b.rows[0].bookDate))

  const seen = new Set()
  const rows = []
  const gaps = []
  const starts = [] // where each statement's own rows begin
  sorted.forEach((s, i) => {
    const prev = sorted[i - 1]
    keyRows(s.rows)
    if (prev && !s.rows.some(r => seen.has(r.key)) && prev.closing !== s.opening) {
      gaps.push({ after: prev.rows.at(-1).bookDate, before: s.rows[0].bookDate })
    }
    starts.push(rows.length)
    const source = sourceOf(s)
    for (const r of s.rows) {
      if (seen.has(r.key)) continue
      seen.add(r.key)
      rows.push({ ...r, source })
    }
  })

  // Interest Yehulu later took back (when a rate change was backdated) and its
  // reversal cancel out; the recalculated line that follows is what counts.
  const reversed = new Set()
  rows.forEach((r, i) => {
    if (r.type === INTEREST && r.amount < 0) {
      reversed.add(i)
      for (let j = i - 1; j >= 0; j--) {
        if (!reversed.has(j) && rows[j].type === INTEREST && rows[j].amount === -r.amount) { reversed.add(j); break }
      }
    }
  })

  // Which day each interest line is for. Booking and value dates are each
  // sometimes off by a day (a day booked early, a repeated value date), so
  // each line is the day after the previous one, unless its value date
  // jumps further ahead.
  const dayOf = new Map()
  let lastDay = null
  rows.forEach((r, i) => {
    if (r.type !== INTEREST || reversed.has(i) || r.amount <= 0) return
    const byValue = addDays(r.valueDate, -1)
    const day = lastDay && addDays(lastDay, 1) > byValue ? addDays(lastDay, 1) : byValue
    dayOf.set(i, day)
    lastDay = day
  })
  // A deposit or withdrawal counts from its value date, or from the day of the
  // interest that follows it if that comes first (that's how Yehulu credits it).
  const nextInterestDay = new Array(rows.length).fill(null)
  for (let i = rows.length - 1, next = null; i >= 0; i--) {
    if (dayOf.has(i)) next = dayOf.get(i)
    nextInterestDay[i] = next
  }
  const dateOf = (r, i) => (nextInterestDay[i] && nextInterestDay[i] < r.valueDate ? nextInterestDay[i] : r.valueDate)

  const accountTag = (first => first?.accountNo ?? '')(sorted[0])
  const transactions = []
  const interestLines = []
  const expected = new Map()
  const first = sorted[0]
  const firstDay = [...dayOf.values()][0] ?? rows[0].bookDate
  if (first.opening > 0) {
    const date = rows[0].bookDate < firstDay ? rows[0].bookDate : firstDay
    transactions.push({ type: 'deposit', amount: first.opening / 100, date, note: 'Opening balance (statement)', ref: `opening-${date}`, noFee: false, source: sourceOf(first) })
  }
  let balance = first.opening
  rows.forEach((r, i) => {
    const prevBalance = balance
    balance = r.balance
    if (r.type === INTEREST) {
      if (!dayOf.has(i)) return
      // The interest is on the balance just before it (that day's closing).
      interestLines.push({ day: dayOf.get(i), interest: r.amount, base: prevBalance })
      const charge = rows[i + 1]?.type === CHARGE ? rows[i + 1] : null
      expected.set(dayOf.get(i), (charge ? charge.balance : r.balance) / 100)
      return
    }
    if (r.type === CHARGE) return
    // The line's fingerprint (not the file name or the reference text, which
    // can wrap differently between two printouts of the same statement).
    // Which Yehulu account it came from, plus the line's fingerprint.
    const ref = fitRef(`y:${accountTag}:${r.key}`)
    const legacyRefs = [`y:${r.key}`, `${r.ref || r.bookDate}:${r.amount}`]
    const date = dateOf(r, i)
    const note = r.type.slice(0, 60)
    if (r.amount > 0) {
      transactions.push({ type: 'deposit', amount: r.amount / 100, date, note, ref, legacyRefs, noFee: false, source: r.source })
      return
    }
    const total = -r.amount
    const base = NO_FEE.test(r.type) ? null : withoutFee(total)
    transactions.push(base == null
      ? { type: 'withdrawal', amount: total / 100, date, note, ref, legacyRefs, noFee: true, source: r.source }
      : { type: 'withdrawal', amount: base, date, note, ref, legacyRefs, noFee: false, source: r.source })
  })

  const from = transactions.map(t => t.date).sort()[0] ?? rows[0].bookDate
  const rates = findRates(interestLines)
  // The first rate also covers everything before it.
  if (rates.length) rates[0] = { ...rates[0], from }
  // Fixed points: Yehulu's balance at the end of each statement's first day.
  // Whatever history the app has (or lacks) before it, it must reach this.
  const anchors = []
  for (const start of starts) {
    const i = [...dayOf.keys()].find(k => k >= start)
    if (i == null || !rows[start]) continue
    const day = dayOf.get(i)
    // `start`: where that statement begins, to tell a missing statement (history
    // before it) from an odd first credit (nothing before it).
    if (!anchors.some(a => a.date === day)) anchors.push({ date: day, value: expected.get(day), start: rows[start].bookDate })
  }
  return {
    accountNo: first.accountNo,
    holder: first.holder,
    from,
    to: lastDay ?? rows.at(-1).bookDate,
    opening: first.opening / 100,
    closing: balance / 100,
    transactions,
    rates,
    expected,
    anchors,
    gaps,
    fixes: sorted.flatMap(s => s.fixes ?? []),
    unconfirmed: sorted.filter(s => s.closingConfirmed === false || s.openingConfirmed === false).length,
  }
}

/**
 * A fingerprint for each statement line that's the same in every printout of
 * it: date, kind, amount and the balance after it. (Two identical lines on
 * one day with the same balance after them are told apart by their order.)
 */
function keyRows(rows) {
  const count = new Map()
  for (const r of rows) {
    const fp = `${r.bookDate}|${r.type.slice(0, 24)}|${r.amount}|${r.balance}`
    const n = count.get(fp) ?? 0
    count.set(fp, n + 1)
    r.key = n ? `${fp}#${n}` : fp
  }
}

// How far apart (in days) your own entry and the statement's line may be and
// still be the same money (a deposit made late in the day, a weekend).
const MATCH_DAYS = 3

const isBridge = (t) => Boolean(t.ref?.startsWith('gap-'))
const isOpening = (t) => Boolean(t.ref?.startsWith('opening-'))
const signed = (t) => (t.type === 'deposit' ? t.amount : -(t.amount + (t.noFee ? 0 : withdrawalFee(t.amount))))

/** The app's balance at the end of `day` (after that day's interest). */
const endOf = (transactions, rates, day) => {
  const before = transactions.filter(t => t.date <= day)
  if (!before.length) return 0
  return simulateLedger({ transactions: before, rates, fromDate: day, endDate: day }).at(-1).balance
}

/**
 * Bridges that make the app reach every anchor: if the balance at the end of
 * an anchor day isn't the statement's, a bridge on the next day makes up the
 * difference. With complete history there's nothing to bridge; with a
 * statement missing, the bridge carries the balance over the gap; at the very
 * start it covers Yehulu's odd first credit.
 */
export function bridgesFor(transactions, anchors, rates) {
  const bridges = []
  for (const { date, value, start, missing } of [...anchors].sort((a, b) => a.date.localeCompare(b.date))) {
    const app = endOf([...transactions, ...bridges], rates, date)
    const amount = round2(value - app)
    if (Math.abs(amount) < 0.01) continue
    const hasHistory = missing ?? transactions.some(t => t.date < (start ?? date) && !isOpening(t))
    bridges.push({
      type: amount > 0 ? 'deposit' : 'withdrawal',
      amount: Math.abs(amount),
      date: addDays(date, 1),
      note: hasHistory ? 'Missing statement (until it is imported)' : 'Statement difference (first credit)',
      // Includes the amount: a recalculated bridge is a new line, so adding it
      // before removing the old one never collides.
      ref: `gap-${date}:${amount}`,
      noFee: true,
    })
  }
  return bridges
}

/**
 * What importing does to one person's money in an account. Pure, so the app
 * and the tests run exactly the same steps.
 *   existing: that person's transactions now ([] for a new account)
 *   lines: the statements' transactions (with ids); anchors: from buildImport
 *   currentRates / foundRates: [{ from, annualRate, serviceCharge }] (percent)
 *   useRates: put the found rates into the history (for the statements' days)
 *   period: { from, to } of the statements; newId: ids for new bridges
 * Returns { add, remove (ids), rates (new history, or null), skipped, bridges }.
 *
 * Statements can come in any order and with gaps: each import recomputes the
 * bridges from every anchor, so a missing statement is carried over until it
 * arrives, and then its bridge goes.
 */
export function planImport({ existing, lines, anchors, currentRates, foundRates, useRates, period, newId }) {
  // Never mix two Yehulu accounts in one person's money: the other account's
  // balances would be forced onto this one's history (its anchors).
  const incoming = statementAccounts(lines)
  const already = statementAccounts(existing)
  const foreign = [...incoming].filter(no => already.size && !already.has(no))
  if (foreign.length) {
    throw new AccountMismatch([...already], foreign)
  }
  const fractions = (list) => list.map(r => ({ from: r.from, annualRate: r.annualRate / 100, serviceCharge: (r.serviceCharge ?? 10) / 100 }))
  const rates = useRates && foundRates.length ? mergeRates(currentRates, foundRates, period.from, period.to) : null
  const before = fractions(currentRates)
  const after = fractions(rates ?? currentRates)

  // Anchors the account already has, read back from its bridges (and from
  // statement opening balances) as things stand now.
  const oldBridges = existing.filter(isBridge)
  const real = existing.filter(t => !isBridge(t))
  const known = new Set(real.map(t => t.ref).filter(Boolean))
  // Lines imported by an earlier version of the app carry the older reference.
  // Lines imported by earlier versions of the app carry older references.
  const fresh = lines
    .filter(t => !isBridge(t) && !(t.ref && known.has(t.ref)) && !(t.legacyRefs ?? []).some(r => known.has(r)))
    .map(({ legacyRefs: _legacy, ...t }) => t)

  // Money you entered yourself (no statement reference) that is the same as a
  // statement line: same kind, same amount, within 3 days. It's already
  // counted, so the statement's copy isn't added. Your entry is left as it is.
  const own = real.filter(t => !t.ref)
  const used = new Set()
  const matched = []
  const added = fresh.filter(line => {
    if (isOpening(line)) return true
    const candidates = own
      .filter(m => !used.has(m.id) && m.type === line.type && Math.abs(m.amount - line.amount) < 0.005
        && Math.abs(daysBetween(m.date, line.date)) <= MATCH_DAYS)
      .sort((a, b) => Math.abs(daysBetween(a.date, line.date)) - Math.abs(daysBetween(b.date, line.date)))
    if (!candidates.length) return true
    used.add(candidates[0].id)
    matched.push({ own: candidates[0], line })
    return false
  })
  // Your own entries in the statement's period that it doesn't show: listed
  // for you to check, never changed.
  const unmatchedOwn = own.filter(t => !used.has(t.id) && t.date >= period.from && t.date <= period.to)
  let base = [...real, ...added]
  const oldAnchors = oldBridges.map(b => {
    const day = addDays(b.date, -1)
    const missing = b.note?.startsWith('Missing') ? undefined : false
    return { date: day, value: round2(endOf(existing, before, day) + signed(b)), missing }
  })

  // An opening balance is only needed where there's no history before it.
  const openings = base.filter(t => isOpening(t) && base.some(o => o.date < t.date && !isOpening(o)))
  const openingAnchors = openings
    .filter(t => existing.some(e => e.id === t.id))
    .map(t => ({ date: t.date, value: round2(endOf(existing, before, t.date)) }))
  const dropped = new Set(openings.map(t => t.id))
  base = base.filter(t => !dropped.has(t.id))

  // Newest knowledge wins: the statements being imported, then the account's.
  const byDate = new Map()
  for (const a of [...oldAnchors, ...openingAnchors, ...anchors]) byDate.set(a.date, a)
  const bridges = bridgesFor(base, [...byDate.values()], after)

  // Keep bridges that didn't change, so nothing moves needlessly.
  const same = (a, b) => a.date === b.date && a.type === b.type && Math.abs(a.amount - b.amount) < 0.005
  const keep = new Set(oldBridges.filter(o => bridges.some(b => same(o, b))).map(o => o.id))
  const newBridges = bridges.filter(b => !oldBridges.some(o => keep.has(o.id) && same(o, b))).map(b => ({ ...b, id: newId() }))
  const addedKept = added.filter(t => !dropped.has(t.id))
  return {
    add: [...addedKept, ...newBridges],
    remove: [...oldBridges.filter(o => !keep.has(o.id)).map(o => o.id), ...existing.filter(t => dropped.has(t.id)).map(t => t.id)],
    rates,
    skipped: lines.length - addedKept.length - matched.length,
    matched,
    unmatchedOwn,
    bridges,
  }
}

/** Statements of one Yehulu account going into money that holds another's. */
export class AccountMismatch extends Error {
  constructor(already, incoming) {
    super(`This money already holds statements from Yehulu account ••${already.map(a => a.slice(-4)).join(', ••')}; `
      + `this statement is from ••${incoming.map(a => a.slice(-4)).join(', ••')}. Import it into its own account.`)
    this.already = already
    this.incoming = incoming
  }
}

/** References are stored up to 80 characters: longer ones keep their start and a fixed hash of the whole. */
function fitRef(ref) {
  if (ref.length <= 80) return ref
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < ref.length; i++) {
    h1 = Math.imul(h1 ^ ref.charCodeAt(i), 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ ref.charCodeAt(i), 0x5bd1e995) >>> 0
  }
  return `${ref.slice(0, 62)}~${h1.toString(36)}${h2.toString(36)}`.slice(0, 80)
}

/** Yehulu account numbers whose statements are already in these transactions. */
export function statementAccounts(transactions) {
  const found = new Set()
  for (const t of transactions) {
    const m = /^y:([^:|]+):/.exec(t.ref ?? '')
    if (m) found.add(m[1])
  }
  return found
}

/**
 * Compares the app's ledger with the statement, day by day. Returns
 * { matched, days, firstDifference: { date, app, yehulu } | null, end: { app, yehulu } }.
 */
export function compareWithStatement(ledger, expected) {
  const byDate = new Map(ledger.map(r => [r.date, r.balance]))
  let matched = 0
  let days = 0
  let firstDifference = null
  for (const [date, yehulu] of expected) {
    if (!byDate.has(date)) continue
    days++
    const app = byDate.get(date)
    if (Math.abs(app - yehulu) < 0.005) matched++
    else firstDifference ??= { date, app, yehulu }
  }
  const lastDay = [...expected.keys()].at(-1)
  return { matched, days, firstDifference, end: { date: lastDay, app: byDate.get(lastDay) ?? null, yehulu: expected.get(lastDay) ?? null } }
}

/**
 * Puts a statement's rates into an account's existing history: only the days
 * the statement covers change. The rate in force before and after it stays.
 *   existing, found: [{ from, annualRate, ... }]
 */
export function mergeRates(existing, found, from, to) {
  if (!found.length) return existing
  if (!existing.length) return found
  const after = addDays(to, 1)
  const keepBefore = existing.filter(p => p.from < from)
  const keepAfter = existing.filter(p => p.from > to)
  // Only go back to the old rate if the history knows something later; after
  // the newest statement, its rate simply carries on.
  const resume = !keepAfter.length || keepAfter.some(p => p.from === after) ? [] : [{ ...periodOn(existing, after), from: after }]
  const merged = [...keepBefore, ...found, ...resume, ...keepAfter].sort((a, b) => a.from.localeCompare(b.from))
  // Drop periods that don't change the rate.
  return merged.filter((p, i) => i === 0 || p.annualRate !== merged[i - 1].annualRate)
}

// ---- removing imported statements ---------------------------------------------

/**
 * Where a statement's lines came from: "file name|first day|last day". Kept
 * on each imported line so a single file can be removed later.
 */
export const sourceOf = (s) => `${(s.fileName ?? 'Statement').slice(0, 100)}|${s.rows[0]?.bookDate ?? ''}|${s.rows.at(-1)?.bookDate ?? ''}`

/** "STMT(4).pdf|2025-08-14|2026-01-01" -> { file, from, to } */
export const readSource = (source) => {
  const [file, from, to] = String(source ?? '').split('|')
  return file && from && to ? { file, from, to } : null
}

/** The Yehulu account a statement line came from ('' for lines from before account tags), or null if not a statement line. */
const lineAccount = (t) => {
  if (!t.ref?.startsWith('y:')) return null
  const m = /^y:([^:|]+):/.exec(t.ref)
  return m ? m[1] : ''
}

/**
 * The imported statement periods in one person's money, per Yehulu account:
 *   [{ accountNo, from, to, lines }]
 */
export function importedPeriods(transactions) {
  const by = new Map()
  for (const t of transactions) {
    const acct = lineAccount(t)
    if (acct == null) continue
    const src = readSource(t.source)
    // One entry per imported file; older imports (no file recorded) per account.
    const key = src ? `file:${t.source}` : `acct:${acct}`
    const p = by.get(key) ?? (src
      ? { accountNo: acct, source: t.source, file: src.file, from: src.from, to: src.to, lines: 0 }
      : { accountNo: acct, source: null, file: null, from: t.date, to: t.date, lines: 0 })
    if (!src) {
      if (t.date < p.from) p.from = t.date
      if (t.date > p.to) p.to = t.date
    }
    p.lines++
    by.set(key, p)
  }
  return [...by.values()].sort((a, b) => a.from.localeCompare(b.from))
}

/**
 * What removing the statement lines of one Yehulu account between `from` and
 * `to` does to one person's money. Your own entries are never removed.
 * Statements after that period keep matching the bank: their balance is
 * carried over the gap by a bridge (as if that statement was never
 * imported), and importing it again fills the gap back in.
 *   existing: that person's transactions; rates: fractions
 * Returns { remove (ids), add (bridges), removed: { deposits, withdrawals } }.
 */
export function planRemoval({ existing, accountNo, from, to, source = null, rates, newId }) {
  const inRange = (t) => t.date >= from && t.date <= to
  // Removing one file: its lines, except days another imported file of that
  // account also covers (that file still needs them).
  const others = source
    ? [...new Set(existing.filter(t => t.source && t.source !== source && lineAccount(t) === accountNo).map(t => t.source))]
      .map(readSource).filter(Boolean)
    : []
  const coveredElsewhere = (t) => others.some(o => t.date >= o.from && t.date <= o.to)
  const target = existing.filter(t => lineAccount(t) === accountNo && inRange(t)
    && (!source || (t.source === source && !coveredElsewhere(t))))
  const kept = source ? existing.filter(t => t.source === source && !target.includes(t)).length : 0
  const openings = existing.filter(t => isOpening(t) && inRange(t) && (!source || t.source === source))
  const oldBridges = existing.filter(isBridge)
  const gone = new Set([...target, ...openings].map(t => t.id))

  // Fixed points to keep: those the account already has (from its bridges),
  // except inside the removed period, and the balance at the end of the period
  // if statements of that account carry on after it.
  const anchors = oldBridges
    .map(b => ({ date: addDays(b.date, -1), value: round2(endOf(existing, rates, addDays(b.date, -1)) + signed(b)), missing: b.note?.startsWith('Missing') ? undefined : false }))
    .filter(a => !(a.date >= from && a.date <= to))
  const later = existing.some(t => lineAccount(t) === accountNo && t.date > to)
  if (later) anchors.push({ date: to, value: round2(endOf(existing, rates, to)), missing: true })

  const base = existing.filter(t => !gone.has(t.id) && !isBridge(t))
  // With nothing of that account left at all, its stand-ins go too.
  const anyLeft = base.some(t => lineAccount(t) != null)
  const bridges = anyLeft ? bridgesFor(base, anchors, rates) : []
  const same = (a, b) => a.date === b.date && a.type === b.type && Math.abs(a.amount - b.amount) < 0.005
  const keep = new Set(oldBridges.filter(o => bridges.some(b => same(o, b))).map(o => o.id))
  return {
    remove: [...gone, ...oldBridges.filter(o => !keep.has(o.id)).map(o => o.id)],
    add: bridges.filter(b => !oldBridges.some(o => keep.has(o.id) && same(o, b))).map(b => ({ ...b, id: newId() })),
    removed: {
      deposits: target.filter(t => t.type === 'deposit').length,
      withdrawals: target.filter(t => t.type === 'withdrawal').length,
      keptForOthers: kept,
    },
  }
}
