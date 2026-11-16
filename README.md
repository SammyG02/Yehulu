# Yehulu Savings Tracker

Track a Yehulu savings account: daily compound interest, interest earned so far, projections, and a goal planner. Built mobile-first with a bottom tab bar on phones and a top navigation bar on larger screens. Light and dark themes.

Data stays on the device (localStorage). Back it up or restore it from **Settings → Data**.

## Sections

| Page | What it's for |
|---|---|
| **Home** | Balance, today's interest, quick deposit/withdraw, stats, a 30-day chart, goal progress, recent activity |
| **Activity** | Every transaction grouped by month, with filters. Tap one to edit or delete it |
| **Growth** | Projection chart (1 month to 2 years), the savings goal planner, and a day-by-day ledger |
| **Settings** | A short menu: **Logic** (rate, service charge), **Theme**, **Data** (backup, restore, delete). Add sections in `src/pages/settings/sections.js` |

## How interest is calculated

- The **annual rate** depends on the account type (default 40%) and is set in **Settings → Logic**.
- A **service charge** is taken from the interest, not the balance (default 10%).
- Interest is **credited daily** (annual rate ÷ 365), so each day's interest earns interest from then on. At 40% minus 10%, that's about 43.31% a year.
- Money **starts earning the day after it's deposited**. A day's interest is paid on the balance that was in the account for the whole day, so a withdrawal stops earning on the day it's taken out.

The maths lives in [`src/lib/interest.js`](src/lib/interest.js) and is covered by tests.

## Development

```bash
npm install
npm run dev     # local dev server
npm test        # maths and storage tests (Node's built-in test runner)
npm run build   # production build
```

On Windows, open the project as `C:\...` rather than `c:\...`. Vite can fail to resolve modules when the drive letter case doesn't match.

## Structure

```
src/
  lib/          Pure logic, no React: interest maths, dates, formatting, storage + migrations
  state/        savings.jsx (data, actions, the add/edit sheet, toasts) and theme.jsx
  pages/        One file per section: Home, Activity, Growth, and settings/ (menu + one file per settings section)
  components/
    layout/     App shell, top bar, bottom tab bar, navigation items
    ui/         Building blocks: Card, Button, Field, Segmented, Sheet, Amount
    transactions/, charts/   Feature pieces shared between pages
```

All changes to data go through the actions in `state/savings.jsx`. Pages only read from it.
