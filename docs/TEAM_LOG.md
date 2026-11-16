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
