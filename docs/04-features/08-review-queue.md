# Review Queue

The Review Queue is the pressure valve of the ingest pipeline: the one place where anything the pipeline could not commit with confidence waits for a one-or-two-tap human decision. Every correction the user makes there becomes a UserRule that replays on future notifications, so parser gaps become training data instead of bug reports. This document specifies what lands in the queue, the triage interactions, UserRule creation and replay, the merge/split/link/unlink tools, the unknown-provider flag flow, badge behavior, and concrete queue-hygiene rules.

**Status:** Draft v1 · 2026-08-02

## Purpose

The ingest pipeline auto-commits only what it is sure of (ConfidenceGate — see [../03-ingest-pipeline.md](../03-ingest-pipeline.md)); everything uncertain is routed here rather than silently guessed. That single design choice protects the ledger's integrity (wrong auto-commits corrupt totals and destroy trust — risk #4 in [../08-risks-and-open-questions.md](../08-risks-and-open-questions.md)) while keeping the user's workload tiny: confirm in one tap, correct in two. The queue is also the app's self-improvement loop — every triage decision produces a UserRule the pipeline replays, and every unknown-provider flag is a signal for future parser coverage. The queue must feel like a 20-second daily sweep, never like data entry.

## User stories

- As a user, I want anything the app wasn't sure about collected in one place with an obvious badge, so that I can clear it in seconds and trust everything else was handled.
- As a GCash user with an oddly worded notification, I want to confirm the app's best guess with one tap — or fix the category with two — so that triage never feels like logging a transaction.
- As a user who corrected "JUAN D" to the Utang & Loan Payments category once (*utang* = personal debt), I want that correction remembered and applied automatically next time, and offered retroactively for past transactions.
- As a user whose bank sends both a push and an SMS for the same debit, I want suspected duplicates shown side by side so I can settle "same or different" in one tap without double-counted spend.
- As a user moving money from BPI to GCash, I want an ambiguous transfer suggestion I can confirm as "between my wallets," so that internal movements never inflate my spend or income.
- As a user of a bank the app doesn't support yet, I want to flag its notification as "this is a money notification," so that my ledger stays complete and the app learns the source exists.
- As a privacy-conscious user, I want unresolved items to expire rather than pile up or silently commit, so that the queue never becomes a guilt list and nothing is guessed on my behalf.

## UX states & flows

The queue lives at the top of the **Transactions** tab, with a numeric badge on the tab itself (see Rules §Badge behavior).

### States

| State | When | Display |
|---|---|---|
| Empty | Nothing to triage | Collapsed to a single quiet line: "All caught up." No empty-state artwork inside the ledger — absence of work is the reward. |
| Normal | 1–25 actionable items | Card list, oldest first (items closest to expiry surface first). Each card: the app's best guess, the source line that produced it ("why"), and type-specific actions. |
| Backlog | >25 actionable items | Banner: "That's a lot of unreviewed items — parsers may be out of date." Offers grouped triage (items clustered by source pattern) and emits a parser-health telemetry signal (aggregate counts only, never content). |
| Unrecognized sources | ≥1 unknown-provider capture | A collapsed section below the actionable list: "Unrecognized notifications (N)," grouped by source app. |
| Item detail | Tap a card | Full parse breakdown: every extracted field, the captured source text (while retained), and the full action set. |

### Item types and their cards

| Type | Routed from | Card shows | One-tap action | Two-tap correction |
|---|---|---|---|---|
| Low-confidence parse | ConfidenceGate | Proposed Transaction: amount, direction, Wallet, merchant, category — uncertain fields visually flagged | **Looks right** (commits) | Tap any field chip → picker → commit |
| Suspected duplicate | DedupeGate | Both records side by side with the differing fields highlighted | **Same transaction** (keeps one, discards the held twin) | **Different** (commits the held twin as its own Transaction) |
| Ambiguous transfer | TransferDetector | The candidate out-leg and in-leg with wallets, amounts, and the fee difference | **It's a transfer** (creates the Transfer Link) | **Not a transfer** (legs stay independent) |
| Unknown provider | SourceRouter unknown-bin | Source app name + captured snippet | **This is a money notification** (opens flag flow) | **Not money** (discards; the repeated-dismissal mute offer is deferred to v2 — see Rules) |

### Flow: triage a low-confidence parse

1. Card shows, e.g.: amount ₱1,250.00 · out · GCash Wallet · merchant "7-ELEVEN" · category Food & Dining, with the merchant field flagged as the uncertain part. The source notification line is shown beneath it — **all notification text in this document is illustrative only** (see [../03-ingest-pipeline.md](../03-ingest-pipeline.md) on the versioned parser corpus).
2. One tap **Looks right** → the Transaction commits exactly as proposed.
3. Or: tap the category chip → category picker → selection commits the Transaction with the fix. Two taps total for the common correction path; edits to amount/direction/wallet follow the same chip pattern.
4. Any correction creates a UserRule (see Rules §UserRule creation) and, when ≥1 past transaction would match it, shows the retroactive-replay prompt (below).

### Flow: retroactive replay

After a correcting triage: "Apply to 12 similar past transactions?" → **Preview** shows the affected list → **Apply** re-writes them in bulk; **Skip** applies the rule to future ingests only. Any replay touching more than 10 transactions always requires the preview step. Replay reaches only retained history (see Free vs Plus).

### Flow: resolve a suspected duplicate

1. The DedupeGate commits the first record and holds the suspected twin **uncommitted** — totals never double-count while the question is open.
2. **Same transaction** → the held twin is discarded and the record that arrived **first** survives. Nothing is weighed for richness and nothing is merged: `mobile/lib/ingest/dedupe_gate.ts` returns a verdict and nothing else, `mobile/lib/ingest/pipeline.ts` answers a `duplicate` verdict by writing nothing at all, and this card's "Same transaction" resolves the item without touching the committed row. So an SMS relay that beat its push through the twin window keeps the ledger, and the push's reference number and balance-after go with the twin. See the MVP amendment under [../03-ingest-pipeline.md](../03-ingest-pipeline.md) §6 rule 5; the richer-parse tie-break and field union are deferred in [../09-v2-backlog.md](../09-v2-backlog.md) §2b.7. **No dedupe signature UserRule is created either**, contrary to what this rule said until 2026-09-06: `UserRuleAction` (`mobile/types/domain.ts`) has six kinds and none of them expresses a dedupe signature, and the dismiss path runs a bare `resolve` with no `teachFrom`. Nothing is learned from resolving a duplicate, so the same push/SMS twin pattern is asked about again next time. That gap has no deferral record yet.
3. **Different** → the held twin commits as an independent Transaction.

### Flow: resolve an ambiguous transfer

1. Both legs are already-committed Transactions; the card asks only whether to pair them.
2. **It's a transfer** → a TransferLink pairs them; both legs leave spend/income totals immediately (Limits and Safe-to-Spend recompute); a pairing UserRule is created for this wallet-pair pattern.
3. **Not a transfer** → the suggestion is dismissed; both legs continue to count normally.

### Flow: unknown provider — "this is a money notification"

1. The unrecognized-sources section lists captures grouped by source app. Only notifications passing the money-signal heuristic are ever retained here (see Rules); everything else was discarded at the SourceRouter without being stored.
2. Tapping **This is a money notification** opens an assisted form: the app prefills whatever it can extract (an amount-looking token, a direction guess); the user confirms amount, direction, and the Wallet it belongs to.
3. On save: a Transaction commits (`source: notification`, with `rawNotificationRef` while the raw text is retained), and a UserRule maps that source pattern → Wallet so the next capture from this source arrives pre-filled.
4. If diagnostics sharing is enabled ([11-settings-privacy.md](11-settings-privacy.md)), a parser-coverage signal is emitted: source package and a count only — never notification content. This is how new providers earn a real parser.
5. **Not money** → the capture is discarded. After 2 dismissals from the same source pattern, the app offers "Always ignore notifications like this" (a mute UserRule at the source level). **The ×2 offer is deferred to v2** ([../09-v2-backlog.md](../09-v2-backlog.md) §2b.3): dismissal works, and a user can still mute a source directly, but the app does not volunteer it on the second dismissal.

### Flow: merge / split / link / unlink from the ledger

These tools also work outside the queue, directly on committed transactions — the queue proposes, but the user can always act unprompted:

- **Merge** — select two transactions → "Merge as duplicates" → choose the survivor (default: the richer record) → the other is suppressed; a dedupe signature UserRule is created.
- **Split (undo merge)** — from a merged transaction's detail: "This was two separate transactions" → restores the suppressed record. Available while the suppressed record's data is retained (within the 30-day raw-text TTL); afterward the fallback is a manual entry.
- **Link as transfer** — select an `out` and an `in` transaction in different Wallets → "Link as transfer" → validation (opposite directions, different Wallets, amounts within fee tolerance; a difference beyond fee tolerance warns but can be confirmed) → creates the Transfer Link.
- **Unlink transfer** — from either leg's detail: "Not a transfer" → removes the TransferLink; both legs re-enter spend/income totals; Limits and Safe-to-Spend recompute.

## Rules & edge cases

### What lands in the queue

1. **Low-confidence parse** — the ConfidenceGate routes any parse below the auto-commit threshold; the Transaction is held uncommitted until triaged.
2. **Unknown provider** — the SourceRouter's unknown-bin captures notifications from unrecognized packages **only if** they pass the money-signal heuristic: the text contains a currency marker or amount-shaped pattern (e.g., `₱`, `PHP`, `1,234.56`). Non-matching notifications are discarded immediately and their text is never stored — a data-minimization requirement, not an optimization (see [../07-privacy-and-compliance.md](../07-privacy-and-compliance.md)). One that arrived while the app was closed leaves only its app and its times, for the Privacy centre ([../03-ingest-pipeline.md](../03-ingest-pipeline.md) §1 principle 2).
3. **Ambiguous transfer** — a TransferDetector candidate pair below the auto-link threshold (amounts near-equal but outside tight fee tolerance, or timing at the window's edge). Both legs are committed; only the pairing is queued.
4. **Suspected duplicate** — a DedupeGate near-match (same amount, close timestamps, but no shared reference number). The first record commits; the twin is held uncommitted.
5. Held items (types 1 and 4) are **not** counted in wallet balances, Limits, reports, or Safe-to-Spend until confirmed — the accepted simplification stated in [09-safe-to-spend.md](09-safe-to-spend.md). Balance drift from long-held items is caught by cash reconciliation prompts ([02-wallets.md](02-wallets.md)).
6. One real-world event produces at most one actionable item: an ambiguous parse that is also a suspected duplicate queues once, as the duplicate (the stricter question), resolving both on triage.

**As shipped — 2026-09-04.** Rule 6 previously held only within a single telling. A bank that
sends both a push and an SMS for one debit produced two cards, and confirming both wrote two
ledger rows. Two mechanisms now enforce the rule across channels:

- On the queue path, a capture carries its `channel`, `providerKey`, `referenceNo` and
  `occurredAt` in the item payload, and `findOpenTwin` suppresses the second telling when an
  open card already exists for the same movement on the **other** channel. Both channels must be
  known and must differ: two genuine identical purchases minutes apart on the same channel stay
  two cards, because collapsing them would lose a real transaction.
- On the triage path, confirming a card runs the duplicate check before inserting, so a card
  whose twin already auto-committed on the other channel resolves onto the existing row instead
  of committing a second one.

A suppressed capture produces neither a transaction nor a card, so it writes the same
already-resolved marker the ledger-side merge writes. Without it the recovery sweep would raise
a fresh card the moment the user dismissed the twin. `balanceAfter` is carried in the payload
but deliberately not applied to the committed row: the wallet snap has no "only if newer" guard,
so a card triaged days later would re-anchor the balance to a stale figure.

### Triage interaction contract

7. Every item type has a primary action reachable in exactly **one tap** from the card, and every correction path completes in **two taps** (chip → picker). Anything needing more taps belongs in the item detail, not the card.
8. Confirming a proposed Transaction commits it with `confidence` set to 1.0 — a human decision outranks any parser score. `source` remains `notification` and `rawNotificationRef` is preserved (while raw text is retained) so "why did the app record this?" always has an answer.
9. Triage is undoable: a just-triaged item shows an undo affordance for 10 seconds; committed results remain editable in the ledger indefinitely afterward.
10. Dismissing is never destructive to the ledger: only held (uncommitted) records can be discarded; committed transactions are never deleted by any queue action.
11. If a Wallet referenced by a queued item is archived before triage, the triage flow asks the user to pick a target Wallet (consistent with the no-orphan-transactions invariant in [../02-domain-model.md](../02-domain-model.md)).

#### As shipped — 2026-09-19 (`app/review/index.tsx`, `hooks/mutations/use_review_action.ts`)

**Rules 9 and 10 disagreed, and rule 9 was only half built.** Rule 9 promises a ten-second undo affordance; rule 10, twelve words later, is unqualified — "committed transactions are never deleted by any queue action". Undoing a confirm means deleting the Transaction it wrote, so the two cannot both be honoured as written. What shipped in the first pass was the undo for the four triages whose entire write is `resolved_at`: the low-confidence and unknown-provider rejects, "Same transaction" on a duplicate whose twin was never committed, and "Not a loan payment". Every committing triage offered nothing at all. Filed as GAP-075.

> **OWNER DECISION (2026-09-19): rule 10 wins, and no rule text changes.** Rule 9's own second clause is the remedy for a committed triage — results "remain editable in the ledger indefinitely afterward" — so the affordance exists for those too; it says **Edit** and opens the ledger row, inside the same ten seconds and on the same strip. The alternative considered and rejected was a carve-out in rule 10 permitting a delete inside the undo window, which buys a truer "undo" at the cost of the one guarantee the queue makes about the ledger.

**Confirm and correct only.** Both commit one proposed Transaction and both answer "which row did this leave behind" with exactly one id. A transfer confirm writes a pair, a merge keeps one row and drops another, and a link joins two that already existed; none has a single row that is "the result", and sending the user to edit half of a pair would be worse than sending them nowhere. Those keep the ledger's own screens, which rule 9's second clause is equally true of.

**The row it opens is read back from the commit, not from the card.** `correctItem` resolves onto a PRE-EXISTING Transaction when one already holds the movement, and returns that row's id. Under the delete-flavoured undo that was a trap — it would have destroyed the other ingest channel's row. Under an Edit it is exactly right: the id names whichever row now holds the movement.

**One offer at a time.** The Edit and Undo offers share a dedupe key, so a second triage replaces the first and restarts its ten seconds rather than stacking a second button over a list that has already moved.

### UserRule creation and replay

12. **Every correction creates a UserRule.** The mapping is:

| Triage action | UserRule created | Replays as |
|---|---|---|
| Category correction | merchant/pattern → category (e.g., "merchant JUAN D → category Utang") | Categorizer stage |
| Wallet correction | source pattern → Wallet (e.g., "GCash notif matching X → wallet Y") | SourceRouter/Normalizer stage |
| "Same transaction" merge | duplicate signature → suppress twin | DedupeGate stage — **deferred to v2** |
| "It's a transfer" | wallet-pair + pattern → auto-link | TransferDetector stage |
| "Not money" ×2 → mute | source pattern → ignore | SourceRouter stage — **deferred to v2** |
| Money-notification flag | source pattern → Wallet + parse hints | SourceRouter stage |

**Two of those rows are out of the MVP as of 2026-08-30, with their reasoning in
[../09-v2-backlog.md](../09-v2-backlog.md).** The dedupe-signature rule is unwritable against the
current rule model, which has no signature-bearing action kind and no rule input on the DedupeGate,
so such a rule would sit in the diagnostics list unable to fire (§2b.4). The "Not money" ×2 mute is
deferred at the counter only: dismissal works and provider-level ignore ships and is tested, but the
app does not volunteer the mute on a second dismissal (§2b.3). In both cases the triage action
itself is unaffected; only the rule it would have taught is deferred.

The "It's a transfer" pairing rule is **not** deferred. It had the same shape of problem and was
solved: the pair is expressed as matcher-identifies-one-side, action-names-the-other, with the
counterpart wallet carried on a `mark-transfer` action that the transfer detector reads.

13. A plain confirmation ("Looks right" with no field changed) creates no rule — it instead feeds the learned-suggestion signal that raises future confidence for that pattern.
14. Within the Categorizer, a matching UserRule outranks the shipped merchant map and learned suggestions — a user's correction must always stick, or the queue teaches the user that triage is pointless.
15. Rule conflicts resolve by specificity first (exact-merchant rule beats pattern rule), then recency (newest wins). The losing rule is kept but inactive for that match.
16. All UserRules are listed, disableable, and deletable under parser diagnostics in [11-settings-privacy.md](11-settings-privacy.md). Deleting a rule stops future replays but never reverts transactions it already changed.
17. Retroactive replay is always opt-in per rule, is limited to retained history, and requires preview above 10 affected transactions (see the flow above).

### Badge behavior

18. The Transactions tab badge counts **actionable** items: each low-confidence parse, suspected duplicate, and ambiguous transfer counts as 1; the unrecognized-sources section contributes 1 **per source app** with unviewed captures (per-notification counting would let one chatty unknown app flood the badge). Display caps at 99+.
19. The badge updates immediately on triage, expiry, or new arrivals. Opening the queue does not clear the badge — only resolving items does. Viewing the unrecognized section clears that section's contribution until new captures arrive.
20. No per-item push notifications, ever — the queue is a pull surface. The only notification is an optional daily digest (default on, delivered 7:00 PM local, requires POST_NOTIFICATIONS): sent only when the queue has ≥5 actionable items or any item within 7 days of expiry. Example — **illustrative only**: "6 transactions are waiting for a quick review." At most one digest per day.

### Queue hygiene (concrete expiry rules)

21. The hard ceiling is the raw-notification 30-day TTL ([../02-domain-model.md](../02-domain-model.md), invariant 3): no queue item outlives the raw text that justifies it.
22. **Low-confidence parses** expire **30 days** after arrival, untriaged → discarded without committing. The app never auto-commits an unconfirmed parse — a missing transaction is recoverable through reconciliation; a silently wrong one poisons trust in every number (risk #4). Resulting balance drift is caught by cash reconciliation prompts ([02-wallets.md](02-wallets.md)).
23. **Suspected duplicates** expire at 30 days → the held twin is discarded (the default protects against double-counted spend; the kept record is already in the ledger).
24. **Ambiguous transfers** expire at 30 days → the suggestion is dropped; both legs remain committed and unlinked, and "Link as transfer" remains available from the ledger at any time.
25. **Unknown-source captures** are purged with the raw-text TTL at 30 days; sources with recurring captures reappear with the next capture.
26. The digest surfaces expiry pressure once per item lifetime: any item entering its final 7 days is mentioned ("3 items expire this week"). Expiry itself is silent — no notification announces discarded items.
27. Expired items are gone, not archived: retaining a "dismissed" pile would recreate the guilt list this feature exists to prevent, and would conflict with the raw-text purge. (Recoverability trade-off noted in Open questions.)

## Data touched

| Entity | Access | How |
|---|---|---|
| **Transaction** | Read/write | Commits held items on confirmation (`confidence` → 1.0); bulk re-writes via retroactive replay; merge/split survivor selection; `categoryId`/`walletId` corrections. |
| **TransferLink** | Read/write | Created by "It's a transfer" and "Link as transfer"; removed by "Unlink transfer." |
| **UserRule** | Write; read | Created by every correction (rule 12 table); read during replay at the pipeline stages listed. |
| **Wallet** | Read | Wallet pickers in corrections and the unknown-provider flag flow; archived-wallet reassignment (rule 11). |
| **Category** | Read | Category picker in corrections. |
| **Limit / Goal / Bill** | Indirect | Recomputed downstream whenever a triage action commits, merges, links, or unlinks (via the ledger-commit recompute in [../03-ingest-pipeline.md](../03-ingest-pipeline.md)). |
| **Entitlements** | Read | Determines retained-history depth for retroactive replay. |

Raw captures referenced by queue items follow the storage rules in [../03-ingest-pipeline.md](../03-ingest-pipeline.md): encrypted on-device, 30-day TTL, never synced.

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

The Review Queue itself is **fully available and uncapped on Free** — it is inseparable from unlimited auto-tracking, and a gated correction surface would mean Free users keep wrong data, which is worse than no data. Tier touches the queue only at the edges:

- **History (90 days Free):** retroactive replay of a new UserRule reaches only retained history, so a Free user's "apply to similar past transactions" covers at most 90 days. Forward replay on future ingests is identical in both tiers.
- Queue items themselves live at most 30 days (hygiene rules 21–25), well inside the Free history window — no queue item is ever lost to the history gate.

Gate behavior follows the standard rule: keep data, block creation of new, never delete. Nothing in the queue creates a gated object, so no cap can be hit from here.

## Acceptance criteria

- [ ] Each of the four item types (low-confidence parse, suspected duplicate, ambiguous transfer, unknown provider) lands in the queue from its pipeline stage and renders its type-specific card.
- [ ] The primary action for every item type completes in one tap; a category, wallet, amount, or direction correction completes in two.
- [ ] Held items (low-confidence parses, held duplicate twins) are excluded from balances, Limits, reports, and Safe-to-Spend until confirmed.
- [ ] Every correcting triage creates the corresponding UserRule per the rule-12 table, and the rule demonstrably fires on the next matching ingest (excluding the two rows that table marks deferred to v2).
- [ ] A UserRule outranks the shipped merchant map when both match.
- [ ] Retroactive replay shows an accurate count, requires preview above 10 affected transactions, and rewrites exactly the previewed set.
- [ ] "Same transaction" discards the held twin and never removes a committed record; "Different" commits the twin.
- [ ] "It's a transfer" creates a Transfer Link and both legs immediately leave spend/income totals; "Unlink transfer" restores them; Limits and Safe-to-Spend recompute in both directions.
- [ ] Merge, split (within the 30-day raw TTL), link, and unlink all work from the ledger without a queue item present.
- [ ] Only money-signal notifications from unknown packages are retained with their text; a non-matching notification from an unknown package verifiably never has its text stored.
- [ ] The flag flow ("This is a money notification") commits a Transaction with `rawNotificationRef`, creates a source→Wallet UserRule, and the next capture from that source arrives pre-filled.
- [ ] The badge counts actionable items (unknown sources grouped per source app), caps at 99+, and updates only on resolution, expiry, or arrival — not on merely opening the queue.
- [ ] No per-item push notification is ever sent; the daily digest fires at most once per day and only under its trigger conditions.
- [ ] Untriaged items expire per rules 22–25 at 30 days with no auto-commit, and no raw capture survives past the 30-day TTL.
- [ ] A mute at the source level stops future captures from that source. (The two-dismissal trigger that *offers* the mute is deferred to v2 — [../09-v2-backlog.md](../09-v2-backlog.md) §2b.3 — and is not an MVP criterion.)

## Open questions

1. **Expiry destination.** Rule 27 discards expired items entirely (anti-guilt-list, pro-minimization). The alternative — a 7-day recoverable "recently expired" holding state before deletion — adds a safety net for users returning from long OEM-kill gaps at the cost of complexity and a second retention clock. Decide after beta data shows how often items actually expire untriaged.
2. **Auto-confirm ramp.** Should a pattern the user has confirmed unchanged N times (e.g., 3) start auto-committing at a lowered threshold, effectively graduating out of the queue? It shrinks triage load but softens the "conservative auto-commit" stance; needs beta accuracy data before committing.
3. **Digest tuning.** The ≥5-items-or-expiring-within-7-days trigger and 7:00 PM delivery are first guesses; tune against notification-fatigue signals (digest dismiss/disable rates) during beta.
