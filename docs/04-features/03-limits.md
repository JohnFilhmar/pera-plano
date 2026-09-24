# Limits

Limits are PeraPlano's spending caps: the user sets the rules once, and the app enforces awareness automatically as transactions flow in from the ingest pipeline. This document specifies limit scopes, the fixed versus percent-of-income basis, category and wallet filters, rollover semantics, the 50% / 80% / 100% alert ladder, breach behavior, and how multiple limits interact — including the "tightest wins" rule that feeds Safe-to-Spend.

**Status:** Draft v1 · 2026-08-02

## Purpose

A Limit is a spending cap over a repeating period (daily, weekly, monthly, or annual), expressed either as a fixed peso amount or as a percentage of income. Because PeraPlano's core promise is *you never log a transaction; you only set the rules*, Limits are the primary "rule" most users set: the app then measures spend against each Limit continuously at every ledger commit and alerts the user at 50%, 80%, and 100% of the cap. Limits are also the backbone of Safe-to-Spend (see [09-safe-to-spend.md](09-safe-to-spend.md)): the tightest active Limit determines the single number on the Home screen.

## User stories

- As a kinsenas earner (paid on the 15th and 30th — the common Philippine twice-monthly schedule), I want a monthly spending Limit so that I stop running out of money before the next payday.
- As a user who overspends on food delivery, I want a weekly Limit filtered to the Food & Dining category so that I get warned before the weekend, not after.
- As a GCash-heavy spender, I want a daily Limit filtered to my GCash Wallet so that impulse e-wallet payments are visible the moment they add up.
- As a disciplined saver, I want unused headroom to roll over into the next period so that a frugal week earns me flexibility later instead of vanishing.
- As a user whose pay varies, I want a Limit defined as a percentage of my income so that the cap adapts when my income changes instead of going stale.
- As a busy user, I want one clear alert when I cross 50%, 80%, and 100% of a Limit — not a nag per transaction — so that alerts stay meaningful.
- As a user who went over, I want to see exactly which transactions pushed me over and by how much so that I can adjust behavior or the Limit itself.

## UX states & flows

### States

| State | When | What the user sees |
|---|---|---|
| Empty | No Limits exist | Plan tab shows a "Set your first limit" card with a one-line explainer and a create button |
| On track | Spend < 50% of the effective limit | Progress bar in the calm/default color, remaining amount and days left in the period |
| Caution | Spend ≥ 50% and < 80% | Progress bar shifts to caution color; "₱X left, Y days to go" |
| Warning | Spend ≥ 80% and < 100% | Warning color; remaining amount emphasized |
| Over (breach) | Spend ≥ 100% | Over color; "Over by ₱X" replaces the remaining amount; Home banner active |
| Paused — income unknown | `basis: percent-of-income` but no usable IncomeProfile | Grayed card, "Paused — declare your income to activate," tap opens income declaration |
| Data caveat | Listener health indicates an ingest interruption during the period | Small badge on the limit card: "Tracking was interrupted — totals may be incomplete" (see [11-settings-privacy.md](11-settings-privacy.md)) |
| Inactive (gated) | Free tier and this is not the one active Limit | Card kept, shown dimmed with an "inactive" tag and an activate/swap action |

### Flow: create a Limit

1. Plan tab → Limits → Add.
2. Choose `scope`: daily, weekly, monthly, or annual.
3. Choose `basis`: fixed (enter a peso amount, e.g., ₱8,000.00) or percent-of-income (enter a percentage, e.g., 20%).
   - If percent-of-income is chosen and no usable IncomeProfile exists, an inline prompt appears: declare income now (opens the income flow, see [04-income.md](04-income.md)) or switch to fixed. The Limit cannot be saved as active without one of the two.
4. Optionally add a `categoryFilter` (pick one or more categories from the tree; picking a parent includes all its descendants) and/or a `walletFilter` (pick one or more Wallets).
5. Toggle `rollover` on or off (default off). A one-line explanation of the rollover rule is shown next to the toggle.
6. Review summary ("₱8,000.00 monthly, Food & Dining, rollover on") → Save.
7. The Limit starts measuring immediately, using spend already recorded in the current period.
8. **Entering one Limit creates three derived siblings**, one at each of the other three cadences, scaled from what was entered (`mobile/lib/limits/limit_derivation.ts`). Owner's decision, 2026-08-20: a user who says "₱8,000 a month" also wants the daily and weekly views of that figure without entering them, so the app derives them and marks each with `derivedFrom` pointing at the source Limit.
9. **Derived Limits are free.** The Free active-Limit cap counts source Limits only, meaning rows where `derivedFrom` is null (`canCreateLimit`, called from `components/plan/limits_panel.tsx`). Counting the derived rows would take a Free user from "one Limit" to gated the instant onboarding finished, over three rows they never asked for.

### Flow: threshold alert → detail

1. A transaction commits to the ledger; the pipeline recomputes all active Limits (see [../03-ingest-pipeline.md](../03-ingest-pipeline.md)).
2. Spend crosses a threshold → the app posts one of its own notifications. Illustrative only: *"Heads up — you've used 80% of your ₱8,000.00 monthly limit. ₱1,600.00 left for 9 days."*
3. Tapping the notification opens the Limit detail screen: progress bar, effective limit (base + rollover carryover, itemized), spend so far, remaining or overage, days left, and the list of transactions counted this period.
4. From detail the user can edit the Limit, mute its alerts for the rest of the period, or open any listed transaction.

### Flow: breach (100%) and after

1. The 100% alert fires once. Illustrative only: *"You've hit your ₱8,000.00 monthly limit. Anything more goes over."*
2. Home shows Safe-to-Spend floored at ₱0.00 with the over-state message stating the overage amount (canonical rule in [09-safe-to-spend.md](09-safe-to-spend.md)).
3. Further spending in the breached period does not trigger additional notifications for that Limit — the over-state on Home and in Plan persists and updates silently.
4. The breach banner offers: view transactions, adjust this Limit, or mute alerts for this period. PeraPlano never blocks spending; it is an observer, not a gatekeeper.
5. At the next period boundary the Limit resets to its base value (a breached period contributes zero rollover carryover).

### Flow: edit or delete

1. Editing `value`, filters, or `rollover` takes effect immediately; thresholds are re-evaluated against the new effective limit (see rules 20–22).
2. Changing `scope` restarts the Limit at the next boundary of the new scope with carryover reset to zero.
3. Deleting a Limit never touches Transactions — only the cap and its alert state are removed.

## Rules & edge cases

### Periods and counting

1. Period boundaries use the device's local time. Daily = midnight to midnight; weekly = Monday 00:00 through Sunday 23:59; monthly = the 1st through the last day of the calendar month; annual = January 1 through December 31.
2. A Transaction counts toward a Limit if and only if: `direction` is `out`, its `timestamp` falls inside the Limit's current period, it is not transfer-linked (domain invariant 2 — see [../02-domain-model.md](../02-domain-model.md)), and it matches every filter set on the Limit.
3. `categoryFilter` matches when the Transaction's `categoryId` is one of the selected categories or any descendant of one. `walletFilter` matches when the Transaction's `walletId` is in the selected set. A Limit with both filters requires both to match. A Limit with no filters counts all non-transfer outflows.
4. All `source` values count equally: notification, manual, recurring-rule, and import. Cash spending entered manually is not exempt.
5. Items still in the Review Queue are uncommitted and do not count toward any Limit (accepted simplification, consistent with Safe-to-Spend).
6. Inbound credits never reduce spend: a refund does not restore headroom in MVP (see Open questions).
7. Editing, deleting, recategorizing, or transfer-linking a Transaction triggers a recompute of every Limit whose period contains it. Recomputes only affect the current period's alert state; historical periods never re-notify (rule 19).
8. Limit totals are always computed from the full ledger, regardless of the free tier's 90-day history view gate — data is never deleted, only the browsing view is gated (see Free vs Plus).

### Basis: fixed vs percent-of-income

9. `basis: fixed` — `value` is a peso amount; the base limit for every period equals `value`.
10. `basis: percent-of-income` — `value` is a percentage. The peso base is derived from the IncomeProfile's monthly-equivalent income **M** (defined in [04-income.md](04-income.md)): monthly base = M × value%; annual base = 12M × value%; weekly base = (12M ÷ 52) × value%; daily base = (12M ÷ 365) × value%. Results round down to the nearest whole peso (conservative).
11. The peso base of a percent-of-income Limit is snapshotted at each period start and stays fixed for that period, with one exception: a manual edit to the IncomeProfile or to the Limit recomputes the base immediately. Automatic `averageAmount` drift from detection applies only from the next period start, so alerts never flap mid-period.
12. A percent-of-income Limit requires a usable IncomeProfile: either `isManualOverride` is true, or detection has reached confirmed status with a non-zero `averageAmount`. Without one, the Limit cannot be activated at creation, and an already-active Limit whose IncomeProfile becomes unusable (e.g., the user clears their income) enters the **Paused — income unknown** state: it stops counting, stops alerting, and is excluded from the Safe-to-Spend tightest-wins comparison. Income is never silently treated as ₱0.00.
13. When income becomes usable again, a paused Limit reactivates automatically — unless reactivation would exceed the free tier's active-limit cap, in which case it stays paused and the user is prompted to choose which Limit is active.

### Rollover

14. Rollover carries unused headroom forward exactly one period. For period N: `carryover(N) = clamp(base(N−1) − spend(N−1), 0, base(N))`. In words: the unused portion of the **base** value of the immediately preceding period, floored at zero and capped at one full base value of the current period.
15. `effectiveLimit(N) = base(N) + carryover(N)`. All thresholds (50/80/100%) and the over-state are computed against the effective limit.
16. Carryover never compounds: it is computed from the previous period's *base*, not its effective limit, and expires at the end of the period it was carried into. Two frugal periods in a row cannot stack more than one period's worth of extra headroom.
17. Overspend never carries forward: a breached period simply contributes zero carryover. There is no negative rollover in MVP (see Open questions).
18. Rollover applies starting with the first period boundary after the toggle is switched on; the period in which it was enabled contributes its headroom forward but does not retroactively receive any. Turning rollover off immediately removes the current period's carryover from the effective limit. For percent-of-income Limits, carryover math uses the snapshotted peso bases of each period.

### Alerts (50 / 80 / 100%)

19. Thresholds are evaluated at every ledger commit and every recompute (rule 7). A threshold fires when spend crosses from below to at-or-above threshold × effectiveLimit. Each threshold fires at most once per period. Alerts only ever fire for the current period — recomputes that change a past period's totals never notify.
20. A fired threshold never re-arms within its period: if spend falls back below it — via transaction deletion or edit, transfer-linking, or an increase in the effective limit — the visual state updates, but a later crossing in the same period does not re-notify (consistent with domain invariant I11 and the anti-spam rules in [../06-information-architecture.md](../06-information-architecture.md) §6.2). All thresholds reset at the period boundary.
21. If a single commit crosses multiple thresholds of one Limit (e.g., a ₱5,000.00 spend jumping from 40% to 105%), only the highest crossed threshold notifies.
22. If a single commit trips thresholds on multiple Limits, the alerts coalesce into one notification summarizing each affected Limit, ordered most-severe first.
23. After 100% fires, no further notifications are sent for that Limit in that period (rule: one breach alert, then silence — the over-state UI carries the message).
24. The app's own alerts require the POST_NOTIFICATIONS runtime permission (Android 13+). If denied, threshold events still appear in the Home alerts area and on the limit card; nothing is lost except the system notification.
25. Per-limit "mute for this period" suppresses that Limit's notifications until the next period boundary; the visual states remain live.
26. All notification texts in this document are illustrative, not final copy.

### Multiple limits and Safe-to-Spend

27. Any number of Limits may coexist and overlap (subject to tier gating); a Transaction counts toward every active Limit it matches under rule 2. Each Limit alerts independently (with coalescing per rule 22).
28. For Safe-to-Spend, each qualifying Limit (active and non-paused; see rules 29–30) is evaluated by the full canonical Safe-to-Spend formula in [09-safe-to-spend.md](09-safe-to-spend.md) — headroom minus bills due before that Limit's period end minus planned goal contributions, spread over its days remaining. The **tightest** Limit — the one yielding the lowest Safe-to-Spend value — wins and drives the home number; ties break toward the shorter scope.
29. Unfiltered Limits qualify for the tightest-wins comparison by default, because they bound all spending. If the user has only filtered Limits, the tightest filtered Limit is used and Home labels the number with its basis (e.g., "based on your Food & Dining limit") so a partial cap is never mistaken for a global one.
30. Paused, inactive (gated), and muted Limits are excluded from the comparison; muting affects notifications only, so a muted active Limit still participates.

## Data touched

| Entity | Access | How |
|---|---|---|
| Limit | Read/write | Full lifecycle: create, edit, activate/deactivate, delete; per-period alert state (which thresholds have fired) is kept with the Limit |
| Transaction | Read | Spend totals per period, filtered per rules 2–4; drill-down list on the detail screen |
| IncomeProfile | Read | Peso base derivation for `basis: percent-of-income` (rules 10–13) |
| Category | Read | `categoryFilter` selection and descendant matching |
| Wallet | Read | `walletFilter` selection |
| TransferLink | Read | Exclusion of transfer-linked Transactions from totals |
| Entitlements | Read | Active-limit cap and per-category gating at create/activate call-sites |

## Free vs Plus

Relevant rows of the tier matrix:

| Capability | Free | Plus |
|---|---|---|
| Limits | 1 active | Unlimited + per-category |
| History | 90 days | Unlimited |
| Safe-to-Spend | Today only | Projected to end of period |

Behavior at the gate (keep data, block creation of new, never delete):

- Free users have exactly one active Limit, and it must be an overall Limit — `categoryFilter` and `walletFilter` are Plus capabilities ("per-category" in the matrix covers filtered Limits generally).
- Attempting to create a second Limit (or add a filter) on the free tier shows the upgrade prompt; nothing is created, nothing is lost.
- On downgrade from Plus, all Limits are kept: the most recently edited active unfiltered Limit remains active by default (filtered Limits cannot be active on free), the rest become inactive (dimmed, fully viewable). The user can swap which single Limit is active at any time; filtered Limits can be viewed but not activated on free. If every Limit is filtered, all become inactive and the user is prompted to create or unfilter one.
- The 90-day history gate is a *viewing* gate only; limit totals (including annual Limits) always compute from the full ledger (rule 8).
- Safe-to-Spend gating (today-only vs projection) is specified in [09-safe-to-spend.md](09-safe-to-spend.md); the tightest-wins input from Limits is identical on both tiers.
- During MVP, Entitlements is hardcoded to `plus`, so no gate is enforced — but every gate call-site above must exist behind the flag.

## Acceptance criteria

- [ ] All four `scope` values work with the exact period boundaries in rule 1, using device-local time.
- [ ] A transfer-linked Transaction never changes any Limit's spend total, even when its Wallet and category match the filters.
- [ ] A Review Queue item does not affect any Limit until committed; committing it recomputes affected Limits immediately.
- [ ] A percent-of-income Limit with M = ₱37,000.00 and `value` = 20 produces a monthly base of ₱7,400.00, a weekly base of ₱1,707.00, and a daily base of ₱243.00 (round-down verified).
- [ ] Creating a percent-of-income Limit with no usable IncomeProfile is impossible without either declaring income or switching to fixed; clearing income pauses such a Limit rather than treating income as zero.
- [ ] Rollover example verified: base ₱8,000.00 monthly, spend ₱5,000.00 in June → July effective limit ₱11,000.00; spend ₱0.00 in June → July effective limit ₱16,000.00 (cap at one base) and August receives at most ₱8,000.00 carryover regardless of July's savings (no compounding).
- [ ] A breached period contributes zero carryover; there is no negative carryover.
- [ ] Each of the 50/80/100% thresholds fires at most once per period; a single transaction jumping past several thresholds produces exactly one notification (the highest); one transaction tripping several Limits produces one coalesced notification.
- [ ] Raising a Limit so spend drops below a fired threshold updates the visual state, but crossing the threshold again in the same period does not re-notify; thresholds reset at the period boundary.
- [ ] After a breach, additional spending produces no further notifications for that Limit in that period, while the over-state UI keeps updating.
- [ ] Safe-to-Spend is driven by the qualifying Limit yielding the lowest value under the canonical formula in [09-safe-to-spend.md](09-safe-to-spend.md) (ties break to the shorter scope); with only filtered Limits active, Home labels the number with the winning Limit's name.
- [ ] With Entitlements set to `free`: only one active unfiltered Limit is possible; extra Limits are kept inactive and viewable; nothing is ever deleted by gating.
- [ ] Denying POST_NOTIFICATIONS degrades alerts to in-app surfaces without data loss.

## Open questions

1. **Refund netting.** Should an inbound credit that dedupe/merchant-matching identifies as a refund of a counted outflow restore headroom within the same period? MVP counts outflows only (rule 6); netting would be more accurate but risks false matches corrupting totals.
2. **Payday-aligned periods.** Kinsenas earners think in 15th-to-14th cycles, not calendar months. Should a future version offer income-anchored periods ("per payday") as a fifth scope or a period-anchor option?
3. **Week start.** Weekly periods start Monday (rule 1). Is a "week starts on" setting worth the added period-boundary complexity, or is Monday universal enough for the PH market?
4. **Opt-in negative rollover.** Some users may want overspend deducted from the next period as self-discipline. Excluded from MVP (rule 17) — worth revisiting with user feedback.
