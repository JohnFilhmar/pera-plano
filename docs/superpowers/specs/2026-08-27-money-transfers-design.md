# Money Transfers — Manual Entry and One-Sided Detection — Design Spec

**Status:** Design spec v1 · 2026-08-27 · **not an implementation plan.**

**Context:** `docs/03-ingest-pipeline.md` §7 (transfer detection), `docs/02-domain-model.md` §3.3
(TransferLink invariants), `docs/04-features/05-goals-savings.md` lines 66 and 85 (which already
promise a "manual transfer" that does not exist).

**The problem, in the owner's words:** moving money between accounts — a bank deposit, an ATM
withdrawal into cash, a wallet-to-wallet padala — has to be typed twice. Once as an expense, once as
income, then linked from a third screen. And when only one side of the movement produces a
notification, the app never asks about it at all.

**Goal:** One movement of the user's own money is entered once, and the app asks about the ones it
half-saw.

**Architecture:** One new service (`lib/transfers/transfer_service.ts`) owns every write that
creates a transfer, so the invariants live in exactly one place. The manual entry form gains a third
segment that calls it. The ingest pipeline gains a fourth transfer verdict for movements where only
one leg was captured, routed to the Review Queue whose confirm action calls the same service. A rail
fee becomes a real expense row rather than a number nothing reads.

**New dependencies:** none. **Native rebuild:** not required — no native module changes.

---

## Global Constraints

1. **One transfer writer.** After this spec, `linkTransfer` is called from `transfer_service.ts` and
   from the two pre-existing ledger-side paths (`transfer_link_actions.tsx`'s manual link and
   `resolve_actions.ts`'s `confirmAsTransfer`). No new caller may write legs and a link itself.
2. **Every multi-row transfer write is atomic.** Legs, fee row and link go inside one
   `withUnitOfWork`. A committed unpaired leg is an internal movement sitting in the user's spend
   total, which `resolve_actions.ts:404` names the single most trust-destroying row the app can show.
3. **Integer centavos only.** Fee arithmetic follows `transfer_detector.ts`'s `RATE_SCALE`
   convention; no float enters any comparison.
4. **The two legs of a manual transfer are always equal.** The fee is a separate row (§3). This is
   not a stylistic choice — equal legs are an exact-amount pair under §7 rule 3.1, so a manual
   transfer and a detected one have the same shape in the ledger.
5. **A minted leg is never silently authoritative.** When the provider's own notification for that
   leg arrives later, the provider wins (§6).
6. **No auto-commit of a guessed counterpart wallet.** One-sided detection proposes; it never links
   on its own (§5.4).

---

## 1. Domain and schema changes

### 1.1 A new Review Queue kind

`ReviewKind` (`types/domain.ts:528`) gains `"one-sided-transfer"`.

The existing four kinds mean "this row is not in your ledger yet"; `loan-match` means "the row is
committed and correct, but it may also mean something else". The new kind is the second sort: the
captured leg is a real, parseable movement, and the open question is not *whether* to record it but
*where the other half went*. Reusing `ambiguous-transfer` is wrong because that kind's payload
carries a `transferCounterpartTransactionId` — an existing ledger row the user is being asked to
confirm — and here no such row exists.

**Migration `012_one_sided_transfer_review_kind.sql`.** `kind` carries an inline
`CHECK (kind IN (...))` from `001_core.sql:202`, and SQLite cannot alter an inline CHECK. The
migration follows `011_loan_match_review_kind.sql` exactly: create the replacement table with the
widened list, copy every row, drop the original, rename, and **recreate `idx_review_queue_open`**,
which the `DROP TABLE` takes with it silently. The `raw_notification_id` foreign key is restated
verbatim.

### 1.2 The payload

```
{
  amount: Centavos,
  direction: TxDirection,        // the direction of the leg that WAS captured
  walletId: string,              // the wallet the captured leg belongs to
  counterpartWalletId: string | null,  // prefill; null when only text signalled
  signal: "text" | "rule"
}
```

`counterpartWalletId` is a **prefill, never a decision** — the card shows it selected and the user
can change it. `signal` exists so the card can word itself honestly: a rule-sourced proposal can say
"you usually move this to Savings", a text-sourced one cannot.

### 1.3 `mark-transfer` becomes a rule that can fire

`UserRuleAction` (`types/domain.ts:493`) currently has `{ kind: "mark-transfer" }` and it is dead
code. `resolve_actions.ts:415` says why in its own words: `UserRuleMatcher` has no field that can
express a wallet pair, and nothing in `lib/ingest/` reads the action, so writing one would put an
unfireable row in the user's settings.

This spec makes it fireable by giving it the missing half:

```
| { kind: "mark-transfer"; counterpartWalletId: string }
```

The matcher stays as it is — `providerKey` plus `merchantPattern` plus `direction` is enough to say
"a GCash cash-in whose counterparty reads BPI". The pair is expressed as *matcher identifies one
leg, action names the other wallet*.

**No migration.** `user_rules.action_json` (`001_core.sql:190`) is free-form JSON with no CHECK, and
`user_rules_repo.ts:75`'s whitelist already contains `"mark-transfer"`. Only the TypeScript type and
the repo's action parser change.

**Backwards compatibility:** a stored `{ kind: "mark-transfer" }` with no `counterpartWalletId`
cannot exist — the action was never written by any code path. The parser rejects one lacking the
field rather than defaulting it, because a default here would be a guess about where money went.

### 1.4 `transferIntent` on the parsed event

`ParsedEvent` (`lib/ingest/parser.ts:32`) gains `transferIntent?: boolean`.

It is computed in `parser.ts` because that is the last stage that still holds the notification's raw
text; by the time `transfer_detector.ts` runs, the text is gone and the stage is deliberately pure.
The scan is a word-boundary keyword set in the same style as the file's existing direction cues:

`cash in`, `cash-in`, `transfer`, `sent to`, `padala`, `deposit`, `withdraw`, `fund transfer`,
`instapay`, `pesonet`, `top up`, `topup`, `load to`, `add money`.

Absent or `false` means "no signal", not "not a transfer". The keyword set is a **trigger for asking**,
never for acting, so a false positive costs one dismissable card and a false negative costs nothing
that is not already the status quo.

### 1.5 No new tables, no new category

`cat_fees_charges` ("Fees & Charges") is already seeded at `categories_repo.ts:118`. The fee row of
§3 files there.

---

## 2. `lib/transfers/transfer_service.ts`

A new service module, following the shape of `lib/goals/goals_service.ts` and
`lib/bills/bills_service.ts`. It is where the transfer invariants live, and it is the only place in
the app that creates both legs of a transfer.

### 2.1 The draft

```ts
export type TransferDraft = {
  fromWalletId: string;
  toWalletId: string;
  amount: Centavos;      // what LEAVES the source wallet, fee included
  feeAmount: Centavos;   // 0 when there is none
  occurredAt: EpochMs;
  note: string | null;
};
```

`amount` is defined as **what leaves the source**, not what arrives. See §3 — this is the one
definition in the feature that, if left ambiguous, silently produces wrong balances in both wallets.

### 2.2 `recordTransfer(draft): Promise<TransferResult>`

Mints both legs. Inside one `withUnitOfWork`:

1. Validate (§2.4). Reject before any write.
2. `insertTransaction` the out leg on `fromWalletId`, amount `amount − feeAmount`, category
   `UNCATEGORIZED_ID`, `source: "manual"`, `confidence: 1`, `balanceAfter: null`.
3. `insertTransaction` the in leg on `toWalletId`, same amount, same category, same source.
4. When `feeAmount > 0`, `insertTransaction` a third `out` row on `fromWalletId` for `feeAmount`,
   category `cat_fees_charges`, note "Transfer fee", **unlinked**.
5. `linkTransfer(outLeg.id, inLeg.id, 0, { detectedBy: "manual", confidence: 1 })`.

Returns `{ outLegId, inLegId, feeTransactionId: string | null, transferLinkId }`.

The link's `feeAmount` is `0` and that is correct rather than a shortcut: the legs are equal, so
`outLeg.amount − inLeg.amount` — the field's definition at `types/domain.ts:163` — is zero. The fee
is not lost; it is a row.

### 2.3 `attachCounterpartLeg(args): Promise<TransferResult>`

The Review Queue's confirm path (§5.5), and the entry point that exists because the captured leg may
or may not already be a ledger row.

```ts
type AttachArgs =
  | { existingLegId: string; counterpartWalletId: string; feeAmount: Centavos }
  | { proposal: NewTransaction; counterpartWalletId: string; feeAmount: Centavos };
```

Inside one `withUnitOfWork`:

1. Resolve the captured leg — load it by id, or commit `proposal` via `insertTransaction`. The
   uncommitted case exists for the same reason `confirmAsTransfer` handles it: `pipeline.ts` queues
   rather than commits on every non-auto-commit route, so the leg the card is about often has no id
   yet, and committing it in a separate call would open a window in which an internal movement sits
   in the spend total.
2. Mint the counterpart on `counterpartWalletId`, opposite direction, **equal amount**, category
   `UNCATEGORIZED_ID`, `source: "manual"`, `confidence: 1`, `merchant: null`,
   `rawNotificationId: null`, `balanceAfter: null`, `occurredAt` copied from the captured leg.
3. Fee row as in §2.2 step 4, on the **source** wallet — the source is whichever side is the `out`
   leg, which is decided from the two rows and never assumed.
4. `linkTransfer(outLeg.id, inLeg.id, 0, { detectedBy: "manual", confidence: 1 })`.

The minted leg's identifying signature — `source: "manual"`, `transferLinkId` non-null,
`rawNotificationId` null — is what §6 recognises later.

### 2.4 Validation, and where it lives

Rejected with typed errors, before any row is written:

| Rule | Why |
|---|---|
| `fromWalletId !== toWalletId` | §7 rule 1; money that never left the wallet did not move between wallets. |
| Neither wallet archived | Every picker hides archived wallets; writing to one names an account the UI will not show. |
| `amount > 0` | Schema `CHECK (amount > 0)` would reject it anyway, but after two rows were already written. |
| `feeAmount >= 0` | A negative fee is a credit, which is income, not a transfer cost. |
| `feeAmount < amount` | A fee equal to the amount leaves a zero-amount leg, which the schema rejects mid-write. |
| `occurredAt <= now` | Spec rule 24 — a future-dated entry is money that has not moved counted in this period's spend. Matches `manual_entry.ts`'s existing date default reasoning. |

These are **not** re-checked in `transfer_links_repo.ts`. That file's header states its position
deliberately: rule decisions belong to the caller, and a manual link is exempt from the detector's
thresholds (domain §3.3 invariant 4). This spec does not change that.

### 2.5 What this service does not do

- It does not decide *whether* something is a transfer. That is `transfer_detector.ts` (automatic)
  or the user (manual).
- It does not touch the pipeline's `linkAutoDetected`. Converging that path onto this service is
  desirable and explicitly **out of scope** here (§8) — the detection code is shipped and working,
  and this spec should not risk it to save a duplicated `linkTransfer` call.

---

## 3. Amount semantics — the arithmetic that must be unambiguous

The user sends ₱1,000.00 from BPI to GCash and the rail charges ₱15.00. GCash shows ₱985.00
arriving.

**The user types:** Amount `1,000.00`, Fee `15.00`, From BPI, To GCash.

**The ledger gets three rows and one link:**

| Row | Wallet | Direction | Amount | Category | Linked |
|---|---|---|---|---|---|
| out leg | BPI | out | ₱985.00 | Uncategorized | yes |
| in leg | GCash | in | ₱985.00 | Uncategorized | yes |
| fee | BPI | out | ₱15.00 | Fees & Charges | **no** |

**Balances:** BPI down ₱1,000.00 (985 + 15), GCash up ₱985.00. Both match what the banks show.

**Totals:** the two legs are excluded from spend, income, Limits and reports by their
`transferLinkId` stamp (invariant I2). The ₱15.00 is not, so it counts as spend everywhere —
`sumSpend`, Safe-to-Spend, Limits, reports and CSV — with **zero changes to any aggregate**.

### 3.1 Why the fee is a row and not the link's `feeAmount`

`feeAmount` is read by nothing. Confirmed by grep across `lib/reports`, `lib/safe_to_spend.ts`,
`lib/limits` and `transactions_repo.ts`; the only mention is `transactions_repo.ts:243` saying the
field is informational only. So today a rail fee is money that provably left the wallet and appears
in no total in the app.

The two ways to fix that are to teach every aggregate to add link fees, or to make the fee an
ordinary expense. The second is smaller (no aggregate touched), more honest (the money is visible in
the ledger, where the user can tap it), and it composes with everything already built: Limits catch
a month of heavy transfer fees, reports show a Fees & Charges slice, CSV export carries it.

### 3.2 Why the legs are equal rather than 1,000 / 985

Equal legs are an **exact-amount pair** under §7 rule 3.1, the only relation eligible for
`auto_link`. A manually recorded transfer therefore has the identical ledger shape to an
auto-detected one, and the fee-tolerance arithmetic in `isFeeTolerant` — with its ₱2,500.00
crossover between the floor and the percentage arm — never has to be applied to a row a human typed.
One shape, one set of rules.

### 3.3 The detected-transfer case is unchanged

Notification-detected transfers still produce unequal legs with the delta stored as the link's
`feeAmount`, because the app is reading two providers' own numbers and must not invent a third row
from a difference it inferred. §3's fee row is created only where the user stated the fee. This
asymmetry is deliberate and is the boundary between "recorded" and "observed".

---

## 4. Manual entry — the third segment

### 4.1 The draft becomes a union

`ManualEntryDraft` (`components/transactions/manual_entry_form.tsx:56`) becomes discriminated:

```ts
export type ManualEntryDraft =
  | { kind: "entry"; amount; direction; walletId; categoryId; occurredAt; merchant; note }
  | { kind: "transfer"; amount; feeAmount; fromWalletId; toWalletId; occurredAt; note };
```

`kind` rather than widening `direction` to a third value: `TxDirection` is `"in" | "out"` and it is
the column type of every transaction row. A `"transfer"` direction would be a value that can be held
in a form and never written to the ledger, and the union makes the compiler enforce that the
transfer branch supplies `toWalletId` and the entry branch supplies `categoryId`.

### 4.2 The segment

`DIRECTION_SEGMENTS` gains `{ value: "transfer", label: "Transfer" }`. In that mode:

- **Wallet** relabels to **From**, and a **To** wallet picker appears beneath it.
- **Category** hides. A transfer is not spending; forcing a category would put an internal movement
  in a spend bucket the moment the user unlinks it.
- **Merchant** hides. There is no counterparty; both sides are the user.
- **Fee** appears, optional, defaulting to blank (which reads as `0`).
- **Note** and **Date** stay.

The To picker excludes the selected From wallet and every archived wallet. When the user has fewer
than two unarchived wallets the segment is disabled with the reason shown, rather than offered and
then refusing on submit — the same "no dead taps" convention the file's own header cites.

### 4.3 The header comment gets rewritten, not left behind

`manual_entry_form.tsx:45` currently explains at length why a third segment does **not** belong: no
transfer concept in the draft, no submit path, and a live control that silently does nothing. Every
one of those reasons is answered by this spec (§4.1 and §2.2). The comment is rewritten to say what
is now true — a comment that contradicts the code beside it is worse than no comment.

### 4.4 Submit

`app/transaction/new.tsx` branches on `draft.kind`: `"entry"` keeps its current path,
`"transfer"` calls `recordTransfer`. On success both routes behave identically (dismiss, toast,
ledger refresh) — the user recorded a movement of money either way.

### 4.5 Goals

`docs/04-features/05-goals-savings.md` (lines 66 and 85) already describes cash contributions as "a manual
transfer from the cash Wallet to the savings Wallet". Wiring the goals flow to `recordTransfer` is
**out of scope for this spec** (§8) but is the reason the service is a service.

---

## 5. One-sided detection

### 5.1 The gap


`detectTransfer` returns `{ kind: "none" }` when no committed counterpart exists inside the extended
window. That is right for an ordinary purchase and wrong for a bank→GCash cash-in whose bank half
produces no notification at all: the movement is real, half of it is now counted as income, and the
app never asks.

### 5.2 The fourth verdict

```ts
| { kind: "one_sided"; counterpartWalletId: string | null; signal: "text" | "rule" }
```

Returned **only** when `pairingsFor` finds zero pairings — a plausible pair always outranks a guess —
and at least one of:

1. `event.transferIntent === true` (§1.4), or
2. an enabled `mark-transfer` UserRule matches the event, in which case its `counterpartWalletId`
   fills the field and `signal` is `"rule"`.

When both fire, the rule wins the prefill.

`detectTransfer` stays pure. The matching rules are passed in alongside `candidates` and `tunables`,
resolved by the orchestrator the same way the tunables bundle already is.

### 5.3 Where it sits in the pipeline

`pipeline.ts:387` computes the transfer verdict, and `pipeline.ts:394` maps it to a review kind. The
new verdict maps to `"one-sided-transfer"` and the payload of §1.2. It never reaches
`linkAutoDetected` — there is no counterpart transaction id to link to.

### 5.4 Never automatic, even with a rule

A matching `mark-transfer` rule prefills the wallet; it does not create the leg. Two reasons, both
from `transfer_detector.ts`'s own header: a false link is invisible damage — the absence of two rows
from every sum, with balances that still look right — and here the counterpart row would be a row the
app **invented**, which is strictly worse than a wrong pairing between two real ones. The confirm is
one tap and it is the tap that makes the app allowed to write.

### 5.5 The card

`components/review/review_card.tsx` gains the kind. It shows the captured leg (amount, direction,
wallet, time), a **counterpart wallet picker** prefilled per §1.2, and an optional **Fee** field.

Actions:

- **Confirm** → `attachCounterpartLeg` (§2.3), then write a `mark-transfer` UserRule from the
  event's provider and counterparty with the chosen `counterpartWalletId`, `createdFrom` set to the
  review item id (invariant I15), then resolve `"confirmed"`. The rule write follows the existing
  `teachFrom` pattern in `resolve_actions.ts`.
- **Not a transfer** → commit the leg unpaired through the existing confirm path, resolve
  `"confirmed"`. Writes no rule: "this one was not" is not evidence about the next one.
- **Dismiss** → existing path, no ledger write.

New action in `lib/review/resolve_actions.ts`:
`confirmOneSidedTransfer(itemId, counterpartWalletId, feeAmount, now)`. It takes a clock, unlike
`confirmAsTransfer`, because it writes a UserRule and therefore has something to stamp.

### 5.6 The wallet picker's contents

Every unarchived wallet except the captured leg's own. Cash wallets included and deliberately so:
§7 rule 6 forbids **auto**-linking a cash leg because a cash leg has no second notification, and
this card is precisely the flow that lets the user supply it. An ATM withdrawal — bank notification,
no cash notification — is the single most common transfer this feature exists to catch.

---

## 6. The late real leg supersedes the minted one

### 6.1 The situation

The user confirms "BPI → GCash" and the app mints the BPI out leg. Two hours later BPI's own
notification for that same movement arrives. Without a rule, it is a second out leg: the wallet
debited twice, and a duplicate the user has to notice.

### 6.2 Recognising a minted leg

`source: "manual"` **and** `transferLinkId` non-null **and** `rawNotificationId` null **and** the
incoming event is within the dedupe weak-key window of it, on the same wallet, same direction, and
amount-equal within the existing weak-key tolerance.

All four conditions together. A manual leg without a link is an ordinary hand-typed entry and must
keep the duplicate-review behaviour it has today; a linked leg that already carries a
`rawNotificationId` is a provider row and cannot be superseded twice.

### 6.3 The supersede write

`TransactionPatch` (`transactions_repo.ts:208`) deliberately excludes `source`, `rawNotificationId`
and `balanceAfter` — the edit form must not be able to relabel a row's provenance. Superseding is
not an edit, so it gets its own function rather than a widened patch type:

```ts
export async function supersedeMintedLeg(id: string, provider: {
  amount: Centavos;
  occurredAt: EpochMs;
  referenceNo: string | null;
  balanceAfter: Centavos | null;
  rawNotificationId: string;
  counterparty: string | null;
}): Promise<Transaction>
```

It settles the wallet balance **reverse-then-apply**, exactly as `updateTransaction` does and for the
identical reason: the minted row already moved the balance, so writing the provider's amount without
reversing the minted one leaves a balance describing a transaction that no longer exists. The
provider's amount may legitimately differ from the minted one — the user guessed, the bank knows.

`source` flips to `"notification"`, `confidence` to the parsed confidence. **`transferLinkId` is not
touched**: the link is the same link, the pair is the same pair, and the user's confirmation is not
re-litigated by the arrival of a receipt.

### 6.4 Where the branch lives

`lib/ingest/dedupe_gate.ts`, as an outcome alongside its existing ones, so a single stage owns the
question "have I seen this movement already?". `pipeline.ts` calls `supersedeMintedLeg` instead of
`insertTransaction` on that outcome, and does not run the transfer detector for the event — the leg
is already linked.

### 6.5 When the amounts genuinely differ

If the provider's amount falls outside the weak-key tolerance, this is not a supersede: it is a
different movement that happens to be nearby, and it flows through the existing pipeline unchanged.
The minted leg stays. The user ends up with a transfer they confirmed plus a real transaction they
can inspect — visible, and fixable from the ledger.

---

## 7. Testing

Following `testing-stance`: the correctness lives in pure modules and the service, and that is where
the tests point.

**`lib/transfers/__tests__/transfer_service.test.ts`** — every §2.4 validation rejects before any
write (assert row counts unchanged); `recordTransfer` with `feeAmount: 0` writes two rows and a
link; with a fee writes three, and the fee row is unlinked and categorised `cat_fees_charges`;
balances land exactly per §3's table; a failure mid-write rolls back all rows and the balance moves;
`attachCounterpartLeg` works from both an existing leg id and an uncommitted proposal, and picks the
source wallet from the legs' directions rather than from argument order.

**`lib/ingest/__tests__/transfer_detector.test.ts`** — `one_sided` is never returned when a pairing
exists; is returned on `transferIntent` alone with `counterpartWalletId: null`; is returned on a
matching rule with the rule's wallet and `signal: "rule"`; the rule wins the prefill when both fire;
a disabled rule does not fire.

**`lib/ingest/__tests__/pipeline.test.ts`** — a one-sided event queues a `one-sided-transfer` item
with the §1.2 payload and commits nothing.

**`lib/ingest/__tests__/dedupe_gate.test.ts`** — the four-condition recognition of §6.2, including
each condition alone failing to trigger it; the out-of-tolerance case of §6.5 falls through to the
normal path.

**`lib/db/repos/__tests__/transactions_repo.test.ts`** — `supersedeMintedLeg` settles the balance
across an amount change and leaves `transferLinkId` intact.

**`lib/review/__tests__/resolve_actions.test.ts`** — `confirmOneSidedTransfer` writes the leg, the
link and the rule in one transaction, and "Not a transfer" writes no rule.

**`components/transactions/__tests__/manual_entry_form.test.tsx`** — the Transfer segment renders To
and Fee and hides Category and Merchant; the To picker excludes the From wallet and archived
wallets; the segment is disabled with fewer than two unarchived wallets.

**`lib/db/__tests__/migrations.test.ts`** — 012 applies, the widened CHECK accepts
`one-sided-transfer`, existing rows survive, and `idx_review_queue_open` exists afterwards.

---

## 8. Explicitly out of scope

- **Converging `pipeline.ts`'s `linkAutoDetected` onto `transfer_service`.** The detection path is
  shipped and working; two link-creators coexist until a follow-up retires one.
- **Wiring goals contributions to `recordTransfer`** (§4.5). Separate change, separate spec.
- **Recomputing a link's `feeAmount` when a linked leg is edited.** Pre-existing limitation, stated
  at `transactions_repo.ts:243`, unchanged by this work.
- **Balance anchor re-derivation** after a supersede. Same known limitation `updateTransaction`
  already documents; reconciliation work, not transfer work.
- **Transfers to accounts the user does not track.** Money leaving for an untracked account is an
  expense, and that is already what the app records.
- **Multi-currency.** `Wallet.currency` is `"PHP"` and this spec does not widen it.

---

## 9. Acceptance

1. A wallet-to-wallet movement, fee included, is recorded from one screen in one submit.
2. Both wallet balances match the providers' own figures afterwards.
3. The fee appears in the ledger, in spend, and in Limits.
4. Neither leg appears in spend, income or any report.
5. A cash-in whose bank half produces no notification raises exactly one Review Queue card, and
   confirming it produces a correct two-leg transfer.
6. Confirming that card once means the next identical cash-in arrives with the wallet prefilled.
7. When the bank's notification for a minted leg arrives late, the ledger still contains exactly one
   out leg, now carrying the bank's reference number, and the link is unchanged.
