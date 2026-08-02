# Wallets

Wallets are the money locations everything else hangs off: every Transaction belongs to exactly one Wallet, matchers route notifications to them, and balances live on them. This doc specifies Wallet CRUD, the five types, matcher behavior (including one provider feeding multiple Wallets), balance handling, cash reconciliation, and the archive/delete rules that enforce invariant 4.

**Status:** Draft v1 · 2026-08-02

## Purpose

A Wallet is a user-named money location — bank, e-wallet, cash, credit, or savings — as defined in the [domain model](../02-domain-model.md). Wallets are where the Ingest pipeline lands its output (via `matchers[]`), where balances are kept honest (reported balance-after vs computed running balance), and the only place cash gets tracked at all (manual entry plus reconciliation prompts). Because invariant 1 says a Transaction belongs to exactly one Wallet and invariant 4 forbids orphan Transactions, Wallet deletion is deliberately constrained and archiving is the recommended path. This doc is the canonical spec for all of that; the pipeline stages that feed Wallets are specified in the [ingest pipeline doc](../03-ingest-pipeline.md).

## User stories

- As a user with GCash, a BPI account, and pocket cash, I want one Wallet per money location, so that my ledger mirrors where my money actually is.
- As a GCash user with GSave, I want notifications from the one GCash app to land in the right Wallet (main vs GSave), so that my savings don't look like spending money.
- As a user, I want each Wallet's balance to track what the provider says my balance is, so that I trust the app without opening five banking apps.
- As a cash spender, I want the app to periodically ask "how much cash do you actually have?", so that untracked jeepney fares and palengke runs don't silently corrupt my totals.
- As a user closing an old bank account, I want to archive that Wallet without losing its history, so that old reports still make sense.
- As a user who created a Wallet by mistake, I want to delete it safely, so that its few Transactions get reassigned instead of vanishing.
- As a saver, I want a savings-type Wallet I can link a Goal to, so that goal progress reads straight from a real balance.
- As a Free-tier user, I want to know the Wallet cap before I hit it, so that the gate never feels like a surprise or a data threat.

## UX states & flows

### Wallets tab states

| State | Description | What the user sees |
|---|---|---|
| Empty | No Wallets exist (possible only if onboarding proposals were all removed) | Lucide `Send` empty state + "Add your first Wallet" |
| Normal | ≥1 active Wallet | List: name, type icon, current `balance`, last-activity time; total across active Wallets at top |
| Attention — reconciliation due | A cash Wallet has a pending reconciliation prompt | Badge on that Wallet row + inline "Reconcile" action |
| Attention — balance drift | Reported balance-after disagrees with computed balance beyond tolerance | Warning glyph on the Wallet row; tapping opens the drift explainer |
| Attention — matcher conflict | Two matchers claim the same notification pattern | Banner linking to matcher management |
| Archived section | ≥1 archived Wallet | Collapsed "Archived" group at list bottom; rows are read-only until unarchived |

### Flow: create a Wallet

1. From the Wallets tab, "Add Wallet."
2. Pick `type`: **bank · e-wallet · cash · credit · savings** (fixed set of five).
3. Name it (defaults from provider if one is selected next).
4. Optionally attach provider matchers (skipped automatically for cash — see rules).
5. Optionally set a starting `balance` (writes the balance directly; creates no Transaction).
6. Save. Entitlements is checked at this call-site: on Free with 3 active Wallets, creation is blocked with the gate message (see Free vs Plus).

### Flow: edit a Wallet

Rename, change type, adjust starting balance (recorded as a manual adjustment Transaction if the Wallet already has Transactions — see balance rules), and manage matchers. Changing type never touches Transactions.

### Flow: matcher management (provider → Wallet mapping)

`matchers[]` on a Wallet declare which notification sources map to it. The SourceRouter and Normalizer stages of the [Ingest pipeline](../03-ingest-pipeline.md) resolve each parsed notification to a target Wallet via these matchers.

- **Simple case — one provider, one Wallet:** selecting "BPI" attaches the default BPI matcher (provider push + BPI-prefixed SMS-via-Messages relay) to that Wallet. Most users never open matcher management.
- **One provider feeding multiple Wallets:** a single provider app can host sub-accounts — the canonical example is **GCash main vs GSave**. Both post notifications from the same package, so provider identity alone cannot route them. Matchers therefore support content discrimination: a matcher = provider **+ optional content pattern** (e.g., notifications mentioning "GSave" — *illustrative; real discriminator phrases come from the captured parser corpus, never from this doc*). Setup: the user adds a second Wallet on the same provider and picks the sub-account pattern from parser-suggested options. The same mechanism covers Maya wallet vs Maya Savings, and ShopeePay/GrabPay living inside the Shopee/Grab apps.
- **Precedence:** the most specific matching rule wins — a provider+content matcher beats the provider-only matcher for the same provider. If no content matcher matches, the provider-only Wallet receives the Transaction.
- **Ambiguity is a Review Queue problem, not a guess:** if routing cannot be resolved with confidence (two content matchers match, or a sub-account pattern is present but no matcher claims it), the item lands in the [Review Queue](./08-review-queue.md). The user's assignment ("GCash notif matching X → wallet Y") is saved as a **UserRule** and replays on all future notifications.
- **Conflicts:** the app prevents saving two matchers with identical provider+pattern targeting different Wallets; the second save prompts the user to pick a single winner.

### Flow: balance handling

Every Wallet balance has two possible sources, reconciled by fixed rules:

1. **Reported (balance-after):** many provider notifications include the balance after the transaction; the Normalizer extracts it (see the [pipeline doc](../03-ingest-pipeline.md)). When a committed Transaction carries a balance-after for its Wallet, the Wallet `balance` snaps to that reported value. Reported wins because it is the provider's own statement of truth.
2. **Computed:** when no balance-after is available (cash Wallets always; providers that omit it; manual entries), `balance` = last known anchor (starting balance or last reported snap or last reconciliation) + signed sum of committed Transactions since, including Transfer Link legs (invariant 2: transfer legs are excluded from spend/income totals but *do* affect Wallet balances).
3. **Drift detection:** when a new reported balance-after disagrees with the computed expectation by more than a small tolerance, the snap still happens, and the Wallet enters the balance-drift attention state. The drift explainer shows the gap and offers: record the gap as an adjustment Transaction (keeps totals honest — typically a missed/unparsed transaction), or dismiss (accept the snap silently). Repeated drift on one provider is a parser-health signal surfaced in [Settings & Privacy → parser diagnostics](./11-settings-privacy.md).

### Flow: cash Wallet reconciliation

Cash can't send notifications, so cash Wallets stay honest through prompts:

1. **Triggers** for a reconciliation prompt on a cash Wallet: (a) a recurring schedule, default weekly, adjustable per Wallet; (b) right after an ATM/cash-out Transfer Link lands money in the cash Wallet ("You just took out cash — want to confirm what's in your wallet?"); (c) after 14 days with no cash activity at all.
2. **Prompt:** "How much cash do you have right now?" — a single amount field, plus snooze and "don't ask for this Wallet again" (re-enable in Wallet settings).
3. **Delta handling:** the difference between the entered amount and the computed balance is recorded as a manual Transaction (`source: manual`, direction `out` for missing money / `in` for surplus, `categoryId` = Uncategorized, `note` = "Cash reconciliation"). Missing cash almost always *was* spent, so it counts as spend — honest totals over pretty totals. The user can recategorize it from the ledger like any Transaction (e.g., to Transport).
4. Reconciliation resets the Wallet's computed-balance anchor to the entered amount.

### Flow: manual transaction entry (MVP scope item L1-8)

Manual entry exists for money the listener cannot see — cash above all, plus unsupported providers and gap backfill. It is deliberately a contained exception to the core promise, not a routine surface.

1. **Entry points:** the Transactions tab ("Add manual Transaction" — the "Manual entry (cash)" screen in [../06-information-architecture.md](../06-information-architecture.md)); a Wallet's detail screen (Wallet preselected); the reconciliation flow's "backfill specific forgotten expenses" path; and the Review Queue's "record the matching cash leg" action ([../03-ingest-pipeline.md](../03-ingest-pipeline.md) §7, rule 6). Loan and Bill manual-payment flows create manual Transactions through their own screens ([06-loans.md](./06-loans.md), [07-bills.md](./07-bills.md)).
2. **Form:** `amount` (required, > ₱0.00) · `direction` (default `out`) · Wallet (required, exactly one; preselected when entered from a Wallet, otherwise a picker with cash Wallets listed first; archived Wallets excluded) · date/time (defaults to now; backdatable to any past moment, never future-dated) · `categoryId` (defaults to Uncategorized) · `merchant` (optional) · `note` (optional).
3. **Save:** commits a Transaction with `source: manual`, `confidence` 1.0, and no `rawNotificationRef`, through the standard ledger-commit recompute — Wallet balance, Limits, Goal progress, Bill auto-match, Loan payment matching, Safe-to-Spend, and reports for the period containing the chosen timestamp.
4. Manual Transactions are edited and deleted like any other Transaction, and count toward Limits and reports identically (see [03-limits.md](./03-limits.md), rule 4).

### Flow: archive a Wallet

1. "Archive" from the Wallet's overflow menu; confirmation states what changes.
2. Effects: `isArchived: true`; hidden from all pickers (manual entry, Limit `walletFilter`, transfer targets); its matchers are **suspended**; its balance leaves the Wallets-tab total and all Safe-to-Spend/Limit math; its Transactions remain fully visible in history and reports.
3. If a suspended matcher would have matched an incoming notification, the item goes to the Review Queue flagged "wallet archived — unarchive it or pick another Wallet."
4. Guard rails before archiving: if the Wallet is a Goal's `linkedWalletId`, an active Loan's `linkedWalletId`, or in `IncomeProfile.sourceWalletIds[]`, the confirmation lists these links and asks the user to relink or accept pausing those features' automation.
5. **Unarchive** restores everything, subject to the Free active-Wallet cap (see Free vs Plus).

### Flow: delete a Wallet (guarded, per invariant 4)

1. "Delete" is offered only behind the archive option, framed as the destructive path.
2. If the Wallet has **zero** Transactions: delete immediately after confirmation.
3. If it has Transactions, the user must choose first: **reassign** all its Transactions to another active Wallet (they keep all other fields), or **archive instead** (recommended, preselected). There is no path that deletes or orphans Transactions.
4. Reassignment across a Transfer Link keeps the link intact unless both legs would land in the same Wallet — in that case the Transfer Link is dissolved and both Transactions go to the Review Queue for re-triage.

## Rules & edge cases

1. `type` is exactly one of **bank, e-wallet, cash, credit, savings**; no custom types in MVP.
2. Every Transaction belongs to exactly one Wallet (invariant 1); no Wallet-less or multi-Wallet Transactions exist in any flow, including deletion and reassignment.
3. `currency` is PHP on every Wallet; no multi-currency in MVP.
4. Cash Wallets have empty `matchers[]` and the matcher UI is hidden for them; money enters via manual entry, Transfer Links (e.g., ATM withdrawal out-leg from a bank Wallet, in-leg to cash), and reconciliation adjustments.
5. A matcher belongs to exactly one Wallet; a provider may appear in matchers of multiple Wallets only when content patterns disambiguate (GCash main vs GSave pattern).
6. Matcher precedence: provider+content beats provider-only; among content matchers, exact pattern beats broader pattern; unresolved ties go to the Review Queue — the pipeline never guesses between two matching Wallets.
7. Review Queue Wallet assignments create UserRules that replay on future notifications; a replayed UserRule outranks default matcher precedence.
8. Saving a matcher identical (provider+pattern) to one on another Wallet is blocked; the user must choose a single target Wallet.
9. A committed Transaction carrying balance-after snaps its Wallet's `balance` to the reported value; out-of-order arrivals snap only if the notification timestamp is newer than the current snapshot's.
10. Without balance-after, `balance` is computed from the latest anchor plus signed committed Transactions; Review Queue items awaiting confirmation are not counted (consistent with [Safe-to-Spend](./09-safe-to-spend.md)'s accepted simplification).
11. Transfer-linked Transactions affect Wallet balances but never spend/income totals, Limits, or reports (invariant 2).
12. Drift beyond tolerance triggers the attention state but never blocks committing; the snap always proceeds.
13. Editing the starting balance of a Wallet that already has Transactions records the difference as a manual adjustment Transaction rather than silently rewriting history.
14. Cash reconciliation deltas are ordinary manual Transactions: they count in spend/income totals and can be recategorized; they are excluded from nothing except what any Uncategorized Transaction is excluded from.
15. Reconciliation prompts fire only for cash Wallets, respect snooze/opt-out per Wallet, and at most one prompt per Wallet per day.
16. Archiving suspends matchers immediately; notifications matched by suspended matchers route to the Review Queue, never silently drop (they also remain in the raw store under the 30-day TTL like all captures, per invariant 3).
17. Archived Wallets are excluded from Safe-to-Spend, Limit `walletFilter` options, transfer targets, and the Wallets-tab total; their Transactions remain in history and reports.
18. Deleting a Wallet with Transactions is impossible without reassigning them (invariant 4); the flow offers reassign-or-archive and defaults to archive.
19. Reassignment preserves `rawNotificationRef` on affected Transactions (invariant 5 transparency survives moves).
20. Unarchiving is blocked on Free if it would exceed 3 active Wallets; the Wallet stays archived, nothing is deleted, and the gate message explains why.
21. Archiving the `linkedWalletId` of an active Goal or Loan, or a Wallet in `IncomeProfile.sourceWalletIds[]`, requires acknowledging the listed impacts; those features pause their Wallet-driven automation until relinked.
22. Savings-type Wallets are the only valid `linkedWalletId` for a Goal (see [Goals & Savings](./05-goals-savings.md)).
23. For credit Wallets, `balance` represents the outstanding amount owed and is displayed as an obligation, not spendable money; it is excluded from the "total across active Wallets" figure and from Safe-to-Spend inputs.
24. A manual Transaction requires `amount` > ₱0.00, a `direction` (default `out`), and exactly one target Wallet; its timestamp defaults to now, may be backdated, and is never future-dated; `categoryId` defaults to Uncategorized; `merchant` and `note` are optional. The committed record carries `source: manual` and `confidence` 1.0, with no `rawNotificationRef`.
25. A backdated manual Transaction recomputes the Wallet balance, Limits, Safe-to-Spend, and reports for the period containing its timestamp, but never re-fires alerts for past periods ([03-limits.md](./03-limits.md), rule 19).

## Data touched

| Entity | Access | Notes |
|---|---|---|
| **Wallet** | Create / read / update / archive / delete | `name`, `type`, `balance`, `currency (PHP)`, `matchers[]`, `isArchived` |
| **Transaction** | Read / create / update | Reads for computed balances and history; creates manual entries (L1-8), reconciliation deltas, and starting-balance adjustments (all `source: manual`); updates `walletId` on reassignment |
| **TransferLink** | Read / dissolve | Legs affect balances (invariant 2); dissolved only when reassignment would put both legs in one Wallet |
| **UserRule** | Create (via Review Queue) / read | "Provider notif matching X → wallet Y" routing corrections; replayed by the pipeline |
| **Goal** | Read | `linkedWalletId` checks on archive/delete guard rails |
| **Loan** | Read | `linkedWalletId` checks on archive/delete guard rails |
| **IncomeProfile** | Read | `sourceWalletIds[]` checks on archive/delete guard rails |
| **Entitlements** | Read | Active-Wallet cap evaluated at create and unarchive call-sites |

## Free vs Plus

Tier matrix (canonical, from [monetization](../05-monetization.md)):

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

Rows this feature touches: **Wallets** (the 3-Wallet Free cap is this doc's gate) and **Auto-tracking** (unlimited on both tiers — matchers and Ingest routing are never tier-restricted on the Wallets a user has). The **History** row shapes how far back a Wallet's transaction list reaches on Free (90 days), but that gate is owned by [Reports](./10-reports.md) and the ledger, not by Wallets.

Behavior at the gate (Free, cap reached): creating a new Wallet and unarchiving a Wallet are blocked when either would exceed **3 active Wallets** — with a short explanation and a Plus pointer. The cap counts active (non-archived) Wallets only, so archiving an old Wallet frees a slot; this keeps the gate about breadth, never about data. Existing Wallets, their Transactions, matchers, and balances are always kept; nothing is deleted or hidden at the gate, and a user who lapses from Plus with more than 3 active Wallets keeps them all read-and-track (ingest continues) but cannot add more. During MVP, `tier` is hardcoded `plus`, so the gate exists in code paths but is not felt.

## Acceptance criteria

- [ ] A user can create, rename, retype, archive, unarchive, and (when guarded conditions are met) delete a Wallet of each of the five types.
- [ ] Creating a Wallet with a provider attaches default matchers, and committed notifications from that provider land in it end-to-end.
- [ ] Two Wallets on one provider (GCash main + GSave pattern) route their respective notifications correctly, with ambiguous ones landing in the Review Queue, and a Review Queue assignment creating a UserRule that routes the next matching notification without asking.
- [ ] Saving a duplicate provider+pattern matcher on a second Wallet is blocked with the pick-a-winner prompt.
- [ ] A committed Transaction with balance-after snaps its Wallet's balance; one without it advances the computed balance; an out-of-order older notification does not overwrite a newer snapshot.
- [ ] Drift beyond tolerance shows the attention state and offers record-adjustment vs dismiss; the adjustment Transaction appears in the ledger as `source: manual`.
- [ ] Manual entry works from the Transactions tab, a Wallet detail, and reconciliation backfill; the saved Transaction carries `source: manual`, `confidence` 1.0, and the defaults (direction `out`, timestamp now, category Uncategorized) when not overridden.
- [ ] A backdated manual Transaction recomputes Limits, Safe-to-Spend, and reports for the period containing its timestamp without re-firing past-period alerts; future-dating is rejected.
- [ ] Cash Wallets show no matcher UI; reconciliation prompts fire on schedule, after a cash-out Transfer Link, and after 14 idle days; snooze and per-Wallet opt-out work.
- [ ] Completing a reconciliation writes the delta as a recategorizable manual Transaction and resets the computed-balance anchor.
- [ ] Archiving hides the Wallet from all pickers, suspends matchers, removes its balance from totals and Safe-to-Spend, keeps its Transactions in history/reports, and routes newly matched notifications to the Review Queue with the archived-wallet flag.
- [ ] Deleting a Wallet with Transactions is impossible without reassigning them; reassignment preserves `rawNotificationRef` and dissolves a Transfer Link only when both legs would share one Wallet (sending both to the Review Queue).
- [ ] Archiving a Wallet linked to a Goal, Loan, or IncomeProfile lists those links in the confirmation and pauses the dependent automation until relinked.
- [ ] With a `free` Entitlements tier in a test build: the 4th active Wallet is blocked at create and at unarchive, no data is deleted, and ingest continues on all existing Wallets.
- [ ] Credit-type Wallet balance displays as amount owed and is excluded from the active-Wallets total and Safe-to-Spend inputs.
- [ ] Any sub-account discriminator phrases shown in matcher setup are sourced from the parser corpus at runtime and marked illustrative in all design/spec materials.

## Open questions

1. **Drift tolerance value.** The threshold separating "snap silently" from "show the drift state" (a fixed peso amount, a percentage of balance, or a hybrid) needs tuning against real parser accuracy data during M1; too tight makes noise, too loose hides parser rot.
2. **Credit Wallets vs Bills overlap.** A credit Wallet's statement cycle and due date overlap conceptually with a [Bill](./07-bills.md) ("pay credit card on the 20th"). Whether the credit Wallet should auto-suggest a companion Bill, or Bills stay fully manual for credit, needs a decision before M2 to avoid double-reminding.
3. **Default reconciliation cadence.** Weekly is the assumed default for cash prompts; whether the default should instead key off the user's income cadence (e.g., prompt at kinsenas boundaries when `cadence: kinsenas`) is open until early usage data exists.
4. **Sub-account discovery.** Whether the app should proactively suggest "looks like you also have GSave — create a Wallet for it?" after seeing unmatched sub-account patterns, or wait for the user to act from the Review Queue, is open; proactive suggestion is friendlier but depends on discriminator reliability from the captured corpus.
