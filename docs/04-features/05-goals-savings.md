# Goals & Savings

This document specifies how PeraPlano turns a saving intention into tracked, visible progress: savings-type Wallets, Goals linked to those Wallets, progress derived from the Wallet balance, a target-date pace indicator, and payday auto-allocation prompts (a Plus capability). It covers the create/edit/complete lifecycle, how contributions are detected from the Ingest pipeline, and how goals interact with Safe-to-Spend.

**Status:** Draft v1 · 2026-08-02

## Purpose

Filipinos already save in named places — a GSave pocket, a Maya savings vault, a SeaBank account, an envelope of cash. PeraPlano models each of those places as a savings-type Wallet and lets the user attach a Goal to it: a target amount, an optional target date, and (on Plus) a payday contribution rule. Because the app tracks money movement automatically via Ingest, progress does not require the user to log anything — moving money into the savings Wallet in their bank or e-wallet app is enough. The goal screen answers three questions at a glance: how much have I saved, am I on pace for my date, and how much should I set aside this payday. Goals use the Lucide `PlaneTakeoff` icon (the brand's secondary mark) in navigation and empty states.

## User stories

- As a kinsenas earner, I want to set a goal of ₱50,000.00 for an emergency fund linked to my GSave, so that every transfer I make into GSave automatically moves my progress bar without any logging.
- As a saver with a deadline, I want to set a target date (e.g., tuition due on June 1) and see whether I am on pace, so that I know today — not in May — if I need to save more per payday.
- As a Plus subscriber, I want the app to prompt me on payday to move ₱2,000.00 into my savings Wallet, so that saving happens before spending does.
- As someone saving for several things at once, I want separate goals (emergency fund, phone, Christmas), each with its own savings Wallet, so that progress numbers never blur together.
- As a cash saver, I want to record deposits manually into a savings Wallet that represents physical cash, so that my alkansya (coin bank — cash saved at home) counts too.
- As a cautious user, I want withdrawing from my savings Wallet to honestly reduce my goal progress, so that the number I see is real money, not a vanity metric.
- As a user who hit a goal, I want a clear completed state and the choice to keep, retarget, or archive, so that finished goals do not clutter my Plan tab.
- As a user whose phone killed background tracking for a week, I want my goal to show the right number again after I reconcile the Wallet balance, so that one bad week does not poison my progress history.

## UX states & flows

### States

| State | Description |
|---|---|
| Empty | No goals exist. Empty state on the Plan tab uses the `PlaneTakeoff` icon with a single call to action: create your first goal. |
| Normal | Goal cards show name, progress (₱ saved of ₱ target, progress ring), and — when a target date is set — a pace chip: On track / Behind / Reached / Past due. |
| Behind pace | Pace chip highlights the required per-payday amount to still hit the date (see Rule 9). |
| Reached | Balance ≥ `targetAmount`. Celebration state; card offers Complete, Raise target, or Keep as-is. |
| Past due | `targetDate` has passed with balance below target. Card offers Move the date, Lower the target, or Complete anyway. |
| Pending allocation (Plus) | A payday allocation prompt is open: the card shows "₱X planned this payday" until matched, recorded or skipped. |
| Gated | Free user at the goals cap (or Wallets cap) attempting creation sees the upgrade sheet; nothing is lost or hidden. See Free vs Plus. |

### Savings Wallets: tracked vs manual

A savings-type Wallet works like any other Wallet ([02-wallets.md](02-wallets.md)) with two flavors relevant to goals:

- **Tracked** — the Wallet has `matchers[]` mapping notification sources to it, so Ingest keeps its balance current automatically. PH examples from the provider catalogue ([../03-ingest-pipeline.md](../03-ingest-pipeline.md)): GCash GSave transfers, Maya savings transfers, and interest credits from SeaBank, GoTyme, or CIMB.
- **Manual** — no notification source exists (cash at home, a passbook account with no app). The user records deposits and withdrawals by hand, and periodic balance reconciliation keeps it honest.

Both flavors work identically for goals, because progress is derived from the Wallet balance either way (Rule 1). A tracked savings Wallet is the zero-effort path; a manual one costs the user an entry per deposit.

### Flow: create a goal (with savings Wallet)

1. Plan tab → Goals → Add goal.
2. Enter `name` and `targetAmount`; optionally set `targetDate` (absolute date picker).
3. Choose the linked savings Wallet: pick an existing savings-type Wallet with no active goal, or create one inline (name + optional matchers, e.g., GSave transfer notifications). Creating a Wallet here counts against the Wallets tier cap.
4. If the chosen Wallet already has a balance, the app states plainly: "₱12,000.00 already in this Wallet counts toward this goal." To start from zero, the user creates a fresh savings Wallet instead.
5. (Plus) Optionally set `contributionRule`: fixed ₱ amount or % of payday income, triggered on the user's income cadence (see [04-income.md](04-income.md)).
6. Save. The goal card appears with live progress immediately.

### Flow: contribution via Ingest (no logging)

1. User moves money in their bank/e-wallet app (e.g., GCash → GSave).
2. Ingest parses both notifications; TransferDetector pairs them into a TransferLink.
3. The savings Wallet balance rises; goal progress recomputes; pace chip updates.
4. If a milestone is crossed (Rule 12), the app posts its own notification. *Illustrative:* "Halfway there! ₱25,000.00 of ₱50,000.00 saved for Emergency Fund."

### Flow: payday auto-allocate (Plus)

1. Payday income is detected in one of `IncomeProfile.sourceWalletIds` (or the fallback in Rule 16 fires).
2. The app computes the planned amount from `contributionRule` (fixed ₱, or % of the detected income) and posts a prompt. *Illustrative:* "Payday! Move ₱2,000.00 to Emergency Fund — 6 paydays to your target."
3. The user moves the money in their banking app. Ingest detects the incoming transfer to the linked Wallet and marks the planned contribution complete — no in-app action needed.
4. Alternatively, the user taps the prompt and chooses Record now (creates a manual transfer, e.g., from the cash Wallet) or Skip this payday.
5. The planned amount is already set aside in the Safe-to-Spend formula from the start of the period (a forecast of the scheduled allocation); while pending it continues to be subtracted until matched, recorded or skipped (see [09-safe-to-spend.md](09-safe-to-spend.md), rule 6, and Rule 15 below).

### Flow: complete or edit a goal

1. From the goal card: Edit changes `name`, `targetAmount`, `targetDate`, or `contributionRule`; pace recomputes immediately.
2. Changing the linked Wallet shows a confirmation explaining that progress will re-base on the new Wallet's balance.
3. Complete is offered on the goal's detail screen once the goal is Reached, and on a Past due goal as "complete anyway". It retires the goal with its history retained: the goal leaves the live list and is restorable from Plan → Goals. The Wallet and its Transactions are untouched; the user may then archive the Wallet from [02-wallets.md](02-wallets.md) flows.
4. Delete removes only the Goal record — never the Wallet, never any Transactions.

## Rules & edge cases

1. **Progress source (decided): progress = linked savings Wallet balance.** Goal progress is `linkedWalletId` Wallet `balance` measured against `targetAmount`. We deliberately do not sum tagged "contribution" transactions. Rationale: balance-based progress is self-healing (withdrawals honestly reduce progress), requires zero user classification effort, and stays correct even when a deposit arrives through a channel the parser missed and the user fixes the balance via reconciliation.
2. A Goal's `linkedWalletId` must reference an existing Wallet that no other live Goal claims. **Any Wallet is eligible.** The `type: savings` requirement was dropped with the `type` column itself (migration `014_drop_wallet_type.sql`) rather than re-expressed against the inferred `owed`/`manual`/`tracked` kinds, because none of those three describes "a place savings sit": a goal-backing Wallet is whichever one the user actually saves in, and only they know which that is.
3. **At most one active Goal per savings Wallet.** Because progress equals balance, two goals on one Wallet would double-count every peso. Users who want multiple goals create multiple savings Wallets.
4. A savings Wallet's pre-existing balance counts toward a newly attached goal in full. Starting from zero requires a fresh Wallet (stated in the creation flow; no hidden offsets).
5. Progress percent = balance ÷ `targetAmount`. Display floors at 0% (a negative savings balance shows 0% with an attention state) and the ring caps at 100%, while the amount line always shows true figures (e.g., "₱52,300.00 of ₱50,000.00").
6. Incoming TransferLinks to the savings Wallet raise progress but are excluded from spend and income totals, per domain invariant 2 (see [../02-domain-model.md](../02-domain-model.md)). Saving money never inflates income or spending reports.
7. Direct inflows to the savings Wallet that are not transfers (e.g., SeaBank interest credit parsed by Ingest) also raise progress, because progress is balance-based.
8. Cash contributions are recorded as a manual transfer from the cash Wallet to the savings Wallet, or as a manual `direction: in` Transaction on the savings Wallet when the cash came from outside tracked money.
9. **Pace indicator (requires `targetDate`).** Required pace R = (`targetAmount` − balance) ÷ paydays remaining before `targetDate`, using the `IncomeProfile.cadence` (kinsenas → 15th and 30th; weekly; monthly). When cadence is `irregular`, pace is computed per month instead of per payday.
10. Pace status: **Reached** when balance ≥ `targetAmount`; **Past due** when `targetDate` has passed and the target is unmet; otherwise **On track** when the reference pace P ≥ R, and **Behind** when P < R. Reference pace P = the `contributionRule` amount when one is set; otherwise the average net inflow to the linked Wallet per cadence period over the trailing 3 periods. Goals without `targetDate` show progress only — no pace chip.
11. The Behind state always shows the concrete fix: "Save ₱1,250.00 per payday to hit June 1." It never shows only a warning color.
12. Milestone notifications fire when progress first crosses 25%, 50%, 75%, and 100%. Each milestone fires at most once per goal lifetime, so balance dips and recoveries cannot re-trigger them. When one change crosses several milestones, EACH of them is announced, lowest first (owner's ruling, 2026-09-24). Limits do the opposite, announcing only the highest crossed ([../06-information-architecture.md](../06-information-architecture.md) §6.2 rule 2), and Goals deliberately part company with them here. A Goal funded from nothing to complete in a single transfer therefore posts four notifications, which §6.2 rule 6 collapses into one summary; that is accepted, and it is the one case where "Goal reached" arrives as a summary line rather than its own notification. A Goal created on, or moved onto, a Wallet that already sits past a milestone announces the level it STARTS at and nothing below it: the creation flow states that balance (Rule 4), and a relink re-bases progress on it. All goal notification texts in this document are illustrative.
13. `contributionRule` (Plus) supports a fixed ₱ amount or a percent of payday income. Percent rules compute from the sum of income Transactions detected on that payday date across `IncomeProfile.sourceWalletIds`.
14. A planned contribution created by a payday trigger is **pending** until: (a) incoming transfers/deposits into the linked Wallet within 3 days of the trigger total at least the planned amount → **completed**; (b) the user records it manually → **completed**; or (c) the user skips → **skipped** (this payday only; the rule stays active). **THERE IS NO EXPIRED STATE** (owner's ruling, 2026-09-24): a contribution nobody matched, recorded or skipped stays pending, and its reservation stands, because the reservation is built from pay that already arrived ([09-safe-to-spend.md](09-safe-to-spend.md), rule 6b) and so was never stale to begin with. Partial inflows reduce the outstanding prompt amount. "Within 3 days" means the payday's own local day through the third day after it, and the pay credit itself never counts. Dismissing the allocation prompt with "Not now" decides nothing, since the user may still move the money in their banking app; an unchecked row in the prompt, or "Skip this payday", is a skip. Only the latest payday's contribution is shown as pending, and the card stops asking after 31 days; that is the PROMPT going quiet, not the reservation ending.
15. A scheduled contribution is subtracted from Safe-to-Spend from the start of the Limit period in which its allocation date falls (a forecast — see [09-safe-to-spend.md](09-safe-to-spend.md), rule 6), then tracked as pending from the payday trigger until matched, recorded or skipped; a skip removes what has not moved from the term, and nothing else does, since a pending contribution never expires (Rule 14). Free users cannot have a `contributionRule`, so no goal term is subtracted for them.
16. Fallback trigger: if no payday income is detected by the end of the cadence date, the prompt still fires using `IncomeProfile.averageAmount` as the percent base. Users on `irregular` cadence get no automatic trigger; the rule stores their preference and they can fire it manually from the goal card when they get paid.
17. **The app never moves money.** Auto-allocation is a prompt-and-reconcile mechanism only; the user always executes the transfer in their own banking or e-wallet app, or records a cash movement.
18. Archiving a savings Wallet linked to an active Goal follows the standard archive guard rails in [02-wallets.md](02-wallets.md): the confirmation lists the Goal impact, and on acknowledgment the Goal pauses — progress freezes at the archived Wallet's last balance and `contributionRule` prompts stop — until the Wallet is unarchived or the Goal is relinked to another savings Wallet. Archiving is never silently destructive: the paused Goal card states plainly why progress is frozen.
19. **Deleting and completing a Goal are both soft, and both restorable.** Either one stamps the Goal's `archivedAt` and nothing else: the row survives with its target, deadline, contribution rule and created date, the Goal leaves the live list, its savings Wallet is freed for a new Goal, and Plan → Goals restores it (a restore is refused only when another live Goal has claimed that Wallet in the meantime). Neither ever touches the Wallet or a single Transaction. The Goal schema records *when* a Goal was retired, not *why*, so a completed Goal is told apart from a deleted one only where the app can derive it — balance ≥ `targetAmount`, Rule 10's own Reached test. Deleting a Wallet follows domain invariant 4 (reassign or archive its Transactions) and is handled by Wallet flows, not here.
20. Editing `targetAmount` or `targetDate` recomputes pace immediately; milestones already fired do not re-fire even if the new target moves progress back below a fired threshold.
21. Balance reconciliation on a savings Wallet (the user corrects the balance to match reality, per [02-wallets.md](02-wallets.md)) flows straight into goal progress — another consequence of Rule 1. A reconciliation that lowers the balance can move a goal from Reached back to in-progress; the amount line updates, but fired milestones do not re-fire (Rule 12). A reconciliation that RAISES the balance past a milestone for the first time announces it, like any other change to the balance: this rule forbids a re-fire, not a first fire, and the acceptance criteria below require a goal on a manual Wallet to behave like one on a tracked Wallet given the same balance history.
22. Interrupted tracking (listener killed by an OEM battery manager, or listening paused by the user) cannot permanently corrupt a goal: once the Wallet balance is reconciled after the "tracking was interrupted" banner, progress re-derives from the corrected balance. Planned contributions pending during an interruption remain pending until matched, recorded or skipped per Rule 14.
23. Tier gates follow the global principle: keep data, block creation of new, never delete (see Free vs Plus below).

## Data touched

| Entity | Access | Notes |
|---|---|---|
| Goal | Read/write | Full lifecycle: `name`, `targetAmount`, `targetDate?`, `linkedWalletId`, `contributionRule?`. |
| Wallet | Read/write | Creates savings-type Wallets inline; reads `balance` for progress; surfaces the archive impact acknowledgment and Goal pause (Rule 18). |
| Transaction | Read; write for manual contributions | Reads inflows for pace and planned-contribution completion; manual recording creates `source: manual` Transactions. |
| TransferLink | Read | Incoming transfer legs are the primary contribution signal. |
| IncomeProfile | Read | `cadence`, `averageAmount`, `sourceWalletIds[]` drive payday triggers, percent rules, and pace math. |
| Entitlements | Read | Evaluated at goal creation, savings-Wallet creation, and every `contributionRule` call-site. |

## Free vs Plus

Relevant rows of the tier matrix (see [../05-monetization.md](../05-monetization.md) for the full matrix):

| Capability | Free | Plus |
|---|---|---|
| Wallets | 3 | Unlimited |
| Goals | 1 | Unlimited + payday auto-allocate |

Behavior at the gate — always keep data, block creation of new, never delete:

- A free user with 1 goal who taps Add goal sees the upgrade sheet; the existing goal is untouched.
- Goal creation can also be blocked upstream by the Wallets cap (3): if all 3 free Wallets are in use and none is an eligible savings Wallet, creating the goal's savings Wallet triggers the Wallets gate. The upgrade sheet names the actual blocking cap.
- `contributionRule` is Plus-only: free users see the payday auto-allocate option in a locked state with a one-line explanation, and no payday prompts fire for them.
- On downgrade from Plus: all existing goals remain visible with live progress (progress is derived from balance, so it keeps updating); creating new goals is blocked while over the cap; `contributionRule` settings are retained but paused — no prompts fire and no planned contributions are created until the user is back on Plus.

## Acceptance criteria

- [ ] Creating a goal requires `name`, `targetAmount`, and a linked Wallet that no other live goal claims; `targetDate` and `contributionRule` are optional.
- [ ] A savings Wallet with an active Goal cannot be selected for a second Goal; archiving it requires acknowledging the Goal impact and pauses the Goal (progress frozen) until the Wallet is unarchived or the Goal is relinked.
- [ ] A detected transfer into the linked Wallet updates goal progress with no user action, and does not appear in spend or income totals.
- [ ] A withdrawal from the linked Wallet reduces progress on next display.
- [ ] With a `targetDate` set, the pace chip shows exactly one of: On track, Behind, Reached, Past due — matching Rules 9–10 for a table of known inputs (balance, target, dates, cadence).
- [ ] The Behind state displays the required per-payday (or per-month, for irregular cadence) amount.
- [ ] Milestone notifications fire once each at 25/50/75/100% and never re-fire after balance dips.
- [ ] (Plus) A detected payday income in a source Wallet produces an allocation prompt with the correct fixed or percent amount; the prompt completes automatically when a qualifying transfer arrives within 3 days.
- [ ] (Plus) A scheduled contribution reduces Safe-to-Spend from the start of its period (forecast); while pending it reduces the number by its outstanding amount; skipping restores what has not moved, and nothing else restores it.
- [ ] Free tier: second-goal creation is blocked with an upgrade sheet; no existing data is altered; payday auto-allocate is visibly locked.
- [ ] Downgrade from Plus keeps all goals tracking and pauses all `contributionRule` prompts.
- [ ] Deleting a goal leaves the Wallet, its balance, and all Transactions intact.
- [ ] A balance reconciliation on the linked Wallet updates goal progress on next display, in both directions, without re-firing milestones.
- [ ] Goals on manual (matcher-less) savings Wallets behave identically to tracked ones given the same balance history.

## Open questions

1. Should percent-based `contributionRule` cap the allocation when a payday is abnormally large (e.g., 13th-month pay in December — a mandatory extra month of salary in the PH)? A 10% rule on a double payout may prompt more than the user intends; options are cap-at-average, prompt-with-both-numbers, or no cap.
2. When a goal is completed, should the app proactively offer to archive the now-purposeless savings Wallet (keeping free users under the Wallets cap), or is auto-suggesting archive too aggressive for a place real money still lives?
3. Multiple goals per savings Wallet (e.g., one Maya vault funding two goals) would require per-goal baselines and allocation splits, breaking the clean balance-equals-progress rule. Is this demanded enough to design for v2, or does "one Wallet per goal" hold?
