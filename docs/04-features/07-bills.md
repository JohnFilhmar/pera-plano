# Bills

Bills are recurring obligations the user declares once — rent, Meralco, PLDT, tuition, insurance — so that PeraPlano can remind them before the due date, recognize the paying transaction when it appears in the ledger, and mark the bill paid without any manual logging. This document specifies due rules, fixed vs. estimated amounts, reminders, auto-match behavior, overdue handling, and how a detected RecurringPattern is promoted into a Bill.

**Status:** Draft v1 · 2026-08-02

## Purpose

The core promise is *you never log a transaction; you only set the rules*. For Bills, the rule the user sets is "this obligation exists, it is due on this rhythm, and it costs roughly this much." Everything else — the reminder, the recognition of the payment in the ledger, the marking of the cycle as paid, and the updating of the estimated amount — is automatic. Bills also feed Safe-to-Spend directly: any bill due before the tightest active Limit's period ends reduces the number on the home screen (see [09-safe-to-spend.md](09-safe-to-spend.md)). Bills are distinct from Loans (amortized debt with a counterparty and principal — see [06-loans.md](06-loans.md)) and from RecurringPatterns (spend the app *detected* rather than the user *declared* — a pattern can be promoted into a Bill, defined below).

## User stories

- As a renter, I want a bill due every 5th of the month with a reminder 3 days before, so that rent never surprises me.
- As a Meralco customer whose bill varies every month, I want the app to keep an estimated amount that updates itself from what I actually paid, so that my Safe-to-Spend stays realistic without me editing anything.
- As a *kinsenas* earner (paid on the 15th and 30th — the PH twice-monthly norm), I want due dates that land on a weekend to shift to the Friday before, so that I can pay while over-the-counter and payroll timing still work.
- As a GCash user who pays bills in-app, I want the payment notification the app already captured to automatically mark my bill as paid, so that I never tick a checkbox.
- As a forgetful payer, I want overdue bills to be loud and unmissable on the Home tab, so that I do not eat late fees or a Meralco disconnection notice.
- As a Plus subscriber, I want a detected subscription ("₱549.00/month locked in") to become a proper Bill in one tap, so that it gets reminders and Safe-to-Spend treatment.
- As a cash payer, I want to mark a bill paid with a manual cash transaction, so that bills paid at a Bayad Center still show up correctly.

## UX states & flows

Bills live in the **Plan** tab alongside Limits, Goals, and Loans.

### States

| State | When | Display |
|---|---|---|
| Empty | No bills created | `Send` (paper airplane) empty state, one-line pitch, "Add a bill" button. For Plus users with unacknowledged RecurringPatterns: "We spotted 2 recurring payments — turn them into bills?" |
| Normal list | ≥1 bill | Sections in order: **Overdue** (red), **Due today**, **Due soon** (within earliest reminder offset), **Upcoming** (sorted by next due date), **Paid this cycle** (collapsed). Each row: name, amount (estimated amounts prefixed with `~`), due date, state chip. |
| Bill detail | Tap a row | Due rule in plain words ("Every 20th; moves to Friday if it lands on a weekend"), amount and its type, reminder schedule, payment history (matched transactions), auto-match rule summary, actions (edit, skip cycle, mark paid, archive). |
| Cycle paid | Payment matched or manually marked | Green check, matched transaction linked ("Paid ₱2,412.36 on Jan 18 via GCash"), next cycle's date already shown. |
| Overdue | Due date passed, cycle unresolved | Red chip with days overdue; also surfaces as an alert card on **Home**. |
| Error/edge | Reminder notifications blocked | Banner on the Bills list: "Reminders can't be delivered — notifications are off for PeraPlano" with a deep link to system settings. Reminders degrade to in-app cards only. |

### Flow: create a bill

1. Plan tab → Bills → "Add a bill."
2. Name (free text; suggestions from frequent ledger merchants: Meralco, Maynilad, PLDT, Globe, Converge, DITO).
3. Amount: choose **Fixed** (exact ₱) or **Estimated** (starting figure the app will refine).
4. Due rule: pick a pattern (see Rules §Due rules) — e.g., "Every 20th," "Last day of the month (*katapusan*)," "Every 15th and *katapusan*," "Every 2 weeks on Friday" — plus weekend adjustment (none / earlier / later).
5. Reminders: default preset **3 days before + on the due date**; editable offsets.
6. Category: defaults to Bills & Utilities; editable.
7. Auto-match (optional but encouraged): the app proposes merchant keywords from ledger history that look like this biller; user can accept, edit, or skip.
8. Save → next due date and reminder schedule are shown for confirmation ("Next due: February 20. We'll remind you February 17 and February 20.").

### Flow: auto-match confirmation

1. A ledger commit occurs (see [../03-ingest-pipeline.md](../03-ingest-pipeline.md)); the bills recompute step finds a candidate transaction matching a bill's `autoMatchRule` (keywords + amount tolerance + date window).
2. **First and second match for that bill:** a one-tap confirmation appears (in-app card on Home and on the bill row): "Did ₱2,412.36 to MERALCO pay your Meralco bill?" → **Yes** (marks cycle paid, links the transaction, strengthens the rule) / **No** (rejects; the offending keyword is excluded from the rule).
3. **Third consecutive confirmed match onward:** the cycle is auto-marked paid silently, with an undo notice in the bill's detail and pending reminders for that cycle canceled.
4. If the matched amount is Estimated-type, the estimate updates (see Rules §Amounts).

### Flow: mark paid manually

From bill detail or the due reminder: "Mark paid" → choose one:
- **Pick from ledger** — recent outgoing transactions filtered near the bill amount; selecting one links it to the cycle.
- **Record a cash payment** — creates a manual Transaction (`source: manual`, `direction: out`) in a cash Wallet the user picks, categorized to the bill's `categoryId`, and links it.
- **Paid outside my wallets** — resolves the cycle with no ledger entry (e.g., someone else paid).

### Flow: skip a cycle

Bill detail → "Skip this cycle" → cycle resolves as skipped (no payment expected, excluded from estimate updates, removed from Safe-to-Spend). Used for promo months, advance payments, or a landlord waiving a month.

### Flow: promote a RecurringPattern to a Bill (Plus)

1. Recurring detection surfaces "₱549.00/month locked in — NETFLIX" (see [10-reports.md](10-reports.md) for where detection surfaces).
2. "Make this a bill" → the create-bill form opens prefilled: name from the pattern's `merchant`, amount type **Estimated** seeded from the pattern's `amount`, due rule inferred from its `period` and the typical posting day, `autoMatchRule` seeded from the merchant string.
3. On save: the RecurringPattern's `acknowledged` is set to `true` and the pattern is linked to the new Bill so it is never surfaced twice; the pattern's already-matched transactions seed the bill's payment history (and therefore the estimate).

### Reminder delivery

Reminders are the app's **own** notifications (they require the POST_NOTIFICATIONS runtime permission on Android 13+). Default delivery time 9:00 AM local. Example reminder text — **illustrative only, final copy at implementation**: "Meralco (~₱2,350.00) is due in 3 days, on February 20." Reminder schedules must survive device reboot (rescheduled by the same boot receiver that restores the listener — see [../03-ingest-pipeline.md](../03-ingest-pipeline.md)).

## Rules & edge cases

### Due rules

| Rule form | Meaning | Example |
|---|---|---|
| Every Nth of the month | N in 1–31; in months without day N, the date clamps to the last day of that month | "Every 31st" → February 28 (29 in a leap year) |
| Last day of the month | *Katapusan* (end-of-month) — always the final calendar day | Jan 31, Feb 28, Apr 30 |
| Twice monthly | The 15th and *katapusan* — the *kinsenas* rhythm; produces two cycles per month | Boarding-house rent collected per payday |
| Every N weeks on a weekday | Weekly or multi-week cadence | "Every 2 weeks on Friday" |
| Every N months on the Nth | Quarterly (N=3), semi-annual (N=6), annual (N=12) | Insurance premium every 3 months on the 10th |

**Weekday adjustment** (per bill, applies to month-based rules): `none` · `earlier` (a Saturday/Sunday due date moves to the preceding Friday) · `later` (moves to the following Monday). Reminders and the auto-match date window are computed from the **adjusted** date.

1. A bill's next due date is always computable and displayed; there is never a bill without a known next due date (archived bills excepted).
2. Day-of-month values 29–31 clamp to the last day of shorter months; clamping never skips a month.
3. Weekday adjustment moves the due date at most 2 days; the *unadjusted* date is still shown in the bill detail for transparency.
4. All dates use the device's local calendar day (the Philippines is a single time zone; no cross-time-zone handling in MVP).

### Amounts: fixed vs. estimated

5. A **fixed** bill has one exact amount; it changes only when the user edits it.
6. An **estimated** bill starts from the user's initial figure. After each matched payment, the estimate becomes the arithmetic mean of the **last three** matched payment amounts (fewer if history is shorter). Skipped cycles and rejected matches never feed the estimate.
7. Estimated amounts always render with a `~` prefix (e.g., `~₱2,350.00`) everywhere they appear, including inside Safe-to-Spend explanations.
8. If a matched payment deviates more than **30%** from the current estimate, the match is never silent — it always asks for confirmation (even after the auto-match ladder in rule 13 has been earned), and the confirmation notes the jump: "This is higher than your usual ~₱2,350.00."
9. Safe-to-Spend uses the fixed amount or the current estimate as of computation time.

### Reminders

10. `reminderOffsets[]` holds zero or more offsets from the (adjusted) due date; supported values: 7, 5, 3, 1 day(s) before, and on the due date. Default: **[3 days before, on due date]**.
11. A cycle that is marked paid (matched or manual) cancels that cycle's remaining reminders immediately.
12. If POST_NOTIFICATIONS is denied, no reminder is lost silently: every reminder that would have fired renders as an in-app alert card on Home, and the Bills list shows the degraded-state banner.

### Auto-match

13. The `autoMatchRule` is: merchant keyword set + amount tolerance + date window. Confirmation ladder: matches 1 and 2 for a bill require one-tap confirmation; from match 3 onward (consecutive confirmations, no rejections) matching is silent with undo. Any rejection resets the ladder to confirmation mode.
14. Amount tolerance: **fixed** bills match within ±₱30.00 or ±3% of the amount, whichever is greater (absorbs biller convenience fees, e.g., an e-wallet's ₱7.00 bills-payment fee); **estimated** bills match within ±30% of the current estimate.
15. Date window: opens 7 days before the (adjusted) due date and closes 15 days after it, but never wider than half the bill's period (so weekly bills use a proportionally tighter window).
16. Only transactions with `direction: out` are candidates. Transfer-linked transactions are never candidates — an internal movement cannot pay a bill (consistent with the Transfer Link invariant in [../02-domain-model.md](../02-domain-model.md)).
17. A Transaction can settle **at most one** bill cycle, and a cycle can be settled by **at most one** transaction (partial/split payments are manual-mark territory in MVP — see Open questions).
18. If two bills' rules both match the same transaction, neither auto-matches; the app asks the user which bill it pays, and the answer tightens both rules.
19. When a matching transaction is Uncategorized at match time, it inherits the bill's `categoryId`; an existing user-assigned category is never overwritten.
20. Confirming or rejecting a match edits only the bill's own `autoMatchRule`; it does not create a general UserRule (those belong to Review Queue corrections — see [08-review-queue.md](08-review-queue.md)).

### Overdue and missed cycles

21. A cycle becomes **Overdue** at the start of the day after its (adjusted) due date if it is neither paid nor skipped.
22. Overdue escalation: one notification on day +1, then one every 3 days, maximum **3** overdue notifications per cycle; after that, in-app surfaces only (Home alert card + red section in Bills). Nagging forever erodes trust.
23. An overdue cycle stays open until the user pays (match or manual), skips it, or edits the bill. It is never auto-resolved and never deleted.
24. Overdue amounts continue to be subtracted from Safe-to-Spend until resolved — money owed is money not spendable.
25. If the next due date arrives while a previous cycle is still overdue, both cycles are listed and both subtract from Safe-to-Spend; cycles are tracked and resolved independently.
26. Auto-match against an overdue cycle stays active for 30 days past the due date (superseding rule 15's close), because late payment of an overdue bill is the expected resolution path.

### Lifecycle and relationships

27. Archiving a bill stops future cycles, reminders, and matching; history and linked transactions are untouched. Deleting a bill removes the bill and its cycle records but **never** deletes or alters any ledger Transaction.
28. Promotion from a RecurringPattern (Plus) sets the pattern's `acknowledged: true` and links pattern → bill; an acknowledged, linked pattern is excluded from "locked in" totals to avoid double counting one obligation in two surfaces.
29. If a user manually creates a bill whose `autoMatchRule` overlaps an existing unacknowledged RecurringPattern's `merchant`, the pattern is acknowledged and linked automatically (same dedup outcome as promotion).
30. Loan payments are not Bills: obligations with a counterparty, principal, and amortization belong in [06-loans.md](06-loans.md). The create-bill flow surfaces a hint when a name looks like a loan ("Tracking utang? Loans handle balances and schedules"). *Utang* = personal debt.

## Data touched

| Entity | Access | How |
|---|---|---|
| **Bill** | Read/write | All fields: `name`, `amount: fixed \| estimated`, `dueRule`, `reminderOffsets[]`, `autoMatchRule`, `categoryId`; plus per-cycle state (due date, paid/skipped/overdue, linked paying Transaction). |
| **Transaction** | Read; limited write | Read for candidate matching and history; write only to set `categoryId` on an Uncategorized match (rule 19) and to create a manual cash Transaction from "mark paid." |
| **RecurringPattern** | Read/write | Read for promotion prefill; write `acknowledged: true` and the pattern→bill link on promotion (rules 28–29). |
| **Category** | Read | Bill category assignment and defaults. |
| **Wallet** | Read | Cash-wallet selection in manual mark-paid. |
| **Entitlements** | Read | Gates the RecurringPattern promotion entry point (detection is Plus). |

Downstream consumers: Safe-to-Spend subtracts bills due within the tightest Limit's period ([09-safe-to-spend.md](09-safe-to-spend.md)); the ledger-commit recompute step re-evaluates bill matching after every ingest ([../03-ingest-pipeline.md](../03-ingest-pipeline.md)).

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

Bills have no dedicated cap row: **bill creation, reminders, and auto-match are unlimited in both tiers** — bills are core control, and a capped bill list would make Free-tier Safe-to-Spend dishonest. The Plus touchpoints are indirect:

- **Recurring/subscription detection (Plus)** is the only source of the promote-to-Bill flow. For Free users the promotion entry point is not shown; a locked hint in the Bills empty state ("Plus can spot recurring payments for you") is the upsell moment. Free users create every bill manually and lose nothing else.
- **Safe-to-Spend projection (Plus)** shows upcoming bill dips across the period; Free shows today's number with bills already subtracted.

Gate behavior follows the standard rule: keep data, block creation of new, never delete. If a Plus subscription lapses, bills created via promotion remain fully functional; only new promotions stop.

## Acceptance criteria

- [ ] A bill can be created with each due-rule form in the table (every Nth, last day, twice monthly, every N weeks, every N months) and the displayed next due date is correct for each, including short-month clamping.
- [ ] Weekend adjustment (`earlier`/`later`) moves a Saturday/Sunday due date correctly, and reminders fire relative to the adjusted date.
- [ ] Default reminders (3 days before + due date) are created without user configuration and fire at 9:00 AM local.
- [ ] Reminders survive a device reboot.
- [ ] With POST_NOTIFICATIONS denied, every reminder appears as an in-app alert card and the degraded-state banner is shown.
- [ ] A matching ledger transaction triggers a one-tap confirmation on the first two matches and silent auto-mark (with undo) from the third consecutive confirmation.
- [ ] Rejecting a match excludes the keyword, resets the ladder, and the cycle stays unpaid.
- [ ] An estimated bill's amount equals the mean of its last three matched payments after each match, and renders with the `~` prefix.
- [ ] A matched payment deviating >30% from the estimate always asks for confirmation.
- [ ] An unpaid cycle turns Overdue the day after its due date, appears on Home, follows the 1/+3/+3-day escalation with a maximum of 3 notifications, and keeps subtracting from Safe-to-Spend until resolved.
- [ ] "Skip this cycle" resolves a cycle without payment and excludes it from estimate updates.
- [ ] Promoting a RecurringPattern creates a prefilled bill, sets `acknowledged: true`, and removes the pattern from "locked in" totals.
- [ ] Deleting a bill leaves every ledger Transaction untouched.
- [ ] A transfer-linked transaction never matches any bill.
- [ ] All bill features are callable behind the Entitlements layer with the promotion entry point gated on `tier`.

## Open questions

1. **Holiday adjustment.** Weekend adjustment is specified; PH regular and special non-working holidays are not (no holiday calendar in MVP). Should v1.x bundle a static PH holiday list so "earlier" adjustment also skips holidays, and who maintains it year to year?
2. **Partial payments.** MVP maps one transaction to one cycle (rule 17). Split payments (half GCash, half cash) require the manual "Paid outside my wallets" workaround for the remainder. Is first-class multi-transaction settlement worth the added cycle-state complexity in v1.x?
3. **Estimate statistic.** The mean of the last three payments is simple and explainable, but a single spike month (aircon season Meralco) distorts it for two further cycles. Median-of-five is more robust but needs longer history. Decide after real payment variance data exists from beta users.
