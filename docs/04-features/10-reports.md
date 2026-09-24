# Reports

This document specifies Reports: the read-only views that turn the auto-tracked ledger into answers — how much went out this period, where it went, how income compared to spending, and how the pattern moves across periods. It defines each report type, the transfer-exclusion rule that keeps totals honest, the free (basic monthly) versus Plus (full + trends + custom range) split, and the exact CSV export column specification.

**Status:** Draft v1 · 2026-08-02

## Purpose

Reports answer the questions users currently answer with screenshots and mental math: "magkano ba talaga ang nagastos ko?" (how much did I really spend?). Because ingest fills the ledger passively, Reports require zero data entry — they are the proof that passive tracking worked. Reports live in the **More** tab, read only committed Transactions, always exclude Transfer Links from spend and income totals, and never modify ledger data. Reports also owns the user-facing surfacing of **recurring/subscription detection** — the "₱X/month locked in" summary (MVP scope item L3-2; entity in [../02-domain-model.md](../02-domain-model.md) §3.10, promotion to Bill in [07-bills.md](07-bills.md)). Depth (trends, custom ranges, export, recurring detection) is where Plus earns its keep; the free monthly view must still genuinely answer the core question.

## User stories

- As a user at katapusan (end of month), I want to see my total spend for the month, so that I know whether I lived within my means without adding anything up myself.
- As a user, I want a category breakdown, so that I can see whether Food & Dining or Shopping (Shopee, Lazada, TikTok Shop) is eating my sahod.
- As a user, I want money-in versus money-out for the period, so that I can see whether I ended positive or negative.
- As a user who moves money between GCash and my bank often, I want internal transfers excluded from totals, so that moving my own money never inflates my "spending."
- As a Plus subscriber, I want spending trends across months, so that I can see whether things are improving.
- As a Plus subscriber, I want a custom date range, so that I can report on a school semester or a 13th-month bonus window, not just calendar months.
- As a Plus subscriber, I want to export a CSV, so that I can analyze in a spreadsheet or share numbers with my spouse.
- As a free user, I want my older data kept even though I can't view past 90 days, so that upgrading later unlocks my full history rather than starting from zero.

## UX states & flows

### Report types

| Report | What it shows | Tier |
|---|---|---|
| Period spend | Total `out` for the period (Transfer Links excluded), average daily spend, comparison against the matching Limit if one exists, top merchants | Free (monthly) |
| Category breakdown | Spend per top-level Category with % share; drill down into subcategories; Uncategorized always shown as its own slice | Free (monthly) |
| In vs. out | Total `in`, total `out`, and net for the period (both totals exclude Transfer Links) | Free (monthly) |
| Trend over periods | Spend (and optional net) per period across the last 6 or 12 periods, as period-over-period bars | Plus |
| Custom range | Any of the above computed over an arbitrary start–end date range | Plus |
| Recurring & subscriptions | Detected RecurringPatterns (suggested vs acknowledged) and the "₱X/month locked in" total | Plus |

### States

| State | Trigger | Display |
|---|---|---|
| Empty | No committed Transactions in the selected period | Friendly empty state with the Lucide `Send` mark: "Nothing tracked in this period yet," plus a link to check listener health if the period includes today ([11-settings-privacy.md](11-settings-privacy.md)) |
| Normal | Transactions exist | Report renders with totals, charts, and drill-downs |
| Partial-history notice | Selected period extends earlier than the first tracked Transaction | Banner: "Tracking started on <date> — earlier days have no data" |
| Gated | Free user navigates past the 90-day history window, or opens Trends / custom range | Locked preview with Plus prompt; no data shown, nothing deleted (see Free vs Plus) |
| Review Queue notice | Items awaiting confirmation overlap the period | Caption: "N transactions awaiting review are not included" ([08-review-queue.md](08-review-queue.md)) |

### Key flows

**Flow A — Monthly review (Free)**
1. User opens More → Reports. Default view: current calendar month.
2. Period spend, category breakdown, and in-vs-out render for that month.
3. Back/forward arrows step through prior months within the 90-day history window; older months render the Gated state. A month counts as inside the window when its FIRST day is (owner's ruling, 2026-09-24, settling GAP-024 in favour of this rule over the code that had clamped Free to the current month). On September 24 that offers July, August and September, and refuses June, whose first day is 115 days back.
4. Tapping a category slice drills into its subcategories; tapping a subcategory lists its Transactions (each opens the standard transaction detail).

**Flow B — Trend review (Plus)**
1. User switches to the Trends tab within Reports.
2. Bars render for the last 6 periods (toggle to 12). Default metric: spend; a toggle adds net.
3. Tapping a bar jumps to that period's full report.

**Flow C — Custom range (Plus)**
1. User taps the period selector → "Custom range."
2. Start and end dates picked on a calendar; the range may cross month boundaries.
3. All report types recompute over the range; average daily spend uses the range's day count.

**Flow D — CSV export (Plus)**
1. From any report view, user taps Export → CSV.
2. A summary sheet states what will be exported: the Transactions underlying the current view (period or custom range, after transfer exclusion rules — see Rule 10) and the row count.
3. The file is generated on-device and handed to the Android share sheet; the user picks the destination (email, drive, messaging app). No network activity by the app itself.
4. Free users see the Export action in a locked state with a Plus prompt.

**Flow E — Recurring & subscriptions ("₱X/month locked in", Plus)**
1. Surfaces: its **own screen** at More → Subscriptions (`mobile/app/(tabs)/more/subscriptions.tsx`, a sibling of `more/reports.tsx` rather than a section inside it) and a summary card on Home showing the headline total — both placed per [../06-information-architecture.md](../06-information-architecture.md). Free users see a locked preview showing only the count of detected patterns, never merchants, amounts, or the total ([../05-monetization.md](../05-monetization.md) §3.2, §5).
2. The section lists RecurringPatterns ([../02-domain-model.md](../02-domain-model.md) §3.10) in two groups: **Suggested** (unacknowledged detections — merchant, amount, period, last seen) and **Locked in** (acknowledged).
3. Actions on a suggested pattern: **Acknowledge** (confirms it as a real recurring commitment; it enters the locked-in total), **Dismiss** (creates a suppressing UserRule so the same pattern is never re-surfaced), or **Make this a bill** (opens the prefilled promotion flow in [07-bills.md](07-bills.md); promotion acknowledges the pattern and links it to the new Bill).
4. The headline "₱X/month locked in" figure is the sum of acknowledged, not-Bill-linked patterns' amounts normalized to a monthly equivalent (Rule 17).

## Rules & edge cases

1. **Transfer exclusion.** Transactions with a `transferLinkId` are excluded from all spend and income totals, category breakdowns, in-vs-out, and trends (invariant 2 in [../02-domain-model.md](../02-domain-model.md)). They still exist in the ledger and still affect Wallet balances — Reports simply never counts them.
2. **Committed ledger only.** Reports read committed Transactions. Review Queue items are excluded until confirmed; the Review Queue notice discloses this whenever items overlap the period.
3. **Period definition.** Standard periods are calendar months in device-local time. "This month" begins on the 1st at 00:00 local time.
4. **Spend** = sum of `amount` over Transactions with `direction: out` and no `transferLinkId` in the period, across all Wallets. **Income** = same with `direction: in`. **Net** = income − spend.
5. **Category breakdown covers spend only** (`direction: out`). Incoming money is not attributed to spending categories in MVP.
6. **Uncategorized is never hidden.** It renders as its own slice with a nudge to categorize via the Review Queue or transaction editing — visible Uncategorized pressure is deliberate hygiene.
7. **Refunds and reversals count as income.** An incoming refund is `direction: in`; it does not net against the original category's spend in MVP. This is an accepted simplification (see Open questions).
8. **Reports are computed views, not snapshots.** Re-categorizing a Transaction, linking/unlinking a Transfer Link, or editing an amount retroactively changes historical reports the next time they render.
9. **History gating hides, never deletes.** For free users, periods older than 90 days are not viewable, but the underlying Transactions are retained. Upgrading to Plus makes full history immediately viewable. Nothing is ever deleted by tier logic.
10. **Export scope.** The CSV contains exactly the Transactions underlying the current view: the selected period or custom range, all Wallets, committed only. Transfer-linked Transactions **are included as rows** (flagged via `is_transfer` / `transfer_link_id`) so exported Wallet math still balances, but any summary rows are computed with them excluded — consistent with on-screen totals.
11. **Raw notification text is never exported.** The CSV carries structured fields only; `rawNotificationRef` content stays on-device (invariant 3). Sample notification texts shown anywhere in Reports UI or documentation are illustrative only.
12. **Deterministic file format.** CSV is UTF-8 with a header row, comma-delimited, RFC 4180 quoting, rows in ascending `timestamp` order. Numbers use `.` as the decimal separator with no thousands separators regardless of device locale, so spreadsheets parse consistently. **Formula injection is neutralised**: a free-text cell (`wallet`, `category`, `category_parent`, `merchant`, `counterparty`, `reference`, `note`) whose **first** character is `=`, `+`, `-`, `@`, a tab or a CR is prefixed with a single apostrophe and quoted, so a crafted merchant string — `merchant` is derived from third-party notification text — cannot execute when the file is opened in Excel, LibreOffice or Sheets (OWASP CSV injection). Only the leading character is treated this way; the same characters anywhere else in a cell are left exactly as written, so a note reading "Budget = tight" round-trips unchanged. Numeric and date columns (`amount`, `date`, `time`, `confidence`) are never prefixed.
13. **File naming and lifetime.** `peraplano-transactions-<date>.csv`, one date rather than the range this rule used to promise, as shipped in `csv_export.ts`. The file is **transient**: written to the app's cache directory, handed to the share sheet, then deleted once the share resolves, is cancelled, or fails — a full plaintext copy of the ledger never outlives the export it was made for, and never accumulates beside the encrypted database. If the device has no share target at all, the export raises an error and writes nothing rather than reporting a success the user never saw.
14. **Archived Wallets** ([02-wallets.md](02-wallets.md)) remain in historical reports; their Transactions are history and history does not rewrite.
15. **Trend periods with no data** render as zero-height bars, not gaps, so the axis stays honest.
16. **Currency format** on screen is `₱1,234.56`; in CSV, `amount` carries no currency symbol (the `currency` is PHP by definition in MVP).

### Recurring & subscriptions

17. **Locked-in total.** "₱X/month locked in" = the sum, over acknowledged RecurringPatterns not linked to a Bill, of each pattern's `amount` normalized to a monthly equivalent by `period`: weekly × 52 ÷ 12, monthly × 1, annual ÷ 12. Patterns promoted to or linked with a Bill are excluded from the total so one obligation is never counted in two surfaces ([07-bills.md](07-bills.md), rules 28–29).
18. **Suggestion hygiene.** Unacknowledged patterns surface as suggestions only and never enter the locked-in total. Dismissal creates a suppressing UserRule so the pattern is never re-surfaced; a pattern whose confidence decays below the floor is removed silently ([../02-domain-model.md](../02-domain-model.md) §3.10). RecurringPatterns are derived data — recomputing or deleting them never changes any Transaction.
19. **Recurring gating.** Detection surfacing is Plus, gated at the Entitlements call-site. The Free locked preview shows the count of detected patterns only — a labeled preview frame, never real gated data behind a blur ([../05-monetization.md](../05-monetization.md) §5). On upgrade, patterns computed from the full retained history appear immediately.

### CSV column specification (Plus export)

**The authoritative order is `CSV_HEADER` in `mobile/lib/reports/csv_export.ts`, which ships EIGHTEEN columns, not the fourteen this table was written for.** Two of the differences are deliberate and argued at that file's head: the spec's single `timestamp` ships as `date` + `time`, because the Philippines is one time zone and two sortable columns serve a spreadsheet better than one ISO string; and `is_transfer` ships `yes`/`no` rather than `true`/`false`, because it reads better in a cell. The rest are additive (`id`, `currency`, `wallet_type`, `category_parent`, `counterparty`, `reference`) and cost nothing. Do not reorder or rename without updating that file's own reconciliation comment.

| # | Column | Type / format | Source | Notes |
|---|---|---|---|---|
| 1 | `id` | string | Transaction | Stable identifier for dedupe on re-import elsewhere |
| 2 | `date` + `time` | `YYYY-MM-DD` and `HH:MM`, two columns | Transaction `occurredAt` | Ships as two columns, not one `timestamp`; see the note above |
| 3 | `amount` | decimal, 2 places, e.g. `1234.56` | Transaction `amount` | No `₱`, no thousands separators |
| 4 | `direction` | `in` \| `out` | Transaction `direction` | |
| 5 | `wallet` | string | Wallet `name` | |
| 6 | `wallet_type` | `bank` \| `e-wallet` \| `cash` \| `credit` \| `savings` | Wallet `type` | |
| 7 | `category` | string | Category `name` | Empty when Uncategorized has not been resolved is not possible — Uncategorized is itself a Category and appears by name |
| 8 | `category_parent` | string | Category `parentId` → parent `name` | Empty for top-level categories |
| 9 | `merchant` | string | Transaction `merchant` | Normalized merchant string |
| 10 | `source` | `notification` \| `manual` \| `recurring-rule` \| `import` | Transaction `source` | |
| 11 | `confidence` | decimal `0..1`, e.g. `0.97` | Transaction `confidence` | `1.00` for manual entries |
| 12 | `is_transfer` | `yes` \| `no` | derived from `transferLinkId?` | `yes` rows are excluded from summary math |
| 13 | `transfer_link_id` | string | Transaction `transferLinkId?` | Empty when not a transfer; both legs share the value |
| 14 | `note` | string | Transaction `note?` | Quoted per RFC 4180; empty when absent |

Excluded by design: `rawNotificationRef` (raw text never leaves the device), Wallet balances (point-in-time values don't belong in a transaction log), and any third-party sender names beyond the normalized `merchant` field.

## Data touched

| Entity | Read | Write |
|---|---|---|
| Transaction | All fields except `rawNotificationRef` content — totals, breakdowns, export rows | — |
| TransferLink | To exclude linked legs from totals and flag export rows | — |
| Category | `name`, `parentId`, `icon` — breakdown grouping and drill-down | — |
| Wallet | `name`, `type` — export columns and filters | — |
| Limit | Matching-period Limit for the spend-vs-Limit comparison in Period spend | — |
| RecurringPattern | `merchant`, `amount`, `period`, `confidence`, `acknowledged` — the Recurring section and the locked-in total | `acknowledged: true` on acknowledge or promotion (rules 17–18) |
| UserRule | — | A suppressing UserRule on dismissal of a pattern (rule 18) |
| Entitlements | `tier` — gates monthly-only vs. full, trends, custom range, export, recurring detection, history window | — |

Reports' period views are strictly read-only; the only writes on this surface are the Recurring section's acknowledge/dismiss actions (RecurringPattern `acknowledged`, suppressing UserRules) — never ledger data.

## Free vs Plus

| Capability | Free | Plus |
|---|---|---|
| Auto-tracking (notification ingest) | Unlimited | Unlimited |
| Wallets | 3 | Unlimited |
| Limits | 1 active | Unlimited + per-category |
| Goals | 1 | Unlimited + payday auto-allocate |
| Loans | 1, basic tracking (balance + next due) | Unlimited + full amortization schedule |
| History | 90 days | Unlimited |
| Reports | Basic monthly | Full + trends + custom range |
| Export | — | CSV (PDF later) |
| Cloud backup / multi-device sync | — | ✓ |
| Recurring/subscription detection | — | ✓ |
| Safe-to-Spend | Today only | Projected to end of period |

Behavior at the gate:

- **Free "Basic monthly"** = period spend + category breakdown + in-vs-out for a single calendar month, navigable across months within the 90-day history window. That answers the core "where did it go" question honestly.
- **Plus "Full + trends + custom range"** adds the trend view, arbitrary date ranges, and unlimited history depth.
- Attempting a gated view (trends, custom range, months older than 90 days) shows a locked preview and a Plus prompt — data is kept, creation of nothing is involved, and nothing is ever deleted. Upgrade instantly unlocks the full retained history.
- **Recurring/subscription detection is Plus.** The Recurring section and the Home locked-in card render for Free as a locked preview with the detection count only; on upgrade, patterns and the total appear immediately, computed from retained history.
- **CSV export is Plus.** Free users see the Export action disabled with the Plus prompt. (The separate export-everything control in [11-settings-privacy.md](11-settings-privacy.md) is a privacy right and is not gated; the §7 Export row refers to this Reports convenience export.)
- PDF export is deliberately later (per the matrix, "PDF later") and is out of MVP scope.

## Acceptance criteria

- [ ] Monthly period spend equals the sum of committed `out` Transactions in the calendar month, excluding all transfer-linked rows.
- [ ] Linking two Transactions as a Transfer Link immediately removes both from period spend, income, category breakdown, and trends; unlinking restores them.
- [ ] Category breakdown percentages sum to 100% (±rounding) and Uncategorized appears whenever it is non-zero.
- [ ] In-vs-out net equals income minus spend for the same period, both computed with transfer exclusion.
- [ ] Review Queue items influence no report figure, and the disclosure caption appears whenever unconfirmed items overlap the period.
- [ ] Re-categorizing a historical Transaction changes the corresponding historical report on next render.
- [ ] Free user: months within 90 days render; older months and Trends/custom-range render the locked preview; after upgrading, full history renders without any data loss.
- [ ] Plus trend view renders 6 and 12 period modes; empty periods render zero bars.
- [ ] Custom range spanning month boundaries computes all three report types over the exact range, with average daily spend using the range's day count.
- [ ] Exported CSV matches `CSV_HEADER` exactly: 18 columns, stated order, header row, UTF-8 with BOM, CRLF line endings, RFC 4180 quoting, ascending timestamps, locale-stable numbers.
- [ ] Exported CSV contains no raw notification text and no `rawNotificationRef` content in any column.
- [ ] Transfer-linked rows appear in the CSV with `is_transfer = yes` and matching `transfer_link_id` values on both legs.
- [ ] Export happens entirely on-device and hands off via the Android share sheet; the app makes no network request in the flow.
- [ ] Empty period renders the empty state with a listener-health link when the period includes today.
- [ ] Acknowledging a RecurringPattern adds its normalized monthly amount to the "₱X/month locked in" total (weekly × 52 ÷ 12, annual ÷ 12); dismissing creates a suppressing UserRule and the pattern never re-surfaces.
- [ ] Promoting a pattern to a Bill opens the prefilled Bill form ([07-bills.md](07-bills.md)) and removes the pattern from the locked-in total.
- [ ] With Entitlements `free`, the Recurring surfaces show a locked preview with the detection count only — no merchants, amounts, or totals.

## Open questions

1. **Refund netting.** Should an incoming refund matched to an earlier purchase (same merchant, close amount) net against that category's spend rather than count as income? MVP says no (Rule 7); netting would need a refund-matching heuristic and a Review Queue confirmation path.
2. **Kinsenas-aligned periods.** Should Plus trends optionally align periods to the user's IncomeProfile cadence (15th–14th halves for kinsenas earners) instead of calendar months? PH salary rhythm makes calendar months a poor lens for many users; this interacts with Limit periods staying calendar-based.
3. **Default trend metric.** Spend-only bars are simplest, but net (in − out) may be the truer "am I improving?" signal. Which is the default, with the other as a toggle?
