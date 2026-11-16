# Team Log

This is the shared source of truth between sessions. The PM, the Developer and the QA Engineer each append entries. Newest entries go at the bottom; never edit someone else's entry.

**Format:** `### YYYY-MM-DD · Who`, then four lines: **Done**, **Blocked**, **Next** and, when something slipped, **Why it slipped**.

Tickets and their "Done when" lines are in [ROADMAP.md](ROADMAP.md).

## Workflow

1. The PM assigns a ticket.
2. The Developer builds it and logs what changed, plus anything that differs from the ticket and why.
3. The QA Engineer verifies it against the "Done when" line (tests, build, 360px and desktop, light and dark) and logs pass or fail with steps to reproduce.
4. The PM reviews any differences from the ticket (better or worse?), ticks the roadmap box and adds a row to the Review log.
5. Only then does the next ticket start. One ticket in progress at a time.

---

### 2026-11-16 · PM
- **Done:** Baseline review. Tests pass 14/14 and the build is clean. Wrote ROADMAP.md (Sprints 1–3) and added tick boxes to the tickets.
- **Blocked:** S1-3 rounding rule needs a decision from the product owner (does Yehulu round daily interest to the cent?). Raised with the user.
- **Next:**
  - Developer: S1-1, then S1-2 through S1-5 in order.
  - QA Engineer: verify S1-1 as soon as it's logged as done.
- **Why it slipped:** S1-1 (P0) was in the plan but never handed to anyone, because the roadmap assumed the Developer would pick it up. **Process fix:** the PM now assigns every ticket by direct message, and a ticket only counts as started once it is logged here.

### 2026-11-16 · CEO
- **Done:** Reviewed the repo. Tests pass 14/14 and the build is clean, but about 2,400 lines are uncommitted. Briefed the PM, Developer and QA Engineer.
- **Blocked:** Two product-owner decisions: the S1-3 rounding rule, and whether deleting fix.js is intended.
- **Next:**
  - Developer: S1-1 now.
  - QA Engineer: test plans for S1-2 and S1-3, plus tests for storage and dates.
  - PM: enforce one ticket at a time and propose an ESLint setup for approval.
- **Gaps to close:** no tests for storage/dates/format, no UI tests, no lint config.

### 2026-11-16 · PM
- **Done:** Added S1-6 (ESLint + splitting the test files) to ROADMAP.md as a proposal.
- **Blocked:** S1-6 needs the user's approval for 4 ESLint dev dependencies. Also waiting on the user for the rounding rule and for fix.js.
- **Next:** Waiting for the Developer to log S1-1. QA may start the storage/dates/format test split now (no new dependencies needed).
- **Correction to the CEO's gap list:** storage *is* partly tested already. `migrate` and bad-data handling are tested inside interest.test.js, and so is `addMonths`. The real gaps are `parseBackup`, `sanitizeGoal`, `format.js` and `isDateKey`.
- **Why it slipped (PM, same day):** I told QA to start the test split while S1-1 was still uncommitted. The same files would have been edited by two sessions at once. Corrected within minutes. **Process fix:** never assign parallel work on uncommitted files. Parallel work only starts after the working tree is committed.

### 2026-11-16 · Developer
- **Done:** S1-1. Committed the restructure on branch `redesign` in 5 commits:
  1. lib + tests, including QA's `dates.test.js` and `storage.test.js`
  2. deps/config, plus removing `fix.js`
  3. state + hooks
  4. components + pages + styles
  5. README + docs
  - `npm test` now runs every file in `src/lib/` (38 tests: 35 pass, 3 todo, 0 fail). `git status` is clean.
- **Differs from ticket:**
  - Config is committed *before* the components (the ticket listed them the other way round), so every commit builds. The UI needs `react-router` and the font package from `package.json`.
  - Deleting `fix.js` was treated as intended. It was a broken one-off script, and the user asked to remove unwanted files.
- **Blocked:**
  - Nothing is pushed, so there's no PR and no Vercel build yet. Pushing needs the user's OK.
  - `main` only gets this work once `redesign` is merged.
- **Next:** QA verifies S1-1. After it passes: S1-2 (rate history).

### 2026-11-16 · PM
- **Done:**
  - Reviewed S1-1: PASS (partial). Logical commits on `redesign`, clean tree, build OK. Committing to a branch was safer than committing straight to main.
  - Reproduced QA's lock-out bug and added it as P0 ticket S1-1b, ahead of S1-2, as the CEO decided.
  - Added QA's restore bugs, date range and goal copy fixes to S1-5, and the failed-save warning to S1-4.
  - ESLint (S1-6) is approved as dev-only.
- **Blocked:**
  - S1-1 "builds on Vercel" waits on the user to merge/push.
  - S1-3 has 2 product-owner questions: rounding, and checking against the balance before or after that day's interest.
- **Next:**
  - Developer: S1-1b now.
  - QA: sign off S1-1 in parallel, then write the S1-1b regression test plan.
- **Process note:** the Developer starts S1-1b before QA's formal S1-1 sign-off. This is safe because S1-1 is committed and changes no code, so no files are shared. One ticket in development at a time still holds.
- **Why it slipped (PM):** the Developer (S1-1b) and QA (test refactor) edited `src/lib/*.test.js` in the same working tree at the same time. **Process fix:** a file-ownership rule. While a ticket is open, only its owner edits the files it touches. QA commits its own test files separately, or works in a separate git worktree.
- **Early S1-1b review (PM):** `findNewOverdraft` also rejects changes that make an existing overdraft deeper. That's stricter than the ticket and accepted as better.
- **Rule addendum (from the CEO):** QA announces a file in a message before editing it. Every commit uses explicit paths, never `git add -A`. Option to close S1-1: push `redesign` to get a Vercel preview build (waiting on the user).
- **Correction (PM, after the CEO's note):** `git add -p` is interactive and can't run in our sessions. The rule is now `git add <explicit paths>` only. If a file contains changes from two people, its owner commits the whole file and the other person waits. Never split a file between people.

### 2026-11-16 · QA Engineer
- **Done:**
  - **S1-1 verified: PASS for the local part, "Done when" not fully met.**
    - Checked: `git status` was clean after commit `58dac6d`; 6 logical commits on `redesign` (lib + tests, config, state + hooks, components + pages, docs, log); `npm test` and `npm run build` pass at the branch head; no `dist/` or `node_modules/` tracked; `fix.js` removal is in its own config commit.
    - Not met: "`main` builds on Vercel". `main` is still at `61de651` and `redesign` is not pushed. Keep the ticket open until the user merges and pushes.
    - Not checked: that each of the 6 commits builds on its own (the Developer's claim; I only built the head).
  - **Test coverage (the test half of S1-6):** `npm test` now runs 4 files, 46 tests: 41 pass, 0 fail, 5 todo.
    - New `storage.test.js`, `dates.test.js` (both in `d785f26`) and `format.test.js` (uncommitted).
    - Moved the v1 migration test from `interest.test.js` to `storage.test.js`; removed the bad-data and `addMonths` tests from `interest.test.js` because the new files cover them more fully. `interest.test.js` now only tests `interest.js`. These two edits are uncommitted.
    - Covers the PM's list: `parseBackup` errors, `sanitizeGoal`, `isDateKey('2026-02-30')`, `formatDuration`, `formatAmount(-0.004)`.
  - Sent test plans for S1-2, S1-3 and S1-1b to the Developer.
- **Known bugs held as `todo` tests** (they report but don't fail the suite; remove `{ todo: true }` when fixed):
  1. `storage.test.js`: an imported amount such as `"1e400"` is kept as Infinity. Repro: restore a backup containing `"amount": "1e400"`; the balance shows ∞.
  2. `storage.test.js`: duplicate transaction ids in a backup are kept. Repro: restore a backup with two transactions with `"id": 1`; editing one edits both.
  3. `storage.test.js`: a blank or null saved rate loads as 0%. Repro: `sanitizeAccount({ annualRate: '' })` returns 0, not 40.
  4. `format.test.js`: `formatAmount(-0.3, { whole: true })` returns `"-0"`.
  5. `format.test.js`: the goal planner prints "today sooner" when top-ups make no difference (`formatDuration(0)` followed by "sooner").
- **Blocked:** no manual checks at 360px/desktop or light/dark have been run yet. S1-1 changed no behaviour, so none were needed; they start with S1-1b.
- **Next:** verify S1-1b when the Developer logs it, including the Home banner by hand.
- **Why it slipped:** my first log entry, written before the log format changed, failed to save and was not noticed until later. Its content is in this entry.

### 2026-11-16 · PM
- **Done:**
  - Accepted QA's S1-1 sign-off. The ticket stays `[~]` until the user merges or pushes.
  - Test half of S1-6 accepted: 4 test files. Splitting dates and format into separate files is better than my brief.
  - Added the "-0" format bug and the "today sooner" copy bug to S1-5.
  - QA's rate-schedule gap is resolved by scope: S1-1b stays single-rate, and S1-2 must extend `findNewOverdraft` to rate schedules (now in S1-2's spec).
- **State now:** 52 tests, 47 pass, 0 fail, 5 todo. S1-1b in progress (the Developer's overdraft.test.js is in the tree).
- **Blocked:** the user's 4 decisions (push redesign, rounding, before/after interest, device install).
- **Next:** the Developer finishes S1-1b, then QA runs its 27-check plan.

### 2026-11-16 · QA Engineer
- **Done:**
  - Committed QA-owned test files with explicit paths: `1ace675` (`format.test.js`, `storage.test.js`) and a follow-up commit for `interest.test.js` (migration and `addMonths` tests removed; it now tests `interest.js` only). `npm test`: 52 tests, 47 pass, 0 fail, 5 todo, including the Developer's uncommitted `overdraft.test.js`.
- **Blocked:** nothing.
- **Next:** verify S1-1b when the Developer logs it.
- **Why it slipped:** I ran `git checkout -- src/lib/interest.test.js` to undo a broken script of my own, without checking for other uncommitted changes in that file. It discarded 3 S1-1b tests the Developer had just written there. The Developer rewrote them in `overdraft.test.js`. **Process fix:** I don't edit or restore files a ticket in progress touches; before any restore I check `git diff` on the exact file; QA work that overlaps a ticket goes in a separate git worktree.

### 2026-11-16 · PM
- **Why it slipped (QA incident):** QA ran `git checkout` on interest.test.js and threw away 3 S1-1b tests the Developer had just written. The Developer rewrote them, so nothing was lost for good. QA owned up to it and logged it, which was the right call.
- **New rule:** never run `git checkout -- <file>`, `git restore`, `git reset --hard`, `git stash` or `git clean` on a file you don't own, or in the shared tree while someone else has a ticket open. To undo your own experiment, delete or fix only the files you created, or work in a separate worktree from the start.
- **Docs commits:** ROADMAP.md and TEAM_LOG.md are committed by the Developer, using explicit paths and as a separate commit, when each ticket closes. Everyone keeps only appending to TEAM_LOG.

### 2026-11-16 · Developer
- **Done:** S1-1b, in commit "Fix overdraft check blocking all new transactions" on `redesign`.
  - New pure `findNewOverdraft(before, after, rates)` in interest.js. It rejects a change only if it pushes a day below zero that wasn't before, or makes an already-negative day worse.
  - add, update and delete in savings.jsx use it.
  - Validation reads a ref that always holds the latest data, so it never uses a stale render-time value. This also covers the S1-5 stale-state item.
  - The delete warning wording is now neutral ("Deleting this leaves…"), not "Without this deposit".
  - Home shows a compact banner with role="status" when the history goes below zero: "went" for a past date, "will go" for a future one. It links to Activity.
  - Tests are in the new `src/lib/overdraft.test.js` (owned by Developer). It covers the PM repro and QA plan items 1–3, 5, 7–12, 14–16 and 18–20. npm test: 60 tests, 55 pass, 5 todo, 0 fail.
  - Browser-checked QA repro 25 at 360px light/dark and on desktop: a deposit is accepted on overdrawn history, a deepening withdrawal is rejected, and the banner shows.
- **Differs from ticket:**
  - Stricter than "compare first overdraft date". It also blocks deepening an existing overdraft (PM accepted this).
  - The tests are in overdraft.test.js, not interest.test.js, to avoid edit collisions.
  - QA 7: a 10 withdrawal on D-8 is reported at D-5, the day it deepens. A 200 withdrawal is reported at D-8.
- **Blocked:** none. Push/merge still waits on the user.
- **Deferred to S1-2 (QA 22):** the helper takes one `rates` for both sides, so editing a past rate period can't be checked with it yet.
- **Next:** QA verifies S1-1b, then S1-6 (ESLint, separate commit), then S1-2.
