# Safe-to-Spend

This document specifies Safe-to-Spend: the single number on the Home screen that tells the user what they can spend today without breaking their own rules. It defines the canonical formula, a worked peso example, every display state, the free-tier (today-only) versus Plus (end-of-period projection) behavior, and the edge cases that determine what the number does when the inputs are incomplete or change mid-period.

**Status:** Draft v1 · 2026-08-02

## Purpose

Safe-to-Spend collapses everything the app knows — the tightest active Limit, upcoming Bills, and planned Goal contributions — into one glanceable daily figure: spendable today after commitments. It is the payoff of the core promise (*you never log a transaction; you only set the rules*): because the ledger fills itself via ingest, the number is always current without user effort. It is the Home screen's centerpiece, marked with the Lucide `Navigation` icon, and the most frequent reason a user opens the app.

## User stories

- As a kinsenas earner, I want one number that tells me what I can spend today, so that I don't have to do mental math between paydays (kinsenas/katapusan: the common PH pay dates of the 15th and 30th).
- As a user with bills due before payday, I want those bills already subtracted from my spendable number, so that "money in my Wallet" never fools me into spending the Meralco payment.
- As a user saving for a goal, I want my planned contribution protected inside the number, so that saving happens by default instead of from leftovers.
- As a user who overspent, I want the app to tell me plainly that I'm over and by how much, so that I can adjust for the rest of the period instead of discovering it at katapusan.
- As a Plus subscriber, I want to see how my daily room evolves through the end of the period, so that I can plan around the days when bills land.
- As a new user who hasn't set a Limit yet, I want the Home screen to tell me what to do next, so that I'm not staring at a blank number.

## UX states & flows

### Display states

| State | Trigger (testable) | Home screen display |
|---|---|---|
| Healthy | Computed value > ₱0 and the driving Limit's consumption is below its 80% alert threshold | Large ₱ figure, `Navigation` icon, neutral/positive styling, caption naming the driving Limit and its period (e.g., "from your Monthly Limit · 20 days left") |
| Tight | Computed value > ₱0 and the driving Limit's consumption is at or past 80% (aligned with the Limit's 80% alert) | Same figure with warning styling and caption "Getting tight — ₱X headroom left this period" |
| Over | Pre-spread numerator ≤ ₱0 **and** the driving Limit's own headroom ≤ ₱0, or the driving Limit is unfiltered (see Rule 9) | **₱0.00** with an explicit over state: "You're over by ₱X this period" — never a negative number |
| Committed | Pre-spread numerator ≤ ₱0 while the driving Limit is **filtered** and its own headroom is still > ₱0 — the shortfall is Bills and Goal contributions, not spending (see Rule 9a) | **₱0.00** with warning (not danger) styling, no "over by" figure, and the set-aside caption naming what took it: "₱2,500.00 to goals is already set aside" |
| No-limit-set | No active Limit covers today's date | No number. Card shows "Set a Limit to unlock Safe-to-Spend" call-to-action leading to Limit creation ([03-limits.md](03-limits.md)), plus a fallback summary of this month's money in vs. out |

Secondary indicators that can accompany any state:

- **Listener unhealthy banner** — if tracking was interrupted, the number may be stale; the "tracking was interrupted" banner from [11-settings-privacy.md](11-settings-privacy.md) appears above the number.
- **Review Queue notice** — if items are waiting in the Review Queue, a caption notes "N transactions awaiting review — not yet counted" (see Rule 12).

### Key flows

**Flow A — Daily glance (Free)**
1. User opens the app; Home shows Safe-to-Spend for today, computed on the spot from the committed ledger.
2. Caption shows the driving Limit, days remaining in its period, and the amounts deducted for Bills and Goal contributions ("₱3,999 in bills and ₱1,000 to goals are already set aside").
3. Tapping the number opens a breakdown sheet: headroom of the driving Limit, minus itemized upcoming Bills, minus planned Goal contributions, divided by days remaining — every term tappable through to its source feature.

**Flow B — Period projection (Plus)**
1. Below today's number, a day-by-day curve runs from today to the end of the driving Limit's period.
2. Each point is the Safe-to-Spend figure the user would see on that date **assuming no further discretionary spending**, with Bills and scheduled Goal contributions executing on their due dates.
3. Bill due dates and payday auto-allocation dates are marked on the curve; tapping a marker opens that Bill or Goal.
4. Because the assumption is zero further spending, the curve rises as days remaining shrink — the app frames it as "hold steady and you'll have ₱X/day by the 31st."
5. Free users see a locked preview of the projection area — a labeled empty/sample frame, never their real curve, blurred or otherwise ([../05-monetization.md](../05-monetization.md) §5, rule 2) — with a Plus prompt; today's number is never blocked.

**Flow C — Over state recovery**
1. Number shows ₱0.00 and "over by ₱X this period."
2. Tapping opens the same breakdown sheet plus recovery suggestions: review recent transactions, check the Review Queue for miscategorized or unlinked-transfer items, or edit the Limit.
3. If an unlinked internal transfer caused the overage, correcting it in the Review Queue ([08-review-queue.md](08-review-queue.md)) recomputes the number immediately.

**Flow D — First-time setup**
1. No-limit-set state shows the call-to-action.
2. User creates their first Limit (onboarding already offers this — [01-onboarding.md](01-onboarding.md)); on save, Safe-to-Spend appears immediately with a one-time explainer of what the number means.

## Rules & edge cases

### Canonical formula

> `Safe-to-Spend (today) = remaining headroom of the tightest active Limit for today's date − bills due before that limit's period ends − planned goal contributions in that period, spread over days remaining in the period.`

### Worked example

Assume today is **August 12**:

| Input | Value |
|---|---|
| Driving Limit | Monthly, fixed ₱15,000.00, no filters, period Aug 1–31 |
| Committed spend Aug 1–11 (direction `out`, transfer-linked excluded) | ₱6,200.00 |
| Remaining headroom | ₱15,000.00 − ₱6,200.00 = **₱8,800.00** |
| Bills due Aug 12–31 (unpaid) | Meralco ₱2,300.00 (due the 20th) + PLDT ₱1,699.00 (due the 25th) = **₱3,999.00** |
| Planned Goal contributions in period | ₱1,000.00 payday auto-allocation on the 15th (a Plus `contributionRule`; ₱0 when none exists) |
| Days remaining, including today | Aug 12–31 = **20** |

`Safe-to-Spend (today) = (₱8,800.00 − ₱3,999.00 − ₱1,000.00) ÷ 20 = ₱3,801.00 ÷ 20 =` **₱190.05**

Over-state variant: if spend to date were ₱13,500.00, headroom would be ₱1,500.00 and the numerator ₱1,500.00 − ₱3,999.00 − ₱1,000.00 = **−₱3,499.00** → display **₱0.00, "over by ₱3,499.00 this period."**

### Rules

1. **Candidate Limits.** A Limit is a candidate when it is active and its scope window (daily = today; weekly = current week; monthly = current calendar month; annual = current calendar year, all in device-local time) contains today's date.
2. **Tightest wins.** Among candidates, the driving Limit is the one that yields the lowest Safe-to-Spend value. Ties break toward the shorter scope.
3. **Filtered Limits do not drive the home number when an unfiltered Limit exists.** Limits with a `categoryFilter` or `walletFilter` cap only a slice of spending; the Home number describes overall spendable money. If *only* filtered Limits exist, the tightest of them drives the number and the caption names the filter (e.g., "from your Food & Dining Limit").
4. **Headroom** = the Limit's effective value (its `value`, plus rollover carry-in when `rollover` is true; for `basis: percent-of-income`, the value computed from the IncomeProfile) minus committed spend within the scope window that matches the Limit's filters, direction `out`, excluding transfer-linked transactions.
5. **Bills term.** Sum of (a) unresolved overdue Bill cycles — due date passed, neither paid nor skipped — which keep subtracting until resolved ([07-bills.md](07-bills.md), rules 24–25), and (b) unpaid Bills whose due date falls on or after today and on or before the driving Limit's period end. `estimated` Bills use their current estimate. Bills already paid this period are excluded — their payment is already in committed spend (no double-count); skipped cycles are excluded.
5a. **Commitments are scoped to what the driving Limit measures.** A Bill is deducted from a Limit's headroom only when it could actually consume it: for a Limit with a `categoryFilter`, only when the Bill's `categoryId` falls inside that filter (expanded to descendants, the same set the spend side uses). An unfiltered Limit measures all spending, so every Bill in window counts against it and rules 4-5 apply unchanged. Without this, a ₱3,400 electricity bill reduces a Food & Dining cap it will never be paid from, and the Home number drops for a reason the user cannot act on.
6. **Goal contributions term.** Sum of scheduled `contributionRule` amounts (Plus) whose allocation date falls within the remaining period (a forecast, counted from the start of the period), plus planned contributions already triggered but still pending — not yet matched, recorded, skipped, or expired ([05-goals-savings.md](05-goals-savings.md), rules 14–15); skipped and expired contributions leave the term. Manual, unscheduled Goal contributions are not forecast; they simply appear as spend/transfers when they happen.
6a. **Goal contributions never reduce a *filtered* Limit.** A contribution is committed as a linked transfer between the user's own wallets, and invariant 2 keeps transfer legs out of every Limit's spend — so it carries no category and can never consume a category slice's headroom. Deducting it there charges a budget the money will never touch: the reported case was ₱2,500 taken out of a ₱1,965.38 weekly category cap, which showed **₱0.00 safe to spend** while every Limit sat at 0% consumed. Unfiltered Limits keep reserving contributions (rule 6 as written) — that Limit is the closest thing to the user's whole budget, and it is what the canonical formula and worked example above are written against. Consequence: on an all-filtered setup, the contributions term is always ₱0 and savings protection must be surfaced some other way rather than silently reducing the spending number.
7. **Days remaining includes today.** A daily-scope Limit always has days remaining = 1, so its Safe-to-Spend equals its remaining headroom minus same-day Bills and contributions.
8. **Transfer exclusion.** Transfer-linked transactions never count in the spend used for headroom (invariant 2 in [../02-domain-model.md](../02-domain-model.md)).
9. **Floor at zero.** If the numerator (headroom − bills − contributions) is ≤ ₱0, the display is ₱0.00, and "over by" equals the absolute value of the numerator — the whole-period shortfall, not a per-day figure. The Over state and its "over by" figure apply whenever the driving Limit is unfiltered, or its own headroom is ≤ ₱0; the canonical worked example above is unfiltered and is unaffected by rule 9a.
9a. **Commitments do not put a filtered Limit "over".** When the driving Limit is filtered and its own headroom is still > ₱0, a numerator ≤ ₱0 means Bills and Goal contributions took the allowance, not spending inside that Limit's slice — so the Committed state shows instead, with no "over by" figure. A filtered Limit caps one slice of spending (rule 3), and a Goal contribution is a transfer that invariant 2 keeps out of *every* Limit's spend; telling a user they are "over your Food & Dining Limit" when they have spent nothing on food is false. The money stays reserved either way — this changes the wording and the styling, never the number. Zero headroom is excluded deliberately: an allowance spent exactly to its cap is exhausted, not set aside.
10. **Percent-of-income Limits need an IncomeProfile.** If a `percent-of-income` Limit has no usable IncomeProfile ([04-income.md](04-income.md)), that Limit is excluded from candidates and a prompt appears on the Limit itself ("Declare your income to activate this Limit"). If it was the only Limit, the No-limit-set state shows with that prompt.
11. **Mid-period Limit change.** Editing a Limit's value, basis, filters, or rollover recomputes Safe-to-Spend immediately against the full period's spend to date. Threshold alerts re-evaluate against the new value, but alerts already fired this period do not re-fire (rule owned by [03-limits.md](03-limits.md)). Deleting or deactivating the driving Limit promotes the next-tightest candidate; if none remains, the No-limit-set state shows.
12. **Review Queue items are not counted.** Uncommitted Review Queue items are excluded until confirmed — an accepted simplification. The UI discloses it via the "not yet counted" caption whenever the queue is non-empty.
13. **Recompute triggers.** The number recomputes on: every ledger commit, Review Queue confirmation, Transfer Link create/unlink, Bill create/edit/pay, Goal or `contributionRule` change, Limit change, IncomeProfile change, and local-midnight day rollover.
14. **Period boundary.** At the start of a new period the number resets to the fresh headroom (respecting rollover carry-in). The Over state never leaks across periods on the display.
15. **Last day of period.** Days remaining = 1; the number equals remaining headroom minus same-day Bills and contributions — no averaging.
16. **Formatting.** Currency renders as `₱1,234.56`. Dates in captions are absolute ("until the 31st").
17. **Projection curve (Plus).** For each remaining day *d*, the plotted value is the Safe-to-Spend the user would see on *d* under the zero-further-discretionary-spend assumption, with Bills and scheduled contributions deducted on their scheduled dates. The curve recomputes on the same triggers as Rule 13.

## Data touched

| Entity | Read | Write |
|---|---|---|
| Limit | Scope, `basis`, `value`, `categoryFilter?`, `walletFilter?`, `rollover`, alert thresholds — to find the tightest candidate and its headroom | — |
| Transaction | `amount`, `direction`, `timestamp`, `categoryId`, `walletId`, `transferLinkId?` — committed spend in the period | — |
| TransferLink | To exclude both legs from spend | — |
| Bill | `amount`, `dueRule`, paid/unpaid status in the period | — |
| Goal | `contributionRule?` and its schedule (Plus) | — |
| IncomeProfile | `cadence`, `averageAmount` — to evaluate `percent-of-income` Limits | — |
| Entitlements | `tier` — today-only vs. projection | — |

Safe-to-Spend is a derived, read-only view: it writes nothing.

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

- **Free users always get today's number.** The projection area renders as a locked preview — a labeled empty/sample frame, never the user's real curve ([../05-monetization.md](../05-monetization.md) §5, rule 2) — with a Plus prompt; the core figure is never withheld or degraded.
- Free users have 1 active Limit, so "tightest" is trivially that Limit; the selection rules above still apply unchanged if the user later upgrades and adds more.
- The Goal-contributions term is effectively ₱0 for free users (payday auto-allocate is Plus); the breakdown sheet omits the row rather than showing ₱0.
- Standard gate principle applies everywhere: keep data, block creation of new, never delete. Downgrading from Plus never recalculates history — only the projection disappears.

## Acceptance criteria

- [ ] With the worked-example inputs above, the app displays exactly ₱190.05 on August 12.
- [ ] The displayed value never goes below ₱0.00; the Over state shows the whole-period shortfall ("over by ₱3,499.00") matching |numerator|.
- [ ] Transfer-linked transactions change no Safe-to-Spend output when linked or unlinked apart from the recompute they trigger (their amounts are excluded either way).
- [ ] A Bill paid mid-period stops appearing in the bills term and its payment appears in committed spend — the total is deducted exactly once.
- [ ] An unresolved overdue Bill cycle keeps reducing Safe-to-Spend after its due date passes; when the next cycle arrives while a prior cycle is still overdue, both subtract until each is resolved.
- [ ] With multiple active Limits (Plus), the driving Limit is the one yielding the lowest value; ties resolve to the shorter scope.
- [ ] A `percent-of-income` Limit with no IncomeProfile is excluded from candidates and surfaces the "declare your income" prompt.
- [ ] Editing the driving Limit's value mid-period changes the number immediately, computed against full period-to-date spend.
- [ ] With no active Limit covering today, the No-limit-set state shows the create-Limit call-to-action and the in/out fallback summary — never a bare ₱0.
- [ ] The number recomputes on every trigger in Rule 13, including local-midnight rollover with the app in the background (verified on next open).
- [ ] Free tier: today's number renders; the projection area is a locked preview. Plus: the day-by-day curve renders to period end with Bill and Goal markers on their dates.
- [ ] Review Queue items do not move the number, and a non-empty queue shows the "not yet counted" caption.
- [ ] Breakdown sheet terms sum exactly to the displayed value under the stated formula, and every term links to its source feature.
- [ ] All currency renders in `₱1,234.56` format.

## Open questions

1. Should a nearly-exhausted *filtered* Limit (e.g., Food & Dining at 95%) ever override a loose unfiltered Limit as the driving number, or is a secondary "category alert" chip on Home enough? Current rule (Rule 3) says the unfiltered Limit always drives; this may hide a real squeeze.
2. When `rollover` is true and a period ends in the Over state, should the overage carry *negative* rollover into the next period? The Limit model supports positive rollover only today; decision belongs jointly with [03-limits.md](03-limits.md).
3. Should the Plus projection curve mark expected payday dates (from the IncomeProfile) purely as visual context, even though income events do not change Limit headroom? Risk: users may misread paydays as increasing the number.
