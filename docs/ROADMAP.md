# Yehulu Roadmap

This is the working plan. Each ticket says what "done" looks like. When you finish one, tick it and say in the PR what changed versus the ticket, and why.

## Where we are (review of 2026-11-16)

The app is in good shape. It has four sections (Home, Activity, Growth, Settings) and is mobile-first. The interest maths is pure and tested (14/14 passing), and the build is clean. Two problems matter more than anything else:

1. **None of the restructure is committed.** About 2,400 lines across `src/components`, `src/pages`, `src/state`, `src/hooks` and `src/lib` exist only in the working tree.
2. **Accuracy is the product, and two things put it at risk:**
   - Changing the rate in Settings recalculates all past interest at the new rate.
   - Nothing checks our numbers against the real bank balance.

## Definition of done (every ticket)

- `npm test` and `npm run build` pass.
- New logic lives in `src/lib/` as pure functions, with tests in `src/lib/*.test.js`. Add those test files to the `test` script.
- Every data change goes through the actions in `src/state/savings.jsx`.
- If the saved shape changes, bump `SCHEMA_VERSION` and add a migration in `storage.js`, with a test that loads a v2 save.
- Check at 360px wide and on desktop, in both light and dark themes.
- Ask before adding a dependency. The only one pre-approved is `vite-plugin-pwa` for ticket S1-4.

---

## Sprint 1: secure the work and make the numbers trustworthy

### [ ] S1-1 Commit the restructure (P0, do first)
- Commit the current working tree in a few logical commits: lib + tests, state + hooks, components + pages, config (vercel, tailwind, index.html), README.
- Confirm that deleting `fix.js` is intended.
- **Done when:** `git status` is clean and `main` builds on Vercel.

### [ ] S1-2 Rate history: changing the rate does not rewrite the past (P0)
- Store `account.rates: [{ from: 'YYYY-MM-DD', annualRate, serviceCharge }]`, sorted by date. Migrate v2 to v3 by turning the current rates into a single entry dated at the first transaction (or today if there are none).
- `simulateLedger` uses the rate in effect on each day.
- **Settings → Logic:** offer "Change rate from [date]", defaulting to today, plus a list of past rate periods. Editing or deleting a past period should be possible but must warn that it recalculates history.
- **Tests:**
  - A rate change mid-ledger affects only later days.
  - Migration from v2.
  - A zero rate still works.
- **Done when:** changing the rate today leaves "Interest earned" exactly as it was.

### [ ] S1-3 Statement check (reconciliation) (P0)
- Add a "Check against bank" action, on Home (from the balance card) or under Growth. The user enters the balance their Yehulu app or statement shows, and a date (default today).
- Show our balance for that date and the difference. Under 1 Br counts as "Matches"; otherwise explain likely causes (missing transaction, wrong date, rate).
- Save each check (`checks: [{ date, bankBalance }]`) and show the latest one as a small "Last matched [date]" badge.
- **Rounding:** waiting on the product owner. If Yehulu rounds daily interest to the cent, put that behind a single constant in `interest.js` with a test. Don't guess.
- **Done when:** a user can prove the app matches their bank in under 30 seconds.

### [ ] S1-4 Data safety: installable, offline, backed up (P0)
- **PWA:** add a manifest (name, brand green `#24b663`, 192/512 icons plus a maskable icon) and an offline service worker via `vite-plugin-pwa`. Check that it installs on Android Chrome and iOS Safari.
- Call `navigator.storage.persist()` on the first transaction.
- **Backup reminder:** store `lastBackupAt`. If data has changed and the last backup is more than 14 days old (or there has never been one, with 5 or more transactions), show a dismissible nudge on Home linking to Settings → Data.
- **Done when:** the app works in airplane mode after the first load, and a user with no backup is reminded.

### [ ] S1-5 Small fixes found in review (P1)
- **Home "Recent activity" shows future scheduled transactions at the top.** Show only past and today's items, and add a compact "Upcoming" list (next 3) when scheduled items exist.
- **Stale state in `addTransaction` / `updateTransaction`.** They build `next` from the render-time `data.transactions` and then write it, so a cross-tab sync between render and click is lost. Validate against the current state inside the update, or re-read it first.
- **Replace `window.confirm`** (delete, restore, delete all, overdraft delete) with an in-app confirm sheet that uses the existing `Sheet`. Native dialogs look broken in an installed PWA.

### [ ] S1-6 Lint + test coverage (P1, PROPOSED: needs the user's OK for dev dependencies)
- **ESLint:** flat config with `eslint`, `@eslint/js`, `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh` (the standard Vite React set). Rules: recommended plus `react-hooks/exhaustive-deps` as an error. No Prettier; keep the current style.
- Add `npm run lint`, and make it part of the definition of done once it's clean.
- **Tests:** split `interest.test.js` into `interest`, `storage` (migrate, sanitize, parseBackup errors) and `dates`/`format` tests. Point `test` at `node --test src/lib/`.
- No UI test framework yet; QA does manual checks for UI. Revisit when S2-2 (recurring deposits) arrives.
- **Done when:** `npm run lint` passes with no warnings, and storage, dates and format each have their own test file.
- **Order:** QA can write the tests in parallel with S1-2. The Developer adds ESLint after S1-1, as a single commit.

---

## Sprint 2: insight and less typing

### [ ] S2-1 Earnings history (P1)
- A monthly interest card on Growth: a bar chart of interest per month (past months plus the current month to date), the best month, and the average per day this month.
- Pure helper `interestByMonth(ledger)` with a test.

### [ ] S2-2 Recurring deposits (P1)
- In the composer, add "Repeat: none / weekly / monthly" with an optional end date. Store a rule (`recurring: [{ id, type, amount, note, start, every, until }]`), not hundreds of copies.
- Expand rules into the ledger and into Activity as "Scheduled". Allow editing one occurrence or the whole series.
- The goal planner should count these automatically, with no double counting against the monthly top-up.

### [ ] S2-3 Export (P2)
- CSV export of transactions and of the day-by-day ledger, in Settings → Data.

### [ ] S2-4 Activity search (P2)
- Search by note or amount, combined with the existing filters.

---

## Sprint 3: local fit

### [ ] S3-1 Amharic and the Ethiopian calendar (P2)
- An i18n layer (strings moved out of components) with English and Amharic.
- An optional Ethiopian calendar for date display; storage stays Gregorian `YYYY-MM-DD`.

### Later: shared accounts
Friends share one account and each person earns on their own deposits (see the product notes). Don't build this yet. Don't add anything that assumes one user per transaction where it's cheap to avoid, for example keep every transaction as a self-contained record with an `id`.

---

## Review log
| Date | Ticket | Verdict | Notes |
|---|---|---|---|
| 2026-11-16 | Baseline | — | 14/14 tests, build clean, restructure uncommitted |
