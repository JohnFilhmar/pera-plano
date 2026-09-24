# Income

PeraPlano learns when and how much the user gets paid by watching repeated inbound credits in the ledger — no payslip entry required. This document specifies the IncomeProfile: cadence detection heuristics for the Philippine pay landscape (kinsenas, weekly, monthly, and irregular gig income), how `averageAmount` is computed and updated, the manual-override rules, and how income feeds percent-of-income Limits and payday auto-allocation.

**Status:** Draft v1 · 2026-08-02

## Purpose

The IncomeProfile answers two questions the rest of the app depends on: *when does money arrive* (`cadence`) and *how much, typically* (`averageAmount`). Percent-of-income Limits need a peso base ([03-limits.md](03-limits.md)); payday auto-allocation needs a trigger ([05-goals-savings.md](05-goals-savings.md)); and onboarding needs a low-friction income step ([01-onboarding.md](01-onboarding.md)). Because the ingest pipeline already records every inbound credit, detection can do the work: the app proposes a cadence and amount from evidence in the ledger, and a manual declaration by the user always wins over anything detected.

## User stories

- As a salaried employee paid kinsenas (the common Philippine twice-monthly schedule: the 15th and 30th — *katapusan*, the end of the month), I want the app to figure out my paydays from my bank credits so that I never have to type my salary anywhere.
- As a weekly-paid worker, I want the app to recognize my Friday pay so that my percent-of-income Limit stays accurate.
- As a gig worker with irregular payouts (ride-hailing, freelancing, commissions), I want the app to track a realistic monthly-equivalent income so that percent Limits still work for me.
- As a privacy-conscious user, I want to declare my income manually and have the app respect that number, so that detection never rewrites what I said.
- As a user whose salary just changed, I want a gentle suggestion to update my income when the app notices the difference — not a silent change to my Limits.
- As a Plus user, I want my goal contributions to move automatically on payday so that saving happens before spending does.

## UX states & flows

### States

| State | When | What the user sees |
|---|---|---|
| Unknown | No declaration and not enough ledger evidence | Income screen shows "We're still learning your income"; percent-of-income Limits cannot activate ([03-limits.md](03-limits.md), rule 12) |
| Detecting (provisional) | A pattern is emerging but not confirmed | A suggestion card: detected cadence and amount, with Confirm / Adjust / Dismiss |
| Confirmed (automatic) | Detection confirmed, `isManualOverride` false | Cadence, `averageAmount`, and source Wallets shown with an "updates automatically" tag |
| Declared (manual) | `isManualOverride` true | Declared values shown with a "set by you" tag and a "switch to automatic" action |
| Lapsed | Two consecutive expected paydays passed with no matching credit | Prompt: "We haven't seen your usual pay — did it change?" plus a listener-health hint in case tracking was interrupted |

### Flow: onboarding income step

1. During onboarding (after Wallet/provider setup, per [01-onboarding.md](01-onboarding.md)), the user is asked about income with two paths:
   - **Declare it**: pick cadence (kinsenas / weekly / monthly / irregular), enter a typical amount, optionally pick which Wallets pay lands in. This sets `isManualOverride` to true.
   - **Let PeraPlano figure it out**: skips entry; detection runs as credits arrive. Percent-of-income Limits stay unavailable until detection confirms or the user declares.
2. Either path is skippable — income is never a blocking permission or requirement.

### Flow: detection confirms a pattern

1. Detection reaches provisional status (evidence thresholds in rule 6) → a non-blocking suggestion card appears on Home and on the Income screen. Illustrative only: *"Looks like you're paid around the 15th and 30th — about ₱18,500.00 each. Use this as your income?"*
2. Confirm applies it (`isManualOverride` stays false; automatic updates continue). Adjust opens the editor prefilled (saving sets `isManualOverride` true). Dismiss hides the card until the detected values change materially.
3. If the user never responds, detection that reaches **confirmed** status auto-applies with an in-app notice — but only when no manual override exists.

### Flow: manual override and back

1. The user edits income at any time from the Income screen (reachable from More, and contextually from the percent-of-income Limit editor).
2. Saving any manual value sets `isManualOverride` to true. From then on, detection keeps running silently but changes nothing.
3. If detected values later diverge materially from the declared ones (rule 14), a suggestion card offers the update; applying it updates the values but keeps `isManualOverride` true (the user made the change).
4. "Switch to automatic" clears `isManualOverride`; the current confirmed detection (if any) takes over.

### Flow: payday

1. A committed inbound credit matches the IncomeProfile (rule 11) → a payday event.
2. The app refreshes Safe-to-Spend and, for Plus users with a `contributionRule` on a Goal, runs payday auto-allocation ([05-goals-savings.md](05-goals-savings.md)).
3. Optional payday acknowledgment notification, off by default. Illustrative only: *"Payday! ₱18,540.00 landed in BPI Payroll. Your goal allocation moved ₱1,500.00 to Emergency Fund."*
4. A credit that landed while the app was closed is announced on the next launch instead, once the allocation prompt is mounted and the notification subscriber has started. Detection itself runs earlier, during startup, because a percent-of-income Limit reads the profile on the first render; the announcement waits, because a payday is announced exactly once and an announcement made before the listeners exist is spent on nobody (GAP-126, 2026-09-24).

## Rules & edge cases

### Candidate income events

1. A Transaction is a **candidate income event** if: `direction` is `in`, it is committed (not in the Review Queue), it is not transfer-linked (internal movements are never income — domain invariant 2, [../02-domain-model.md](../02-domain-model.md)), it is not referenced in any Loan's `paymentHistory[]` (a borrower's regular owed-to-me repayments are never income candidates — [06-loans.md](06-loans.md), rule 17; a loan match made after the credit was first seen retroactively removes the event from detection evidence), and `amount` ≥ ₱500.00 (noise floor — load rebates, tiny interest credits, and *padala* pocket money below this are ignored by detection; they remain ordinary ledger entries).
2. Refund exclusion: an inbound credit whose `amount` equals a prior outflow to the same `merchant` within the previous 7 days is treated as a refund, not income.
3. All `source` values qualify, including manual — so a user who enters a missed pay credit by hand (e.g., after an ingest interruption) keeps their IncomeProfile healthy.
4. Candidates are grouped by (`walletId`, normalized `merchant`/counterparty where present, amount within ±30% of the group's running median). **The banded unit is the payday, not the single credit:** credits sharing one local date are collapsed into one candidate carrying that day's total, however many deposits the pay travelled in, so an employer who splits one ₱18,500.00 packet into two ₱9,250.00 deposits is banded as one ₱18,500.00 payday. A stream key's first payday seeds its group whole, before any fallback can apply; seeding from a half would set the running median to half a payday and put every later whole payday out of band. When a day's combined total falls outside every existing band, that day alone is re-tested credit by credit against those same medians, so an off-schedule bonus landing beside a salary cannot evict the salary it arrived with (rule 8); the fallback never widens the band, and a credit matching nothing starts its own group. The largest recurring group is the **primary income stream**, counted in paydays rather than in credits so a stream paid in halves cannot outrank a more frequent one on deposit habit alone, with ties going to the group whose first payday is earliest; MVP models exactly one IncomeProfile, representing that stream (see Open questions for multi-source income).

### Cadence detection

5. Detection evaluates the trailing 120 days of candidate events on every new commit, testing patterns in this order of precedence — first confirmed pattern wins; if none is confirmed, the strongest provisional in the same order; otherwise the irregular fallback:
   1. kinsenas (PH norm — tested first)
   2. weekly
   3. monthly
   4. irregular
6. Pattern tests and evidence thresholds:

| `cadence` | Pattern test | Provisional | Confirmed |
|---|---|---|---|
| kinsenas (15th/30th) | Credits landing alternately in the two pay windows: the 15th ±3 days (12th–18th) and *katapusan* ±3 days (the 27th through the 2nd of the next month, anchored to the last calendar day for short months, incl. February) | 3 consecutive matched windows | 4 of the last 5 expected windows matched |
| weekly | Gaps of 7 ±1 days between events, same weekday ±1 | 3 events (2 qualifying gaps) | 4 events (3 qualifying gaps) |
| monthly | One event per month, gap 28–33 days, same calendar date ±3 (clamped for short months) | 2 events | 3 events |
| irregular | ≥3 candidate events from the primary stream in the trailing 90 days, fitting none of the above | n/a (fallback) | Applied directly as the fallback classification |

7. The ±3-day windows deliberately absorb the Philippine practice of moving payday earlier when the 15th or 30th falls on a weekend or holiday.
8. An extra off-schedule credit (a bonus, or the mandatory December 13th-month pay) does not break a confirmed cadence: it is recorded as income in the ledger but does not reset pattern evidence, and the median-based `averageAmount` (rule 9) absorbs it.

### averageAmount

9. `averageAmount` is the median of recent matched pay events, which rule 11 defines as paydays rather than single credits, so a payday that arrived in several deposits contributes its combined total once. Medians resist outliers like 13th-month pay:

| `cadence` | `averageAmount` = | Minimum history |
|---|---|---|
| kinsenas | Median of the last 6 matched pay events (≈ 3 months) | 2 events |
| weekly | Median of the last 8 matched pay events | 2 events |
| monthly | Median of the last 4 matched pay events | 2 events |
| irregular | Sum of the trailing 90 days of primary-stream candidates ÷ 3 (i.e., `averageAmount` **is** the monthly-equivalent for irregular income) | 3 events |

10. `averageAmount` recomputes whenever a new matched pay event commits (and on edits/deletes touching matched events). When `isManualOverride` is true, recomputation happens silently for suggestion purposes only — the stored profile values never change automatically. Automatic changes propagate to percent-of-income Limits at the next period start ([03-limits.md](03-limits.md), rule 11).

### Payday events

11. A committed candidate event is a **matched pay event** (a payday) when: its `walletId` is in `sourceWalletIds[]`, its amount is within ±30% of `averageAmount`, and, for kinsenas/weekly/monthly, its timestamp falls in the current expected window. **The amount tested is the day's combined total,** because credits sharing one local date are collapsed before the band is applied: a split packet is one payday at its full amount, not two that each fall short of the band. For `cadence: irregular` there are no windows: any primary-stream candidate ≥ ₱1,000.00 counts as a payday, and that floor alone stays per credit, since there is no average to test against and summing sub-floor credits until they clear it would manufacture paydays out of the small credits the floor exists to exclude. The payday it produces still carries the day's total.
12. Payday events trigger: Safe-to-Spend refresh, payday auto-allocation for Plus Goals with a `contributionRule` (allocation percentages apply to the *actual* credit amount of the matched pay event, not `averageAmount` — full rules in [05-goals-savings.md](05-goals-savings.md)), and the optional payday notification.
13. Missed paydays: when two consecutive expected windows pass with no matched pay event, the profile drops from confirmed to provisional (Lapsed state), a gentle prompt asks whether income changed, and the listener-health surface is suggested in case ingest was interrupted. Percent-of-income Limits keep using the last known values while lapsed — they pause only if the profile is cleared entirely ([03-limits.md](03-limits.md), rule 12).

### Manual override

14. Manual override always wins. Any user-entered cadence, amount, or source-Wallet selection sets `isManualOverride` to true; detection then never modifies the profile. Detection continues in the background and raises a suggestion card only when the detected `averageAmount` diverges from the declared amount by more than 20%, or a different cadence reaches confirmed status. Suggestions are dismissible and never auto-apply.
15. "Switch to automatic" clears `isManualOverride` and adopts the current confirmed detection; if none exists, the profile returns to Unknown/Detecting (and percent-of-income Limits pause per [03-limits.md](03-limits.md), rule 12, after a confirmation warning).

### Derived monthly-equivalent income

16. The monthly-equivalent income **M**, consumed by percent-of-income Limits ([03-limits.md](03-limits.md), rule 10):

| `cadence` | M = |
|---|---|
| kinsenas (15th/30th) | 2 × `averageAmount` |
| weekly | `averageAmount` × 52 ÷ 12 |
| monthly | `averageAmount` |
| irregular | `averageAmount` (already monthly-equivalent per rule 9) |

17. All income data is ordinary local ledger-derived data: it never syncs unless the user has enabled cloud backup (Plus), and raw notification text follows the standard 30-day purge ([../07-privacy-and-compliance.md](../07-privacy-and-compliance.md)).
18. All notification and suggestion texts in this document are illustrative, not final copy.

## Data touched

| Entity | Access | How |
|---|---|---|
| IncomeProfile | Read/write | Detection creates/updates it (when not overridden); user declaration writes `cadence`, `averageAmount`, `sourceWalletIds[]`, `isManualOverride` |
| Transaction | Read | Candidate income events, refund exclusion, matched pay events |
| TransferLink | Read | Excluding internal movements from income candidates |
| Wallet | Read | `sourceWalletIds[]` selection and matching |
| Limit | Read (trigger) | Percent-of-income Limits recompute their peso base from M per the propagation rules |
| Goal | Read (trigger) | Payday events trigger `contributionRule` auto-allocation (Plus) |
| Entitlements | Read | Payday auto-allocation gate at the trigger call-site |

## Free vs Plus

Income detection, manual declaration, and the IncomeProfile itself are free — they are core L2 control features. Gating touches only what income *feeds*. Relevant rows of the tier matrix:

| Capability | Free | Plus |
|---|---|---|
| Limits | 1 active | Unlimited + per-category |
| Goals | 1 | Unlimited + payday auto-allocate |

Behavior at the gate (keep data, block creation of new, never delete):

- Free users get full cadence detection, `averageAmount` tracking, manual override, and percent-of-income basis on their one active Limit.
- Payday auto-allocation is Plus: on the free tier, a Goal's `contributionRule` is kept but does not execute; the payday event still fires for Safe-to-Spend refresh, and the allocation moment becomes an upsell surface (detailed in [05-goals-savings.md](05-goals-savings.md) and [../05-monetization.md](../05-monetization.md)).
- On downgrade, no income data is ever deleted or degraded; only the auto-allocation stops executing.
- During MVP, Entitlements is hardcoded to `plus`, so no gate is enforced — but the auto-allocation call-site must sit behind the flag.

## Acceptance criteria

- [ ] Credits on the 15th and 30th (±3 days, month-end anchored) for two months produce a confirmed `cadence: kinsenas (15th/30th)` profile without any user input.
- [ ] A February pay cycle (no 30th) matches the *katapusan* window via the last-calendar-day anchor.
- [ ] Weekly credits with 7 ±1-day gaps confirm `weekly` after 4 events; a single skipped week does not immediately destroy confirmed status (two consecutive misses trigger Lapsed per rule 13).
- [ ] Three-plus non-patterned primary-stream credits in 90 days classify as `irregular` with `averageAmount` equal to the trailing 90-day sum ÷ 3.
- [ ] Transfer-linked credits and sub-₱500.00 credits never influence detection; a same-amount same-merchant credit within 7 days of an outflow is excluded as a refund.
- [ ] A Transaction matched to an owed-to-me Loan's `paymentHistory[]` is excluded from cadence detection, including retroactively when the loan match happens after the credit was first counted as evidence.
- [ ] A 13th-month-sized outlier shifts the median-based `averageAmount` by less than a mean-based computation would, and does not break confirmed cadence.
- [ ] With `isManualOverride` true, no automatic process ever changes stored profile values; a >20% divergence raises a dismissible suggestion only.
- [ ] "Switch to automatic" adopts confirmed detection, and warns before leaving percent-of-income Limits without a usable profile.
- [ ] A matched pay event (window + source Wallet + ±30% amount) triggers Safe-to-Spend refresh and, on Plus, executes Goal `contributionRule` against the actual credit amount.
- [ ] Two consecutive missed expected paydays flip the profile to Lapsed, prompt the user, and surface the listener-health check — while percent-of-income Limits continue on last known values.
- [ ] M conversions verified: kinsenas ₱18,500.00 → M = ₱37,000.00; weekly ₱5,000.00 → M = ₱21,666.67; irregular trailing-90-day sum ₱45,000.00 → `averageAmount` = M = ₱15,000.00.
- [ ] With Entitlements set to `free`, a Goal's `contributionRule` is preserved but does not execute, and nothing income-related is deleted.

## Open questions

1. **Multiple income streams.** MVP models one IncomeProfile (the largest recurring stream). Households and side-hustlers often have two or more (salary + gig, salary + regular *padala* from an OFW relative). Should v2 support multiple profiles summed into M, and how would payday auto-allocation split across them?
2. **Remittance as income.** Regular inbound *padala* (remittance) is income for many recipients but a gift/transfer for others. Should the user be asked once per recurring remittance stream whether to count it toward the IncomeProfile?
3. **13th-month planning.** The December 13th-month pay is predictable by law. Should the app eventually recognize it explicitly (a planned windfall feeding Goals) rather than merely absorbing it as an outlier?
4. **Payday-aligned Limit periods.** Shared with [03-limits.md](03-limits.md): kinsenas earners plan their spending 15th-to-14th, not by calendar month. An income-anchored period option would make the two features click together.
