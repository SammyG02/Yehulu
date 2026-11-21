# Yehulu API for Chinka

Read-only access to a Yehulu user's savings, given by that user.

## How a user connects

1. In Yehulu, the user goes to **Settings → Connected apps → Connect Chinka**.
2. They choose all their accounts, or only some.
3. Yehulu shows an **access key** once. It looks like `ykn_` followed by 64 hex characters.
4. The user pastes the key into Chinka. Store it the way you store passwords (Keychain or Keystore, or encrypted on your server).

The user can **disconnect** at any time in the same screen. From then on the key returns `401`, and Chinka should ask them to connect again.

## The request

```
GET https://yehulu-tracking.vercel.app/api/chinka/v1/data
Authorization: Bearer ykn_...
```

**Optional query parameters:**

| Parameter | Meaning |
|---|---|
| `account=<id>` | Return only this account |
| `daily=0` | Leave out the day-by-day interest rows. The response is much smaller; use it for a quick balance refresh. |

The endpoint accepts `GET` only. CORS is open, so it can also be called from a browser.

## The response

The response is JSON. Amounts are Birr (ETB) as numbers with 2 decimals, and dates are `YYYY-MM-DD`.

```jsonc
{
  "version": 1,
  "currency": "ETB",
  "today": "2026-11-21",            // in Ethiopia (Africa/Addis_Ababa)
  "generated_at": "2026-11-21T06:12:00.000Z",
  "user": { "name": "Samuel" },
  "accounts": [
    {
      "id": "6f1c…",
      "name": "My savings",
      "your_role": "owner",          // owner | member | guest
      "shared": false,
      "rates": [ { "from": "2025-08-14", "annual_rate": 50, "service_charge": 10 }, … ],
      "your_rates": [ … ],           // the user's own rate if the owner set one, else = rates
      "goal": { "target": 500000, "monthly": 10000 },   // target may be null
      "you": {
        "balance": 755443.53,        // today's balance (today's interest is added tonight)
        "deposited": 577158.36,
        "withdrawn": 0,
        "fees_paid": 0,
        "interest": { "to_date": 179915.99, "this_month": 14748.68, "today": 745.09 },
        "monthly": [ { "month": "2026-11", "interest": 14748.68, "balance": 755443.53, "so_far": true }, … ],
        "daily": [                   // left out with ?daily=0
          { "date": "2026-11-20", "balance": 755443.53, "interest": 827.22, "service_charge": 82.72,
            "credited": 744.50, "deposits": 0, "withdrawals": 0, "fees": 0 }, …
        ]
      },
      "total_balance": 755443.53,    // shared accounts the user may see in full; otherwise absent
      "members": [                   // same condition as total_balance
        { "id": "…", "name": "Samuel", "role": "owner", "is_you": true, "balance": 755443.53, "interest_to_date": 179915.99 }
      ],
      "transactions": [
        { "id": "…", "member_id": "…", "is_you": true, "type": "withdrawal", "date": "2026-09-03",
          "amount": 1996.01, "fee": 3.99, "note": "Cash Withdrawal",
          "from_statement": true, "stand_in": false }
      ]
    }
  ]
}
```

## What the numbers mean

**How Yehulu calculates** (it matches Yehulu's own statements to the santim):
- Interest is paid every day on that day's closing balance: annual rate ÷ 365, rounded to the santim.
- A 10% service charge is taken from each day's interest, also rounded.
- What's left is credited overnight and compounds.

**Withdrawals and fees:**
- `amount` is what the person took out.
- `fee` is Yehulu's 0.2% on top of that. The money that left the account is `amount + fee`, the figure a bank statement or SMS shows.
- Some debits, such as standing orders, have `fee: 0`.

**Transaction flags:**
- `from_statement: true` means the transaction was imported from a Yehulu statement PDF.
- `stand_in: true` marks a balancing line Yehulu adds in two cases: a statement is missing, or the bank's first interest credit was unusual. It isn't real money moving. You may want to hide it from transaction lists, but keep it when adding up balances.

**Balances:**
- `you.balance` is today's balance. Today's interest (`interest.today`) is added tonight.
- After the user's last statement, Yehulu assumes no further deposits or withdrawals unless the user added them.

**Shared accounts:** the user sees what Yehulu shows them.
- **Owner, or "members see everyone's money" on:** everyone's transactions, plus `members` and `total_balance`.
- **Otherwise:** only their own transactions; `members` and `total_balance` are absent.

## Errors

| Status | Meaning | What to do |
|---|---|---|
| 401 | Missing, malformed, unknown or disconnected key | Ask the user to connect again |
| 405 | Not a GET request | Use GET |
| 502 / 503 | Yehulu temporarily unavailable | Retry later, with backoff |

Error bodies look like `{ "error": "…" }`.

## Good to know

- **Polling:** data changes only when the user adds a transaction or imports a statement. Refreshing a few times a day is plenty, and `?daily=0` keeps routine refreshes light.
- **Privacy:** never log the key or send it anywhere but this endpoint. Yehulu stores only a fingerprint of it, so a lost key can't be recovered: the user disconnects and creates a new one.
- **Versions:** the path includes `v1`. Fields may be added later, but existing ones won't change meaning without a new version.
