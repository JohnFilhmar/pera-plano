# Wallet type, removed from onboarding and derived instead

Date: 2026-08-27
Status: approved design, not yet planned

## 1. Problem

Onboarding step 7 (`app/(onboarding)/wallets.tsx`) asks the user to pick a
`WalletType` — `bank | e-wallet | cash | credit | savings` — for every wallet it
proposes. The question is bad on three counts.

It asks for a taxonomy the user does not think in. A person opening a budgeting
app knows "this is my BPI" — not whether BPI is a bank or a savings account in
our sense, and not what changes if they pick wrong.

It forces one answer where several are true. One provider app commonly fronts a
current account, a savings account and a credit card. A single enum cannot say
that, so whatever the user picks is wrong about the rest.

It asks at the worst possible moment. At onboarding the app has no transactions,
no balances and no history — the user has the least context they will ever have,
and so does the app. Every signal that would answer the question arrives later.

Meanwhile the value is real and mostly invisible to the user. `type` is not
decoration; it decides money math:

| Behaviour | Site | Rule today |
|---|---|---|
| Wallets-tab total, Safe-to-Spend | `lib/wallets/summary.ts:84` | `credit` excluded — balance is owed, not held |
| Goal attachment | `lib/db/repos/goals_repo.ts:98` | wallet must be `savings`, else `WalletNotSavingsError` |
| Cash reconcile sheet | `components/wallets/cash_reconcile_sheet.tsx:69` | `cash` only |
| Balance correction sheet | `components/wallets/balance_correction_sheet.tsx:94` | hidden for `cash` and `credit` |
| Matchers | `components/wallets/wallet_form.tsx:132` | `cash` forces zero matchers |
| Wallet picker ordering | `manual_entry_form.tsx:179`, `record_payment_sheet.tsx:76` | cash first |
| Grouping, headings, icons | `lib/wallets/summary.ts`, `wallet_type_icon.tsx` | one section per type |

So the fix is not "delete the field". It is to replace a question the user
cannot answer with facts the app can observe.

## 2. Decisions

1. The single `WalletType` label is dropped. Behaviours are derived
   independently, so a wallet is never forced into one box.
2. A wallet with no evidence is assumed to hold money the user has. Where the
   answer matters and evidence is inconclusive, the app asks one plain question
   in context — never during onboarding.
3. Classification priors and phrase rules ship in the existing remote-updatable
   ruleset; evidence is accumulated on device. Nothing about a wallet leaves the
   phone; only rules come down.
4. No type picker survives anywhere. Wallet edit states the conclusion in plain
   words with a single correction affordance.
5. The savings-only gate on goals is removed outright.

## 3. Data model

### 3.1 Two traits, one stored

**`owedBalance`** — stored, inferred. True means the balance is money owed. It
is excluded from the Wallets-tab total and from Safe-to-Spend, its row is
labelled "Owed", and the balance-correction sheet is hidden. This is the only
trait an inference mistake can make catastrophic — it flips the sign of the
first number the app states — so it is the only one with a user-facing question
and the only one that is persisted.

**`manualOnly`** — derived at read time from `matcherCount === 0`. That is
already what a cash wallet is: `wallet_form.tsx:132` forces `matchers: []` when
the user picks `cash`. It grants reconcile-sheet eligibility, cash-first
ordering in the two wallet pickers, and the "cannot be tracked automatically"
copy. A row count answers it; there is nothing to learn and nothing to store.

`countsTowardTotal` is not a trait. It is `!owedBalance && !isArchived`.

`bank`, `e-wallet` and `savings` disappear as concepts. Between them they gated
exactly one behaviour — the goals rule, which decision 5 removes — and otherwise
only chose an icon. The provider badge derived from a wallet's matcher
(`providerBadge`, real brand colour and initial) is a better icon than a generic
bank glyph, and it is already built.

### 3.2 Types

`types/domain.ts`:

- `WalletType` is deleted.
- `Wallet` loses `type`, gains `owedBalance: boolean`, `owedPinned: boolean`,
  and `matcherCount: number`.
- `NewWallet` loses `type`.

`owedPinned` records that the user settled the question — by answering the
review prompt or by correcting it in wallet edit. Inference reads a pinned
wallet but never writes it again.

`matcherCount` comes from the wallets repository as a `LEFT JOIN` count over
`wallet_matchers`, so a list screen can derive `manualOnly` without a second
query per row. Removing a wallet's last matcher makes it manual, which is
correct: nothing can route to it any more.

### 3.3 The migrations, and the runner change they need

Two migrations, not one. **013 is additive** — it adds the trait columns, the
evidence table and the new review kind, and leaves `type` in place. **014 is the
rebuild** that removes `type`, and it runs only after every reader has stopped
consulting it. Splitting them this way means the tree compiles and every test
passes at each step; a single migration would leave the app broken between the
schema change and the last screen edit.

`type` carries an inline `CHECK (type IN (...))` from `001_core.sql`, and SQLite
has no `ALTER TABLE ... DROP CONSTRAINT`, so removing it means rebuilding
`wallets`. **That rebuild cannot run the way migrations 011 and 012 did.**

Those two rebuilt `review_queue_items`, which nothing references. `wallets` is
referenced by four tables — `wallet_matchers`, `transactions`, `goals`, `loans`.
The database opens with `PRAGMA foreign_keys = ON` (`lib/db/database.ts:331`),
and the runner wraps every migration in `withTransactionAsync`
(`lib/db/migrations.ts:90`). SQLite ignores a `foreign_keys` pragma issued
inside a transaction, so `DROP TABLE wallets` would raise a foreign-key failure
on any device that already holds a wallet with a matcher or a transaction.

**Runner change.** A migration may declare that it needs foreign keys off. The
pragma is toggled *outside* the wrapping transaction — the only part that has
to be — while the migration itself keeps running inside it, so a failure still
rolls back. Migration 014 is the first to use it:

1. `PRAGMA foreign_keys = OFF` — outside the transaction, where it takes effect
2. `BEGIN` (the runner's existing `withTransactionAsync`)
3. create `wallets_new` without `type`, with the two trait columns
4. copy every row
5. `DROP TABLE wallets`, then `ALTER TABLE wallets_new RENAME TO wallets`
6. `PRAGMA foreign_key_check` — **still inside the transaction**, so a single
   returned row throws and rolls the whole rebuild back
7. `COMMIT`
8. `PRAGMA foreign_keys = ON`, in a `finally` so it is restored even on failure

Step 6 is not optional and not advisory. A rebuild that silently orphans a
transaction's `wallet_id` is worse than a migration that refuses to finish, and
running the check inside the transaction is what turns "detected" into
"prevented".

The runner change is the one genuinely dangerous part of this work: every future
migration rides on that code path. It defaults to today's behaviour, and only a
migration that explicitly asks gets the other one.

```sql
-- new wallets table: no `type`, plus the two trait columns
owed_balance INTEGER NOT NULL DEFAULT 0
owed_pinned  INTEGER NOT NULL DEFAULT 0

-- backfill during the copy: an explicit `credit` choice is the user's own
-- answer, so it pins. Every other type copies as 0, 0 — assumed held, still
-- learnable.
CASE WHEN type = 'credit' THEN 1 ELSE 0 END

CREATE TABLE wallet_trait_evidence (
  wallet_id    TEXT PRIMARY KEY NOT NULL REFERENCES wallets(id),
  owed_score   INTEGER NOT NULL DEFAULT 0,
  held_score   INTEGER NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
```

Scores are integers — weights scaled by 100 — so no float ever reaches SQLite.

The migration also extends the review-kind `CHECK` constraint with
`wallet-kind-unclear`, the twelve-step dance migrations 011 and 012 already
document — and that one stays inside the normal transaction, because nothing
references `review_queue_items`.

Existing `savings` wallets lose nothing: their goals are attached through
`goals.linked_wallet_id`, which has no type constraint at the schema level. The
gate was repo-level only.

## 4. Inference

New pure module `lib/wallets/classification.ts`. No database, no clock, no
native call — the same posture as `lib/ingest/provider_catalogue.ts`, so its
rules are testable directly.

### 4.1 Three sources of evidence

**Ruleset prior.** `ProviderRuleset` gains
`traits?: { owedBalance?: "likely" | "unlikely" }`. It ships in `seed.json` and
comes down remotely, so a provider we classify wrong is corrected without an app
release — the same promise `docs/03 §11.1` already makes for package names.

**Text evidence.** Phrase rules live in the ruleset too, not compiled into the
app: `traitSignals: [{ pattern, trait, weight }]`. "minimum amount due",
"statement balance", "credit limit" score toward owed; "available balance",
"interest earned" score toward held. They are matched against notification text
the pipeline has already parsed — no new capture, no new permission, no second
read of anything.

**Behavioural evidence.** An `out` transaction that *raises* the reported
`balanceAfter` is credit-shaped: spending increases what you owe. This is the
strongest signal available and it costs nothing to collect — migration 002
already stores `balance_after`.

### 4.2 Scoring

```ts
export type TraitEvidence = { owedScore: number; heldScore: number; sampleCount: number };
export type OwedVerdict = { owed: boolean; confident: boolean };

export function classifyOwed(
  evidence: TraitEvidence,
  prior: OwedPrior,
  tunables: WalletTraitTunables,
): OwedVerdict;
```

A verdict flips `owedBalance` only when the score margin clears a threshold
**and** `sampleCount` clears a floor. Both live in the ruleset's
`PipelineTunables`, alongside the parser's existing knobs. The hysteresis is the
point: one odd notification must not be able to move the headline number.

`owedPinned` short-circuits everything — a pinned wallet is read for display and
never rewritten.

### 4.3 Wiring

The ingest pipeline already commits a leg against a wallet. After that commit it
records the evidence delta for that wallet, recomputes the verdict, and — if the
verdict flips and the wallet is not pinned — updates the wallet and invalidates
the wallet queries. One write path, inside the transaction that already exists.

## 5. Asking, when asking is worth it

The inconclusive case goes to the existing review queue (`app/review/index.tsx`)
as a new kind, `wallet-kind-unclear` — not a bespoke card. That queue is already
the app's "system unsure, user decides" surface, and migrations 011 and 012 set
the precedent for adding kinds to it.

An item is raised only when both hold:

- evidence is inconclusive — margin below threshold with `sampleCount` at or
  above the floor, so we have looked and still cannot tell; and
- the balance is material — **≥ ₱1,000 or ≥ 5% of the Wallets-tab total,
  whichever is lower**.

Below materiality the wallet stays silently assumed-held and never asks. The
prompt is one tap: "Money you have" / "Money you owe". Either answer sets
`owedPinned = 1`. One item per wallet, ever — dismissing it pins the assumption.

## 6. Screens

Removed:

- `app/(onboarding)/wallets.tsx` — `WALLET_TYPE_BY_PROVIDER_KEY`,
  `defaultTypeFor`, `changeType`. Rows become provider badge, name, opening
  balance. The cash row becomes a wallet with no matchers.
- `components/onboarding/quick_wallet_list.tsx` — the type row and its
  segmented control.
- `components/wallets/wallet_form.tsx` — the segmented control and `TYPE_UNSET`.
  A wallet is name, opening balance, matchers. Picking no matcher makes it
  manual.

Changed:

- `components/wallets/wallet_type_icon.tsx` → `wallet_icon.tsx`, choosing from
  provider badge, manual-wallet glyph, or owed glyph.
- `lib/wallets/summary.ts` — `groupWalletsByType` becomes a split into held and
  owed. The total's credit exclusion becomes an `owedBalance` exclusion; the
  archived exclusion is untouched.
- `app/(tabs)/wallets.tsx` — one "Owed" section, everything else in one list.
- `app/wallet/[id].tsx` — `isCash` → `manualOnly`, `isCredit` → `owedBalance`,
  plus the plain-language conclusion line and its "That's not right" correction,
  which pins.
- `components/wallets/balance_correction_sheet.tsx` — hidden when
  `manualOnly || owedBalance`.
- `components/wallets/cash_reconcile_sheet.tsx` — shown when `manualOnly`.
- `components/transactions/manual_entry_form.tsx`,
  `components/loans/record_payment_sheet.tsx` — manual-first ordering.
- `lib/db/repos/goals_repo.ts` — the savings gate goes.
  `WalletNotSavingsError` becomes `LinkedWalletNotFoundError`, which checks only
  that the wallet exists: `linked_wallet_id` is a foreign key, so without that
  check a caller gets a raw SQLite constraint failure instead of an error a
  screen can branch on.
- `app/(tabs)/plan/goals/new.tsx` — the picker offers every active wallet
  except owed ones. Owed stays out because a goal is money set aside, and
  "saving toward a laptop" inside a balance that represents a debt is not
  something the progress maths can express.
- `lib/reports/csv_export.ts` — the `wallet_type` column KEEPS ITS NAME and
  starts carrying `owed` / `manual` / `tracked` (`walletKind`). Renaming it
  would break every spreadsheet already reading an export; emptying it would
  silently drop a column people sort by.
- `lib/db/mappers.ts` — maps the new columns.
- `lib/db/repos/wallets_repo.ts` — reads and writes the trait columns, and
  returns `matcherCount` from a `LEFT JOIN` count so `manualOnly` is derivable
  without a per-row query.
- `lib/db/migrations.ts` — the transaction opt-out described in §3.3.

## 7. Testing

- `lib/wallets/__tests__/classification.test.ts` — new. Scoring, threshold,
  hysteresis, pin short-circuit, and each evidence source in isolation.
- `lib/wallets/__tests__/summary.test.ts` — the owed exclusion replaces the
  credit exclusion; archived behaviour must not move.
- Migration test — the `credit` backfill pins, everything else does not, and no
  wallet loses its balance. Critically: a database seeded with matchers,
  transactions, a goal and a loan all pointing at wallets survives the rebuild
  with every reference intact, and `PRAGMA foreign_key_check` returns empty
  afterwards.
- Runner test — a migration that does not ask for the opt-out still runs inside
  a transaction and still rolls back on failure; one that does ask runs outside
  it. This is the regression that protects migrations 001–012.
- `lib/db/repos/__tests__/goals_repo.test.ts` — the three
  `WalletNotSavingsError` assertions are deleted, replaced by one asserting a
  non-savings wallet now accepts a goal.
- Review-queue suite — the new kind renders, both answers pin, dismissal pins.
- The 59 test files that construct wallets with `type:` are mechanical edits:
  drop the field, and where the test depended on credit semantics, set
  `owedBalance`.

## 8. Out of scope

- Splitting one provider account into multiple facets — a BPI current account
  and a BPI credit card still need two wallets, as today.
- Any server component. All inference is on device.
- Backfilling evidence from historical transactions at migration time. Wallets
  start from their prior and learn forward.

## 9. Assumptions

- Materiality threshold is ₱1,000 or 5% of total, whichever is lower, with an
  absolute ₱100 minimum underneath both. The minimum was added during
  implementation, when a test showed the share rule alone asking a user with a
  single ₱1 wallet about their one peso — 100% of their money, and a question
  that cannot pay for the tap it costs. Owner flagged the threshold as an
  assumption, not a decision; all three values live in one place.
- Existing `credit` wallets are treated as user-answered and pinned; every other
  existing type is treated as unanswered.
- Seed trait priors start conservative: no shipped provider is marked
  `owedBalance: "likely"` at first, because none of the thirteen is a
  credit-card app. Credit cards reach us through bank apps, so the first real
  owed verdicts will come from text and behaviour, not from a prior.
