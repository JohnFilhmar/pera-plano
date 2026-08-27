# Money Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a movement between the user's own accounts in one submit, and ask about the ones where only one leg produced a notification.

**Architecture:** A new service (`lib/transfers/transfer_service.ts`) owns every write that creates a transfer — both legs, an optional fee row, and the link — inside one unit of work. The manual entry form gains a Transfer segment that calls it. The ingest pipeline gains a `one_sided` transfer verdict routed to a new Review Queue kind whose confirm calls the same service and teaches a `mark-transfer` rule. When the provider's own notification for a minted leg arrives late, the dedupe gate recognises it and the provider's row supersedes the placeholder.

**Tech Stack:** Expo SDK 54 / React Native, TypeScript (strict), SQLite via `@op-engineering/op-sqlite` (sql.js under Jest), Jest + jest-expo, NativeWind, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-08-27-money-transfers-design.md`

## Global Constraints

- **One transfer writer.** New code creating both legs of a transfer goes through `lib/transfers/transfer_service.ts`. Do not add a fourth caller of `linkTransfer`.
- **Every multi-row transfer write is atomic** — inside `withUnitOfWork` from `lib/db/unit_of_work.ts`.
- **Integer centavos only.** No float enters any money comparison.
- **The two legs of a manual transfer are always equal.** The fee is a separate unlinked expense row.
- **A minted leg is never silently authoritative.** The provider's later notification wins.
- **No auto-commit of a guessed counterpart wallet.** One-sided detection proposes; the user confirms.
- **Do not touch `pipeline.ts`'s `linkAutoDetected`.** Converging it is out of scope.
- **Never edit migrations 001–011.** Add `012`.
- **Naming:** files `snake_case`; domain fields stay `camelCase` to match `types/domain.ts`; React components `PascalCase`.
- **Test command:** `cd mobile && npx jest <path> -t "<name>"`. Typecheck: `cd mobile && npm run typecheck`.
- **Commits:** no AI attribution trailer or footer of any kind.

## File Structure

**Create**
- `mobile/lib/db/migrations/012_one_sided_transfer_review_kind.sql` — widen the `review_queue_items.kind` CHECK.
- `mobile/lib/transfers/transfer_service.ts` — the only writer of new transfers.
- `mobile/lib/transfers/__tests__/transfer_service.test.ts`
- `mobile/lib/ingest/rule_matcher.ts` — `matcherApplies`, extracted from `categorizer.ts` so the detector can use it too.
- `mobile/components/review/one_sided_transfer_body.tsx` — the card body: wallet picker + fee.

**Modify**
- `mobile/types/domain.ts` — `ReviewKind`, `UserRuleAction`.
- `mobile/lib/db/migrations.ts` — register migration 12.
- `mobile/lib/db/repos/user_rules_repo.ts` — validate the widened action.
- `mobile/lib/db/repos/transactions_repo.ts` — `supersedeMintedLeg`.
- `mobile/lib/ingest/parser.ts` — `transferIntent`.
- `mobile/lib/ingest/categorizer.ts` — import the extracted matcher.
- `mobile/lib/ingest/transfer_detector.ts` — the `one_sided` verdict.
- `mobile/lib/ingest/confidence_gate.ts` — hard route + reason copy.
- `mobile/lib/ingest/dedupe_gate.ts` — `mintedTransferLeg`, `supersedes`.
- `mobile/lib/ingest/pipeline.ts` — wire both new outcomes.
- `mobile/lib/review/resolve_actions.ts` — `confirmOneSidedTransfer`.
- `mobile/hooks/mutations/use_review_action.ts` — the new action.
- `mobile/components/review/review_card.tsx` — render the new body.
- `mobile/app/review/index.tsx` — primary/secondary/reject wiring.
- `mobile/components/transactions/manual_entry_form.tsx` — the Transfer segment.
- `mobile/app/transaction/new.tsx` — submit branch.

---

### Task 1: Migration 012 — the Review Queue learns `one-sided-transfer`

**Files:**
- Create: `mobile/lib/db/migrations/012_one_sided_transfer_review_kind.sql`
- Modify: `mobile/lib/db/migrations.ts:11-12` (imports), `mobile/lib/db/migrations.ts:42-58` (`MIGRATIONS`)
- Modify: `mobile/types/domain.ts:528-533` (`ReviewKind`)
- Test: `mobile/lib/db/__tests__/migrations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ReviewKind` includes `"one-sided-transfer"`; the DB accepts it.

- [ ] **Step 1: Write the failing test**

Append to `mobile/lib/db/__tests__/migrations.test.ts`:

```ts
test("migration 012 lets the queue hold a one-sided-transfer item", async () => {
  const db = await freshDb();

  await db.runAsync(
    `INSERT INTO review_queue_items (id, kind, payload_json, raw_notification_id, created_at)
     VALUES ('rq_one_sided', 'one-sided-transfer', '{}', NULL, 1)`,
  );

  const rows = await db.getAllAsync<{ kind: string }>(
    "SELECT kind FROM review_queue_items WHERE id = 'rq_one_sided'",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.kind).toBe("one-sided-transfer");
});

test("migration 012 keeps the open-queue index", async () => {
  const db = await freshDb();

  const indexes = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'review_queue_items'",
  );

  expect(indexes.map((row) => row.name)).toContain("idx_review_queue_open");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest lib/db/__tests__/migrations.test.ts -t "one-sided-transfer"`
Expected: FAIL — the CHECK constraint rejects the insert.

- [ ] **Step 3: Write the migration**

Create `mobile/lib/db/migrations/012_one_sided_transfer_review_kind.sql`:

```sql
-- 012_one_sided_transfer_review_kind.sql — the Review Queue learns about
-- transfers it only saw half of.
--
-- WHY A NEW KIND AND NOT `ambiguous-transfer`. That kind's payload carries a
-- `transferCounterpartTransactionId` — an existing ledger row the user is being
-- asked to confirm — and `resolve_actions.ts`'s `confirmAsTransfer` reads it and
-- links to it. A one-sided item has no such row: the whole point is that the
-- other leg produced no notification and does not exist yet. Reusing the kind
-- would hand that action a payload with nothing to link to.
--
-- WHY A REBUILD AND NOT AN `ALTER TABLE`. `kind` carries an inline
-- `CHECK (kind IN (...))` from 001_core.sql and SQLite has no
-- `ALTER TABLE ... DROP/ADD CONSTRAINT`. Same twelve-step dance as
-- 011_loan_match_review_kind.sql, and the same two things that must survive it:
--
--   THE INDEX. `DROP TABLE` takes `idx_review_queue_open` with it silently, and
--   `countOpen` runs every 30 seconds behind the tab badge. Recreated below.
--
--   THE FOREIGN KEY. `raw_notification_id REFERENCES raw_notifications(id)` is
--   restated verbatim so the Privacy Centre's raw-capture lifecycle keeps the
--   guarantee it had before this file ran.
--
-- Never edit 001-011 — add a new numbered migration instead.
CREATE TABLE review_queue_items_new (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('low-confidence', 'unknown-provider', 'ambiguous-transfer', 'possible-duplicate', 'loan-match', 'one-sided-transfer')),
  payload_json TEXT NOT NULL,
  raw_notification_id TEXT REFERENCES raw_notifications(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  resolved_at INTEGER
);

INSERT INTO review_queue_items_new (
  id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at
)
SELECT id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at
  FROM review_queue_items;

DROP TABLE review_queue_items;

ALTER TABLE review_queue_items_new RENAME TO review_queue_items;

CREATE INDEX idx_review_queue_open ON review_queue_items(resolved_at);
```

- [ ] **Step 4: Register it**

In `mobile/lib/db/migrations.ts`, after the `011` import:

```ts
import oneSidedTransferReviewKindSql from "./migrations/012_one_sided_transfer_review_kind.sql";
```

and at the end of the `MIGRATIONS` array:

```ts
  { version: 12, name: "one_sided_transfer_review_kind", sql: oneSidedTransferReviewKindSql },
```

- [ ] **Step 5: Widen the domain type**

In `mobile/types/domain.ts`, add the member to `ReviewKind`:

```ts
export type ReviewKind =
  | "low-confidence"
  | "unknown-provider"
  | "ambiguous-transfer"
  | "possible-duplicate"
  | "loan-match"
  /**
   * One leg of an internal transfer arrived and the other never will, because
   * the account it came from or went to does not post notifications. The
   * counterpart transaction does not exist yet — confirming this item MINTS it.
   * Distinct from `ambiguous-transfer`, whose payload names a committed row.
   */
  | "one-sided-transfer";
```

- [ ] **Step 6: Run the tests**

Run: `cd mobile && npx jest lib/db/__tests__/migrations.test.ts`
Expected: PASS, including the pre-existing migration tests.

Jest cache gotcha: `babel-plugin-inline-import` inlines `*.sql` contents at transform time. If the new SQL does not appear to load, run with `--clearCache`.

- [ ] **Step 7: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/db/migrations/012_one_sided_transfer_review_kind.sql mobile/lib/db/migrations.ts mobile/types/domain.ts mobile/lib/db/__tests__/migrations.test.ts
git commit -m "feat(db): add the one-sided-transfer review kind"
```

---

### Task 2: `transfer_service.recordTransfer`

**Files:**
- Create: `mobile/lib/transfers/transfer_service.ts`
- Create: `mobile/lib/transfers/__tests__/transfer_service.test.ts`

**Interfaces:**
- Consumes: `withUnitOfWork` (`lib/db/unit_of_work.ts`), `insertTransaction` (`lib/db/repos/transactions_repo.ts`), `linkTransfer` (`lib/db/repos/transfer_links_repo.ts`), `getWallet` (`lib/db/repos/wallets_repo.ts`), `UNCATEGORIZED_ID` and `FEES_CATEGORY_ID` (see Step 3).
- Produces:
  - `type TransferDraft = { fromWalletId: string; toWalletId: string; amount: Centavos; feeAmount: Centavos; occurredAt: EpochMs; note: string | null }`
  - `type TransferResult = { outLegId: string; inLegId: string; feeTransactionId: string | null; transferLinkId: string }`
  - `class TransferValidationError extends Error { readonly reason: TransferValidationReason }`
  - `type TransferValidationReason = "same_wallet" | "unknown_wallet" | "unknown_leg" | "archived_wallet" | "amount_not_positive" | "fee_negative" | "fee_exceeds_amount" | "future_dated"`
  - `async function recordTransfer(draft: TransferDraft, now: EpochMs): Promise<TransferResult>`

- [ ] **Step 1: Write the failing tests**

Create `mobile/lib/transfers/__tests__/transfer_service.test.ts`:

```ts
import { closeDatabase } from "@/lib/db/database";
import { freshDb } from "@/test_support/db";
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import { getTransferLink } from "@/lib/db/repos/transfer_links_repo";
import { recordTransfer, TransferValidationError } from "@/lib/transfers/transfer_service";
import type { SQLiteDatabase } from "@/lib/db/database";

const NOW = 1_786_000_000_000;
const HOUR = 60 * 60 * 1000;

let db: SQLiteDatabase;
let bpi: string;
let gcash: string;

async function seedCategory(id: string, name: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, ?, NULL, 'circle-help', 1, 0, 0, 0)`,
    [id, name],
  );
}

beforeEach(async () => {
  db = await freshDb();
  await seedCategory("cat_uncategorized", "Uncategorized");
  await seedCategory("cat_fees_charges", "Fees & Charges");
  bpi = (await createWallet({ name: "BPI", type: "bank", openingBalance: 500_000 })).id;
  gcash = (await createWallet({ name: "GCash", type: "e-wallet", openingBalance: 0 })).id;
});

afterEach(async () => {
  await closeDatabase();
});

test("a fee-free transfer writes two equal legs and one link", async () => {
  const result = await recordTransfer(
    {
      fromWalletId: bpi,
      toWalletId: gcash,
      amount: 100_000,
      feeAmount: 0,
      occurredAt: NOW - HOUR,
      note: null,
    },
    NOW,
  );

  const rows = await listTransactions({});
  expect(rows).toHaveLength(2);
  expect(result.feeTransactionId).toBeNull();

  const out = rows.find((row) => row.id === result.outLegId);
  const incoming = rows.find((row) => row.id === result.inLegId);
  expect(out?.walletId).toBe(bpi);
  expect(out?.direction).toBe("out");
  expect(out?.amount).toBe(100_000);
  expect(incoming?.walletId).toBe(gcash);
  expect(incoming?.direction).toBe("in");
  expect(incoming?.amount).toBe(100_000);
  expect(out?.transferLinkId).toBe(result.transferLinkId);
  expect(incoming?.transferLinkId).toBe(result.transferLinkId);

  const link = await getTransferLink(result.transferLinkId);
  expect(link?.feeAmount).toBe(0);
  expect(link?.detectedBy).toBe("manual");
});

test("a fee becomes its own unlinked expense on the source wallet", async () => {
  const result = await recordTransfer(
    {
      fromWalletId: bpi,
      toWalletId: gcash,
      amount: 100_000,
      feeAmount: 1_500,
      occurredAt: NOW - HOUR,
      note: null,
    },
    NOW,
  );

  const rows = await listTransactions({});
  expect(rows).toHaveLength(3);

  const fee = rows.find((row) => row.id === result.feeTransactionId);
  expect(fee?.walletId).toBe(bpi);
  expect(fee?.direction).toBe("out");
  expect(fee?.amount).toBe(1_500);
  expect(fee?.categoryId).toBe("cat_fees_charges");
  expect(fee?.transferLinkId).toBeNull();

  // The legs are EQUAL and both are net of the fee.
  const out = rows.find((row) => row.id === result.outLegId);
  const incoming = rows.find((row) => row.id === result.inLegId);
  expect(out?.amount).toBe(98_500);
  expect(incoming?.amount).toBe(98_500);
});

test("balances match the providers' own figures", async () => {
  await recordTransfer(
    {
      fromWalletId: bpi,
      toWalletId: gcash,
      amount: 100_000,
      feeAmount: 1_500,
      occurredAt: NOW - HOUR,
      note: null,
    },
    NOW,
  );

  expect((await getWallet(bpi))?.balance).toBe(400_000);
  expect((await getWallet(gcash))?.balance).toBe(98_500);
});

test.each([
  ["same_wallet", { fromWalletId: "SAME", toWalletId: "SAME" }],
  ["amount_not_positive", { amount: 0 }],
  ["fee_negative", { feeAmount: -1 }],
  ["fee_exceeds_amount", { feeAmount: 100_000 }],
  ["future_dated", { occurredAt: NOW + HOUR }],
])("rejects %s before writing anything", async (reason, override) => {
  const draft = {
    fromWalletId: bpi,
    toWalletId: gcash,
    amount: 100_000,
    feeAmount: 0,
    occurredAt: NOW - HOUR,
    note: null,
    ...override,
  };
  if (draft.fromWalletId === "SAME") {
    draft.fromWalletId = bpi;
    draft.toWalletId = bpi;
  }

  await expect(recordTransfer(draft, NOW)).rejects.toBeInstanceOf(TransferValidationError);
  await expect(recordTransfer(draft, NOW)).rejects.toMatchObject({ reason });
  expect(await listTransactions({})).toHaveLength(0);
  expect((await getWallet(bpi))?.balance).toBe(500_000);
});

test("rejects an archived wallet", async () => {
  await db.runAsync("UPDATE wallets SET is_archived = 1 WHERE id = ?", [gcash]);

  await expect(
    recordTransfer(
      {
        fromWalletId: bpi,
        toWalletId: gcash,
        amount: 100_000,
        feeAmount: 0,
        occurredAt: NOW - HOUR,
        note: null,
      },
      NOW,
    ),
  ).rejects.toMatchObject({ reason: "archived_wallet" });

  expect(await listTransactions({})).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest lib/transfers/__tests__/transfer_service.test.ts`
Expected: FAIL — `Cannot find module '@/lib/transfers/transfer_service'`.

- [ ] **Step 3: Write the implementation**

Create `mobile/lib/transfers/transfer_service.ts`:

```ts
// lib/transfers/transfer_service.ts — the only place in the app that creates
// both legs of a transfer.
//
// WHY A SERVICE AND NOT A FORM HANDLER. Three callers need this write: the
// manual entry form, the Review Queue's one-sided confirm, and (later) goal
// contributions. Each one writes two or three ledger rows plus a link, and a
// partial success is a committed leg with no counterpart — an internal movement
// sitting in the user's spend total, which resolve_actions.ts:404 names the
// single most trust-destroying row this app can show. One writer, one set of
// invariants, one place the tests point at.
//
// THE FEE IS A ROW, NOT A FIELD. TransferLink.feeAmount is read by nothing —
// not reports, not Safe-to-Spend, not Limits (transactions_repo.ts:243 says so
// outright), so a fee recorded there is money that provably left the wallet and
// appears in no total. Recorded as an ordinary expense in Fees & Charges it
// counts everywhere, with no aggregate changed, and the user can tap it.
//
// THE LEGS ARE EQUAL because equal legs are an exact-amount pair under
// docs/03-ingest-pipeline.md §7 rule 3.1 — the same shape an auto-detected
// transfer has. A hand-typed transfer therefore never has to be run past the
// detector's fee-tolerance arithmetic.
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { getWallet } from "@/lib/db/repos/wallets_repo";
import { withUnitOfWork } from "@/lib/db/unit_of_work";

import type { Centavos, EpochMs } from "@/types/domain";

/** The seeded Fees & Charges category (categories_repo.ts). */
export const FEES_CATEGORY_ID = "cat_fees_charges";

export type TransferValidationReason =
  | "same_wallet"
  | "unknown_wallet"
  /** The captured leg named by `existingLegId` is not in the ledger. */
  | "unknown_leg"
  | "archived_wallet"
  | "amount_not_positive"
  | "fee_negative"
  | "fee_exceeds_amount"
  | "future_dated";

/**
 * Thrown BEFORE any row is written. Carries a machine-readable `reason` so the
 * form can say which field is wrong without parsing a message.
 */
export class TransferValidationError extends Error {
  readonly reason: TransferValidationReason;

  constructor(reason: TransferValidationReason) {
    super(`transfer rejected: ${reason}`);
    this.name = "TransferValidationError";
    this.reason = reason;
  }
}

export type TransferDraft = {
  fromWalletId: string;
  toWalletId: string;
  /** What LEAVES the source wallet, fee included. */
  amount: Centavos;
  /** 0 when there is none. Subtracted from `amount` to give both legs. */
  feeAmount: Centavos;
  occurredAt: EpochMs;
  note: string | null;
};

export type TransferResult = {
  outLegId: string;
  inLegId: string;
  feeTransactionId: string | null;
  transferLinkId: string;
};

/**
 * Every rule the ledger cannot express and the schema would only catch halfway
 * through a multi-row write.
 *
 * `occurredAt <= now` is spec rule 24: a future-dated entry is money that has
 * not moved counted in this period's spend. `feeAmount < amount` is not
 * pedantry — an equal fee leaves a zero-amount leg, which the schema's
 * `CHECK (amount > 0)` rejects after two rows already exist.
 */
async function validate(draft: TransferDraft, now: EpochMs): Promise<void> {
  if (draft.fromWalletId === draft.toWalletId) {
    throw new TransferValidationError("same_wallet");
  }
  if (draft.amount <= 0) throw new TransferValidationError("amount_not_positive");
  if (draft.feeAmount < 0) throw new TransferValidationError("fee_negative");
  if (draft.feeAmount >= draft.amount) throw new TransferValidationError("fee_exceeds_amount");
  if (draft.occurredAt > now) throw new TransferValidationError("future_dated");

  const [from, to] = await Promise.all([
    getWallet(draft.fromWalletId),
    getWallet(draft.toWalletId),
  ]);
  if (from === null || to === null) throw new TransferValidationError("unknown_wallet");
  if (from.isArchived || to.isArchived) throw new TransferValidationError("archived_wallet");
}

/**
 * Records a movement between two of the user's own wallets.
 *
 * `now` is a parameter rather than a clock read so the future-date rule is
 * reproducible in a test, matching lib/transactions/manual_entry.ts's stance.
 */
export async function recordTransfer(
  draft: TransferDraft,
  now: EpochMs,
): Promise<TransferResult> {
  await validate(draft, now);

  const legAmount = draft.amount - draft.feeAmount;

  return withUnitOfWork(async () => {
    const outLeg = await insertTransaction({
      walletId: draft.fromWalletId,
      categoryId: UNCATEGORIZED_ID,
      amount: legAmount,
      direction: "out",
      occurredAt: draft.occurredAt,
      source: "manual",
      confidence: 1,
      note: draft.note,
    });

    const inLeg = await insertTransaction({
      walletId: draft.toWalletId,
      categoryId: UNCATEGORIZED_ID,
      amount: legAmount,
      direction: "in",
      occurredAt: draft.occurredAt,
      source: "manual",
      confidence: 1,
      note: draft.note,
    });

    // Unlinked, deliberately: the fee is a real cost and must keep counting.
    const fee =
      draft.feeAmount > 0
        ? await insertTransaction({
            walletId: draft.fromWalletId,
            categoryId: FEES_CATEGORY_ID,
            amount: draft.feeAmount,
            direction: "out",
            occurredAt: draft.occurredAt,
            source: "manual",
            confidence: 1,
            note: "Transfer fee",
          })
        : null;

    // 0, and that is the field's own definition (types/domain.ts:163):
    // outLeg.amount − inLeg.amount, and the legs are equal.
    const link = await linkTransfer(outLeg.id, inLeg.id, 0, {
      detectedBy: "manual",
      confidence: 1,
    });

    return {
      outLegId: outLeg.id,
      inLegId: inLeg.id,
      feeTransactionId: fee?.id ?? null,
      transferLinkId: link.id,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest lib/transfers/__tests__/transfer_service.test.ts`
Expected: PASS (6 test cases including the 5 parameterised rejections).

If `getWallet` is not exported from `wallets_repo.ts` under that name, check its exports and use the single-wallet reader it does export; do not add a new one.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/transfers
git commit -m "feat(transfers): add recordTransfer, the single writer for manual transfers"
```

---

### Task 3: `transfer_service.attachCounterpartLeg`

**Files:**
- Modify: `mobile/lib/transfers/transfer_service.ts`
- Test: `mobile/lib/transfers/__tests__/transfer_service.test.ts`

**Interfaces:**
- Consumes: Task 2's module internals; `getTransaction` (`lib/db/repos/transactions_repo.ts`).
- Produces: `async function attachCounterpartLeg(args: AttachArgs, now: EpochMs): Promise<TransferResult>` where

```ts
export type AttachArgs = {
  captured: { existingLegId: string } | { proposal: NewTransaction };
  counterpartWalletId: string;
  feeAmount: Centavos;
};
```

- [ ] **Step 1: Write the failing tests**

Append to `mobile/lib/transfers/__tests__/transfer_service.test.ts` (add `attachCounterpartLeg` to the existing import from the service, and `insertTransaction` to the repo import):

```ts
test("attaches a minted counterpart to a committed leg", async () => {
  const captured = await insertTransaction({
    walletId: gcash,
    categoryId: "cat_uncategorized",
    amount: 100_000,
    direction: "in",
    occurredAt: NOW - HOUR,
    source: "notification",
    confidence: 0.95,
  });

  const result = await attachCounterpartLeg(
    { captured: { existingLegId: captured.id }, counterpartWalletId: bpi, feeAmount: 0 },
    NOW,
  );

  expect(result.inLegId).toBe(captured.id);

  const rows = await listTransactions({});
  expect(rows).toHaveLength(2);

  const minted = rows.find((row) => row.id === result.outLegId);
  expect(minted?.walletId).toBe(bpi);
  expect(minted?.direction).toBe("out");
  expect(minted?.amount).toBe(100_000);
  expect(minted?.source).toBe("manual");
  expect(minted?.rawNotificationId).toBeNull();
  expect(minted?.occurredAt).toBe(captured.occurredAt);
  expect(minted?.transferLinkId).toBe(result.transferLinkId);
});

test("commits an uncommitted proposal and links it in one write", async () => {
  const result = await attachCounterpartLeg(
    {
      captured: {
        proposal: {
          walletId: bpi,
          categoryId: "cat_uncategorized",
          amount: 100_000,
          direction: "out",
          occurredAt: NOW - HOUR,
          source: "notification",
          confidence: 0.9,
        },
      },
      counterpartWalletId: gcash,
      feeAmount: 0,
    },
    NOW,
  );

  const rows = await listTransactions({});
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.transferLinkId === result.transferLinkId)).toBe(true);
});

test("puts the fee on the source wallet, whichever leg was captured", async () => {
  // The CAPTURED leg is the incoming one, so the source is the minted side.
  const captured = await insertTransaction({
    walletId: gcash,
    categoryId: "cat_uncategorized",
    amount: 98_500,
    direction: "in",
    occurredAt: NOW - HOUR,
    source: "notification",
    confidence: 0.95,
  });

  const result = await attachCounterpartLeg(
    { captured: { existingLegId: captured.id }, counterpartWalletId: bpi, feeAmount: 1_500 },
    NOW,
  );

  const rows = await listTransactions({});
  const fee = rows.find((row) => row.id === result.feeTransactionId);
  expect(fee?.walletId).toBe(bpi);
  expect(fee?.amount).toBe(1_500);
  expect(fee?.categoryId).toBe("cat_fees_charges");
  expect(fee?.transferLinkId).toBeNull();

  // The legs stay EQUAL — the captured amount is the provider's own figure and
  // is never rewritten.
  expect(rows.find((row) => row.id === result.outLegId)?.amount).toBe(98_500);
  expect(rows.find((row) => row.id === result.inLegId)?.amount).toBe(98_500);
});

test("refuses to attach a leg to its own wallet", async () => {
  const captured = await insertTransaction({
    walletId: gcash,
    categoryId: "cat_uncategorized",
    amount: 100_000,
    direction: "in",
    occurredAt: NOW - HOUR,
    source: "notification",
    confidence: 0.95,
  });

  await expect(
    attachCounterpartLeg(
      { captured: { existingLegId: captured.id }, counterpartWalletId: gcash, feeAmount: 0 },
      NOW,
    ),
  ).rejects.toMatchObject({ reason: "same_wallet" });

  expect(await listTransactions({})).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest lib/transfers/__tests__/transfer_service.test.ts -t "attach"`
Expected: FAIL — `attachCounterpartLeg is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `mobile/lib/transfers/transfer_service.ts` (and add `getTransaction` to the `transactions_repo` import, `NewTransaction` and `Transaction` to the domain type import):

```ts
export type AttachArgs = {
  /**
   * The leg that WAS captured. Either already in the ledger (the user is
   * confirming from a committed row) or still a proposal, because pipeline.ts
   * queues rather than commits on every non-auto-commit route — so the leg the
   * Review Queue card is about usually has no id yet.
   */
  captured: { existingLegId: string } | { proposal: NewTransaction };
  counterpartWalletId: string;
  feeAmount: Centavos;
};

/** The captured leg, committed first if it was still only a proposal. */
async function resolveCapturedLeg(captured: AttachArgs["captured"]): Promise<Transaction> {
  if (!("existingLegId" in captured)) {
    return insertTransaction(captured.proposal);
  }

  const row = await getTransaction(captured.existingLegId);
  if (row === null) throw new TransferValidationError("unknown_leg");
  return row;
}

/**
 * Mints the missing half of a transfer only one side of which was ever seen,
 * and links the pair — all inside one transaction.
 *
 * COMMITTING THE PROPOSAL SEPARATELY IS NOT AN OPTION. Between the commit and
 * the link there would be a window in which an internal movement counts as real
 * spend or real income; `confirmAsTransfer` handles the same case the same way
 * and for the same reason.
 *
 * The minted leg's signature — `source: "manual"`, a `transferLinkId`, and no
 * `rawNotificationId` — is what dedupe_gate.ts later recognises when the
 * provider's own notification for it finally arrives.
 */
export async function attachCounterpartLeg(
  args: AttachArgs,
  now: EpochMs,
): Promise<TransferResult> {
  if (args.feeAmount < 0) throw new TransferValidationError("fee_negative");

  const counterpartWallet = await getWallet(args.counterpartWalletId);
  if (counterpartWallet === null) throw new TransferValidationError("unknown_wallet");
  if (counterpartWallet.isArchived) throw new TransferValidationError("archived_wallet");

  return withUnitOfWork(async () => {
    const captured: Transaction = await resolveCapturedLeg(args.captured);

    if (captured.walletId === args.counterpartWalletId) {
      throw new TransferValidationError("same_wallet");
    }
    if (captured.occurredAt > now) throw new TransferValidationError("future_dated");
    if (args.feeAmount >= captured.amount) {
      throw new TransferValidationError("fee_exceeds_amount");
    }

    const minted = await insertTransaction({
      walletId: args.counterpartWalletId,
      categoryId: UNCATEGORIZED_ID,
      // EQUAL to the captured leg. The provider's figure is the one fact here
      // that was measured rather than stated, so it is never rewritten.
      amount: captured.amount,
      direction: captured.direction === "out" ? "in" : "out",
      occurredAt: captured.occurredAt,
      source: "manual",
      confidence: 1,
    });

    // Which side is the source comes from the two rows, never from argument
    // order: the captured leg may be either half of the pair.
    const [outLeg, inLeg] =
      captured.direction === "out" ? [captured, minted] : [minted, captured];

    const fee =
      args.feeAmount > 0
        ? await insertTransaction({
            walletId: outLeg.walletId,
            categoryId: FEES_CATEGORY_ID,
            amount: args.feeAmount,
            direction: "out",
            occurredAt: captured.occurredAt,
            source: "manual",
            confidence: 1,
            note: "Transfer fee",
          })
        : null;

    const link = await linkTransfer(outLeg.id, inLeg.id, 0, {
      detectedBy: "manual",
      confidence: 1,
    });

    return {
      outLegId: outLeg.id,
      inLegId: inLeg.id,
      feeTransactionId: fee?.id ?? null,
      transferLinkId: link.id,
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest lib/transfers/__tests__/transfer_service.test.ts`
Expected: PASS, all cases from Tasks 2 and 3.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/transfers
git commit -m "feat(transfers): mint the missing leg of a one-sided transfer"
```

---

### Task 4: The Transfer segment in the manual entry form

**Files:**
- Modify: `mobile/components/transactions/manual_entry_form.tsx:41-66` (header comment, `DIRECTION_SEGMENTS`, `ManualEntryDraft`) and its form body
- Test: `mobile/components/transactions/__tests__/manual_entry_form.test.tsx`

**Interfaces:**
- Consumes: `TransferDraft` field names from Task 2.
- Produces:

```ts
export type ManualEntryDraft =
  | { kind: "entry"; amount: Centavos; direction: TxDirection; walletId: string;
      categoryId: string; occurredAt: EpochMs; merchant: string | null; note: string | null }
  | { kind: "transfer"; amount: Centavos; feeAmount: Centavos; fromWalletId: string;
      toWalletId: string; occurredAt: EpochMs; note: string | null };
```

- [ ] **Step 1: Write the failing tests**

Append to `mobile/components/transactions/__tests__/manual_entry_form.test.tsx`, following the file's existing render helper and testID conventions:

```ts
test("the Transfer segment swaps Category for a To wallet and a Fee", () => {
  const view = renderForm({ wallets: [cashWallet, bankWallet], categories });

  fireEvent.press(view.getByTestId("manual-entry-segment-transfer"));

  expect(view.queryByTestId("manual-entry-to-wallet")).not.toBeNull();
  expect(view.queryByTestId("manual-entry-fee")).not.toBeNull();
  expect(view.queryByTestId("manual-entry-category")).toBeNull();
  expect(view.queryByTestId("manual-entry-merchant")).toBeNull();
});

test("the To picker excludes the From wallet and archived wallets", () => {
  const archived = { ...bankWallet, id: "w_archived", name: "Old BPI", isArchived: true };
  const view = renderForm({ wallets: [cashWallet, bankWallet, archived], categories });

  fireEvent.press(view.getByTestId("manual-entry-segment-transfer"));

  expect(view.queryByTestId(`manual-entry-to-wallet-${cashWallet.id}`)).toBeNull();
  expect(view.queryByTestId(`manual-entry-to-wallet-${bankWallet.id}`)).not.toBeNull();
  expect(view.queryByTestId("manual-entry-to-wallet-w_archived")).toBeNull();
});

test("the Transfer segment is disabled with fewer than two unarchived wallets", () => {
  const view = renderForm({ wallets: [cashWallet], categories });

  const segment = view.getByTestId("manual-entry-segment-transfer");
  expect(segment.props.accessibilityState?.disabled).toBe(true);
});

test("submitting a transfer emits a transfer draft", () => {
  const onSubmit = jest.fn();
  const view = renderForm({ wallets: [cashWallet, bankWallet], categories, onSubmit });

  fireEvent.press(view.getByTestId("manual-entry-segment-transfer"));
  enterAmount(view, "1000.00");
  fireEvent.press(view.getByTestId(`manual-entry-to-wallet-${bankWallet.id}`));
  enterFee(view, "15.00");
  fireEvent.press(view.getByTestId("manual-entry-submit"));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: "transfer",
      amount: 100_000,
      feeAmount: 1_500,
      fromWalletId: cashWallet.id,
      toWalletId: bankWallet.id,
    }),
  );
});
```

Add `enterAmount` / `enterFee` helpers mirroring however the existing tests drive the keypad (`test_support/keypad.ts`). Do not invent a new input mechanism — reuse the file's existing one.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest components/transactions/__tests__/manual_entry_form.test.tsx -t "Transfer segment"`
Expected: FAIL — no element with testID `manual-entry-segment-transfer`.

- [ ] **Step 3: Widen the draft type**

In `manual_entry_form.tsx`, replace `ManualEntryDraft` with the union from **Interfaces** above.

`kind`, not a third `direction` value: `TxDirection` is the ledger's column type, and a `"transfer"` direction would be a value that can be held in a form and never written to a row. The union also makes the compiler enforce that the transfer branch supplies `toWalletId` and the entry branch supplies `categoryId`.

- [ ] **Step 4: Add the segment and swap the fields**

```ts
const DIRECTION_SEGMENTS = [
  { value: "out", label: "Expense" },
  { value: "in", label: "Income" },
  { value: "transfer", label: "Transfer" },
] as const;
```

In transfer mode: relabel the wallet field to **From**, render the **To** picker (`testID="manual-entry-to-wallet"`, options `manual-entry-to-wallet-<walletId>`) excluding the selected From wallet and every archived wallet, render an optional **Fee** field (`testID="manual-entry-fee"`, blank reads as `0`), and hide Category and Merchant. Date and Note stay.

```tsx
const isTransfer = mode === "transfer";
const toCandidates = wallets.filter((wallet) => !wallet.isArchived && wallet.id !== walletId);

// Fewer than two unarchived wallets means the segment has nothing to offer.
// Disabled WITH THE REASON SHOWN rather than offered-then-refused on submit —
// the same no-dead-taps rule this file's header cites for `Button`'s `iconOnly`.
const transferAvailable = wallets.filter((wallet) => !wallet.isArchived).length >= 2;

{isTransfer ? (
  <>
    {/* The SAME inline shape the From list already uses at
        manual_entry_form.tsx:316 — a Pressable per wallet carrying
        `accessibilityState.selected`. There is NO WalletPicker component in this
        codebase; do not invent one for this task. */}
    <Text className="text-caption text-fg-muted dark:text-fg-muted-dark">To</Text>
    {toCandidates.map((wallet) => (
      <Pressable
        key={wallet.id}
        testID={`manual-entry-to-wallet-${wallet.id}`}
        accessibilityRole="button"
        accessibilityState={{ selected: toWalletId === wallet.id }}
        onPress={() => setToWalletId(wallet.id)}
      >
        <Text className="text-fg dark:text-fg-dark">{wallet.name}</Text>
      </Pressable>
    ))}
    <NumericField
      testID="manual-entry-fee"
      label="Fee (optional)"
      value={feeAmount}
      onChange={setFeeAmount}
    />
  </>
) : (
  <>
    {/* the existing Category and Merchant fields, unchanged */}
  </>
)}
```

Build the draft on submit:

```tsx
const draft: ManualEntryDraft = isTransfer
  ? {
      kind: "transfer",
      amount,
      feeAmount,
      fromWalletId: walletId,
      toWalletId: toWalletId as string,
      occurredAt,
      note,
    }
  : { kind: "entry", amount, direction, walletId, categoryId, occurredAt, merchant, note };
```

Use the codebase's own picker and numeric-field components rather than the sketch's names if they
differ — the testIDs are what the tests pin, and the numeric input must be
`components/ui/numeric_field.tsx` (the W1 spec's acceptance test greps for `keyboardType="numeric"`).

Disable the segment when fewer than two unarchived wallets exist, with the reason shown — the same no-dead-taps rule the file's own header cites for `Button`'s `iconOnly` and `ReviewCard`'s disabled-without-a-handler pairs.

- [ ] **Step 5: Rewrite the stale header comment**

The comment at `manual_entry_form.tsx:41-50` argues a Transfer segment does not belong: no transfer concept in the draft, no submit path, a control that silently does nothing. All three are now answered. Replace it with what is true — the union carries the transfer concept, `recordTransfer` is the submit path, and the segment disables itself when it has nothing to offer. A comment that contradicts the code beside it is worse than no comment.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd mobile && npx jest components/transactions/__tests__/manual_entry_form.test.tsx`
Expected: PASS, including every pre-existing test in the file (the entry branch must be unchanged in behaviour).

- [ ] **Step 7: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/components/transactions/manual_entry_form.tsx mobile/components/transactions/__tests__/manual_entry_form.test.tsx
git commit -m "feat(transactions): add a Transfer segment to the manual entry form"
```

---

### Task 5: Submit a transfer from the new-transaction screen

**Files:**
- Modify: `mobile/app/transaction/new.tsx`
- Test: `mobile/app/__tests__/transaction_new.test.tsx`

**Interfaces:**
- Consumes: `ManualEntryDraft` (Task 4), `recordTransfer` (Task 2).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `mobile/app/__tests__/transaction_new.test.tsx`, mirroring how the file already mocks the ledger write:

```ts
test("a transfer draft goes to recordTransfer, not insertTransaction", async () => {
  const view = renderScreen({ wallets: [cashWallet, bankWallet] });

  fireEvent.press(view.getByTestId("manual-entry-segment-transfer"));
  enterAmount(view, "1000.00");
  fireEvent.press(view.getByTestId(`manual-entry-to-wallet-${bankWallet.id}`));
  fireEvent.press(view.getByTestId("manual-entry-submit"));

  await waitFor(() => {
    expect(recordTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        fromWalletId: cashWallet.id,
        toWalletId: bankWallet.id,
        amount: 100_000,
        feeAmount: 0,
      }),
      expect.any(Number),
    );
  });
  expect(insertTransaction).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest app/__tests__/transaction_new.test.tsx -t "recordTransfer"`
Expected: FAIL — `recordTransfer` never called.

- [ ] **Step 3: Branch on submit**

In `new.tsx`'s submit handler:

```ts
if (draft.kind === "transfer") {
  await recordTransfer(
    {
      fromWalletId: draft.fromWalletId,
      toWalletId: draft.toWalletId,
      amount: draft.amount,
      feeAmount: draft.feeAmount,
      occurredAt: draft.occurredAt,
      note: draft.note,
    },
    Date.now(),
  );
} else {
  // the existing insertTransaction path, unchanged
}
```

Both branches then dismiss, toast and invalidate the same queries — the user recorded a movement of money either way.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest app/__tests__/transaction_new.test.tsx`
Expected: PASS, existing tests included.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/app/transaction/new.tsx mobile/app/__tests__/transaction_new.test.tsx
git commit -m "feat(transactions): record a manual transfer from the new-transaction screen"
```

At this point gap 1 is closed and shippable on its own. Tasks 6–15 close gap 2.

---

### Task 6: `transferIntent` on the parsed event

**Files:**
- Modify: `mobile/lib/ingest/parser.ts:32-43` (`ParsedEvent`), `:58-75` (keyword constants), `:380-400` (event construction)
- Test: `mobile/lib/ingest/__tests__/parser.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ParsedEvent.transferIntent?: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/lib/ingest/__tests__/parser.test.ts`, using the file's existing capture/ruleset helpers:

```ts
test("a cash-in notification carries transferIntent", () => {
  const event = parseCapture(
    capture({ text: "You have received PHP 1,000.00 cash in from BPI. Ref 123." }),
    [gcashRuleset],
    TUNABLES,
  );

  expect(event?.transferIntent).toBe(true);
});

test("an ordinary purchase does not", () => {
  const event = parseCapture(
    capture({ text: "You paid PHP 250.00 to Jollibee. Ref 456." }),
    [gcashRuleset],
    TUNABLES,
  );

  expect(event?.transferIntent ?? false).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest lib/ingest/__tests__/parser.test.ts -t "transferIntent"`
Expected: FAIL — `undefined` is not `true`.

- [ ] **Step 3: Implement the scan**

Add beside `DIRECTION_KEYWORDS` in `parser.ts`:

```ts
/**
 * Words that say "this moved between accounts" rather than "this was spent".
 *
 * A TRIGGER FOR ASKING, NEVER FOR ACTING. A false positive costs one dismissable
 * Review Queue card; a false negative costs only the status quo, in which a
 * one-sided transfer is never mentioned at all. So the set leans inclusive.
 *
 * Overlaps DIRECTION_KEYWORDS on purpose — "deposit" and "withdraw" are cues for
 * both questions, and the two scans answer different ones.
 */
const TRANSFER_INTENT_PATTERN =
  /\b(cash[ -]?in|transfer|sent to|padala|deposit|withdraw|fund transfer|instapay|pesonet|top[ -]?up|load to|add money)/iu;
```

In the event construction block, after the optional-field assignments:

```ts
// Assigned only when true, matching this block's "optional fields are present
// or absent, never `undefined`" convention.
if (searchableTexts(capture).some((field) => TRANSFER_INTENT_PATTERN.test(field))) {
  event.transferIntent = true;
}
```

And in `ParsedEvent`:

```ts
  /**
   * The notification's wording says money moved between accounts. Read by
   * transfer_detector.ts as one of the two triggers for proposing a one-sided
   * transfer. Absent means "no signal", NOT "not a transfer".
   */
  transferIntent?: boolean;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest lib/ingest/__tests__/parser.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Carry it through the normalizer**

`NormalizedEvent` is `ParsedEvent & {...}` (`normalizer.ts:38`), so the field arrives for free **if** `normalizeEvent` spreads the parsed event rather than rebuilding it field by field. Read `normalizeEvent`; if it rebuilds, carry `transferIntent` explicitly and add:

```ts
test("normalizeEvent carries transferIntent through", () => {
  const event = normalizeEvent(
    { ...parsedFixture, transferIntent: true },
    provider,
    wallets,
    matchers,
    TUNABLES,
  );
  expect(event.transferIntent).toBe(true);
});
```

to `mobile/lib/ingest/__tests__/normalizer.test.ts`, and make it pass.

- [ ] **Step 6: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/ingest/parser.ts mobile/lib/ingest/__tests__/parser.test.ts mobile/lib/ingest/normalizer.ts mobile/lib/ingest/__tests__/normalizer.test.ts
git commit -m "feat(ingest): flag notifications whose wording says money moved between accounts"
```

---

### Task 7: `mark-transfer` gains the wallet that makes it fireable

**Files:**
- Modify: `mobile/types/domain.ts:489-495` (`UserRuleAction`)
- Modify: `mobile/lib/db/repos/user_rules_repo.ts:70-78` and its action decoder
- Test: `mobile/lib/db/repos/__tests__/user_rules_repo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `{ kind: "mark-transfer"; counterpartWalletId: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/lib/db/repos/__tests__/user_rules_repo.test.ts`:

```ts
test("a mark-transfer rule round-trips with its counterpart wallet", async () => {
  await createUserRule({
    matcher: { providerKey: "gcash", merchantPattern: "BPI" },
    action: { kind: "mark-transfer", counterpartWalletId: "w_bpi" },
    priority: 100,
  });

  const [rule] = await listUserRules();
  expect(rule?.action).toEqual({ kind: "mark-transfer", counterpartWalletId: "w_bpi" });
});

test("a mark-transfer row with no counterpart wallet is dropped, not defaulted", async () => {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO user_rules
       (id, matcher_json, action_json, priority, is_enabled, created_from,
        applied_count, last_applied_at, created_at, updated_at)
     VALUES ('ur_legacy', '{"providerKey":"gcash"}', '{"kind":"mark-transfer"}', 100, 1, NULL, 0, NULL, 0, 0)`,
  );

  expect(await listUserRules()).toHaveLength(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest lib/db/repos/__tests__/user_rules_repo.test.ts -t "mark-transfer"`
Expected: FAIL — the first on a type error at compile, the second because the bare action currently decodes fine.

- [ ] **Step 3: Widen the action and tighten the decoder**

In `types/domain.ts`:

```ts
  /**
   * "Money matching this rule is a transfer to/from THIS wallet."
   *
   * The wallet is on the ACTION because `UserRuleMatcher` can only describe one
   * leg — a provider, a merchant pattern, a direction. The pair is expressed as
   * matcher-identifies-one-side, action-names-the-other. Without it the action
   * could never fire, which is exactly the state it shipped in.
   */
  | { kind: "mark-transfer"; counterpartWalletId: string }
```

In `user_rules_repo.ts`'s action decoder, after the `ACTION_KINDS` membership check:

```ts
  // REJECTED, NOT DEFAULTED. A default here would be a guess about where the
  // user's money went, and the rule would then silently propose the wrong
  // wallet on every future notification it matched. Dropping the row costs one
  // rule; guessing costs the user's trust in every card it produces.
  if (action.kind === "mark-transfer" && typeof action.counterpartWalletId !== "string") {
    return null;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest lib/db/repos/__tests__/user_rules_repo.test.ts`
Expected: PASS. Fix the fixture at `user_rules_repo.test.ts:90` (an existing `{ kind: "mark-transfer" }` literal) and the one at `categorizer.test.ts:273` — both now need `counterpartWalletId`.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/types/domain.ts mobile/lib/db/repos/user_rules_repo.ts mobile/lib/db/repos/__tests__/user_rules_repo.test.ts mobile/lib/ingest/__tests__/categorizer.test.ts
git commit -m "feat(rules): give mark-transfer the counterpart wallet that makes it fireable"
```

---

### Task 8: Extract `matcherApplies` so the detector can use it

**Files:**
- Create: `mobile/lib/ingest/rule_matcher.ts`
- Modify: `mobile/lib/ingest/categorizer.ts:232-281` (delete the local copy, import instead)
- Test: `mobile/lib/ingest/__tests__/rule_matcher.test.ts` (new)

**Interfaces:**
- Consumes: `UserRuleMatcher`, `NormalizedEvent`.
- Produces: `export function matcherApplies(matcher: UserRuleMatcher, event: NormalizedEvent): boolean`

- [ ] **Step 1: Write the failing test**

Create `mobile/lib/ingest/__tests__/rule_matcher.test.ts`:

```ts
import { matcherApplies } from "@/lib/ingest/rule_matcher";
import type { NormalizedEvent } from "@/lib/ingest/normalizer";

const event = {
  providerKey: "gcash",
  amount: 100_000,
  direction: "in",
  merchant: "BPI",
  occurredAt: 1_786_000_000_000,
  confidence: 0.9,
  walletId: "w_gcash",
  channel: "push",
} as NormalizedEvent;

test("an empty matcher matches everything", () => {
  expect(matcherApplies({}, event)).toBe(true);
});

test("a provider mismatch fails", () => {
  expect(matcherApplies({ providerKey: "seabank" }, event)).toBe(false);
});

test("a merchant pattern matches case-insensitively", () => {
  expect(matcherApplies({ merchantPattern: "bpi" }, event)).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest lib/ingest/__tests__/rule_matcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Move the function**

Cut `matcherApplies` (and any private helper it alone uses, e.g. `foldMerchant` if it is not needed elsewhere in `categorizer.ts`) into `mobile/lib/ingest/rule_matcher.ts`, exported and otherwise **byte-identical**. Import it back into `categorizer.ts`.

This is a move, not a rewrite. Behaviour must not change — the categorizer's existing tests are the proof.

- [ ] **Step 4: Run the tests**

Run: `cd mobile && npx jest lib/ingest/__tests__/rule_matcher.test.ts lib/ingest/__tests__/categorizer.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/ingest/rule_matcher.ts mobile/lib/ingest/categorizer.ts mobile/lib/ingest/__tests__/rule_matcher.test.ts
git commit -m "refactor(ingest): extract matcherApplies for reuse by the transfer detector"
```

---

### Task 9: The `one_sided` verdict

**Files:**
- Modify: `mobile/lib/ingest/transfer_detector.ts` (`TransferVerdict`, `detectTransfer`)
- Test: `mobile/lib/ingest/__tests__/transfer_detector.test.ts`

**Interfaces:**
- Consumes: `matcherApplies` (Task 8), `transferIntent` (Task 6), `mark-transfer` action (Task 7).
- Produces:
  - `type MarkTransferRule = { matcher: UserRuleMatcher; counterpartWalletId: string; priority: number }`
  - `| { kind: "one_sided"; counterpartWalletId: string | null; signal: "text" | "rule" }` on `TransferVerdict`
  - `detectTransfer(event, candidates, tunables, transferRules: MarkTransferRule[] = [])`

- [ ] **Step 1: Write the failing tests**

Append to `mobile/lib/ingest/__tests__/transfer_detector.test.ts`, reusing the file's existing `event()` / `transaction()` helpers and `TUNABLES`:

```ts
test("a pairing always outranks a one-sided guess", () => {
  const verdict = detectTransfer(
    event({ direction: "out", amount: 100_000, walletId: "w_bpi", transferIntent: true }),
    [transaction({ id: "t_in", direction: "in", amount: 100_000, walletId: "w_gcash" })],
    TUNABLES,
    [{ matcher: {}, counterpartWalletId: "w_seabank", priority: 100 }],
  );

  expect(verdict).toEqual({ kind: "auto_link", counterpartTransactionId: "t_in" });
});

test("a text signal with no pairing proposes a one-sided transfer", () => {
  const verdict = detectTransfer(
    event({ direction: "in", amount: 100_000, walletId: "w_gcash", transferIntent: true }),
    [],
    TUNABLES,
    [],
  );

  expect(verdict).toEqual({ kind: "one_sided", counterpartWalletId: null, signal: "text" });
});

test("a matching rule supplies the wallet and wins the prefill", () => {
  const verdict = detectTransfer(
    event({
      direction: "in",
      amount: 100_000,
      walletId: "w_gcash",
      providerKey: "gcash",
      transferIntent: true,
    }),
    [],
    TUNABLES,
    [{ matcher: { providerKey: "gcash" }, counterpartWalletId: "w_bpi", priority: 100 }],
  );

  expect(verdict).toEqual({
    kind: "one_sided",
    counterpartWalletId: "w_bpi",
    signal: "rule",
  });
});

test("a rule naming the event's own wallet is ignored", () => {
  const verdict = detectTransfer(
    event({ direction: "in", amount: 100_000, walletId: "w_gcash", providerKey: "gcash" }),
    [],
    TUNABLES,
    [{ matcher: { providerKey: "gcash" }, counterpartWalletId: "w_gcash", priority: 100 }],
  );

  expect(verdict).toEqual({ kind: "none" });
});

test("no signal and no rule stays none", () => {
  const verdict = detectTransfer(
    event({ direction: "out", amount: 25_000, walletId: "w_gcash" }),
    [],
    TUNABLES,
    [],
  );

  expect(verdict).toEqual({ kind: "none" });
});

test("an unresolved wallet never proposes a one-sided transfer", () => {
  const verdict = detectTransfer(
    event({ direction: "in", amount: 100_000, walletId: null, transferIntent: true }),
    [],
    TUNABLES,
    [],
  );

  expect(verdict).toEqual({ kind: "none" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest lib/ingest/__tests__/transfer_detector.test.ts -t "one-sided"`
Expected: FAIL — `detectTransfer` takes three arguments and never returns `one_sided`.

- [ ] **Step 3: Implement**

In `transfer_detector.ts`, add to `TransferVerdict`:

```ts
  /**
   * Only one leg of a movement was ever captured, because the other account
   * posts no notification — a bank-funded cash-in, an ATM withdrawal into cash.
   * There is NO counterpart transaction id here because there is no counterpart
   * row: confirming this MINTS one. `counterpartWalletId` is a prefill for the
   * card's picker, never a decision — see §5.4 of the design spec on why an
   * invented row is worse than a wrong pairing between two real ones.
   */
  | { kind: "one_sided"; counterpartWalletId: string | null; signal: "text" | "rule" }
```

and the rule type plus the resolution, keeping the stage pure:

```ts
/** A `mark-transfer` UserRule, reduced to the two facts this stage reads. */
export type MarkTransferRule = {
  matcher: UserRuleMatcher;
  counterpartWalletId: string;
  priority: number;
};

/**
 * The highest-priority rule that matches and names a wallet OTHER than the
 * event's own.
 *
 * The same-wallet exclusion is rule 1 again: a counterpart in the event's own
 * wallet is not a transfer, and a stale rule pointing at it must not produce a
 * card offering to link a wallet to itself.
 */
function ruleWalletFor(event: NormalizedEvent, rules: MarkTransferRule[]): string | null {
  const matches = rules
    .filter((rule) => rule.counterpartWalletId !== event.walletId)
    .filter((rule) => matcherApplies(rule.matcher, event))
    .sort((a, b) => b.priority - a.priority);

  return matches[0]?.counterpartWalletId ?? null;
}
```

Then, in `detectTransfer`, replace the zero-pairings early return:

```ts
  const pairings = pairingsFor(event, candidates, tunables);
  if (pairings.length === 0) return oneSidedOrNone(event, transferRules);
```

with

```ts
/**
 * The fallback when nothing in the ledger pairs with this event.
 *
 * AN UNRESOLVED WALLET RETURNS `none`, for the same reason `canPair` refuses
 * one: with `walletId === null` the distinctness of the two sides cannot even be
 * established, and such an event is already a hard route to the Review Queue on
 * its own. Proposing a transfer against an account we could not identify is the
 * one outcome worse than proposing none.
 */
function oneSidedOrNone(event: NormalizedEvent, rules: MarkTransferRule[]): TransferVerdict {
  if (event.walletId === null) return { kind: "none" };

  const ruleWallet = ruleWalletFor(event, rules);
  if (ruleWallet !== null) {
    return { kind: "one_sided", counterpartWalletId: ruleWallet, signal: "rule" };
  }
  if (event.transferIntent === true) {
    return { kind: "one_sided", counterpartWalletId: null, signal: "text" };
  }

  return { kind: "none" };
}
```

Give `transferRules` a default of `[]` in the signature so existing call sites keep compiling until Task 10 updates them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest lib/ingest/__tests__/transfer_detector.test.ts`
Expected: PASS, whole file — every pre-existing pairing test must be untouched.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/ingest/transfer_detector.ts mobile/lib/ingest/__tests__/transfer_detector.test.ts
git commit -m "feat(ingest): propose a transfer when only one leg was captured"
```

---

### Task 10: Route `one_sided` to the Review Queue

**Files:**
- Modify: `mobile/lib/ingest/confidence_gate.ts:96-115` (`GATE_REASONS`), `:243-252` (`hardRouteReason`)
- Modify: `mobile/lib/ingest/pipeline.ts:352-364` (payload), `:378-388` (`runVerdicts`), `:391-399` (`reviewKindFor`)
- Test: `mobile/lib/ingest/__tests__/confidence_gate.test.ts`, `mobile/lib/ingest/__tests__/pipeline.test.ts`

**Interfaces:**
- Consumes: Task 9's verdict.
- Produces: a queued item of kind `one-sided-transfer` carrying
  `{ amount, direction, walletId, counterpartWalletId, signal }` on top of the existing payload fields.

- [ ] **Step 1: Write the failing tests**

In `confidence_gate.test.ts`:

```ts
test("a one-sided transfer is a hard route even at a high score", () => {
  const decision = decideRoute({
    confidence: 0.99,
    hasAmount: true,
    walletId: "w_gcash",
    dedupe: { kind: "unique" },
    transfer: { kind: "one_sided", counterpartWalletId: "w_bpi", signal: "rule" },
    routed: "known",
    nonPhpCurrency: false,
    tunables: TUNABLES,
  });

  expect(decision).toEqual({
    route: "review_prefilled",
    reason: GATE_REASONS.oneSidedTransfer,
  });
});
```

In `pipeline.test.ts`, following the file's existing capture-driving helper:

```ts
test("a one-sided transfer queues an item and commits nothing", async () => {
  await seedWalletMatcher("gcash", gcashWalletId);

  await processCapture(gcashCapture({ text: "You received PHP 1,000.00 cash in. Ref 9." }));

  expect(await listTransactions({})).toHaveLength(0);

  const [item] = await listOpenReviewItems();
  expect(item?.kind).toBe("one-sided-transfer");
  expect(item?.payload).toMatchObject({
    amount: 100_000,
    direction: "in",
    walletId: gcashWalletId,
    counterpartWalletId: null,
    signal: "text",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest lib/ingest/__tests__/confidence_gate.test.ts lib/ingest/__tests__/pipeline.test.ts -t "one-sided"`
Expected: FAIL — `GATE_REASONS.oneSidedTransfer` is undefined; the pipeline auto-commits the leg.

- [ ] **Step 3: Add the reason and the hard route**

In `confidence_gate.ts`, beside `ambiguousTransfer`:

```ts
  oneSidedTransfer:
    "This looks like money moving between your own accounts. Tell PeraPlano where the other half went.",
```

and in `hardRouteReason`, immediately after the `ambiguous-transfer` line — same slot in the ordering, because it is the same question ("is this a transfer?") and answering it changes what the row *means*:

```ts
  if (input.transfer.kind === "one_sided") return GATE_REASONS.oneSidedTransfer;
```

- [ ] **Step 4: Wire the pipeline**

In `reviewKindFor`, after the `ambiguous-transfer` line:

```ts
  if (verdicts.transfer.kind === "one_sided") return "one-sided-transfer";
```

In `runVerdicts`, pass the rules through — `listUserRules()` is already loaded further down `runStages` for the categorizer, so hoist that read above `runVerdicts` and reuse it rather than querying twice:

```ts
    transfer: detectTransfer(event, recentRows, bundle.tunables, markTransferRules(rules)),
```

with

```ts
/** The `mark-transfer` rules, in the shape the detector reads. */
function markTransferRules(rules: UserRule[]): MarkTransferRule[] {
  return rules
    .filter((rule) => rule.isEnabled && rule.action.kind === "mark-transfer")
    .map((rule) => ({
      matcher: rule.matcher,
      counterpartWalletId: (rule.action as { counterpartWalletId: string }).counterpartWalletId,
      priority: rule.priority,
    }));
}
```

And in the queue payload spread, beside the `ambiguous-transfer` block:

```ts
      ...(verdicts.transfer.kind === "one_sided"
        ? {
            counterpartWalletId: verdicts.transfer.counterpartWalletId,
            signal: verdicts.transfer.signal,
          }
        : {}),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mobile && npx jest lib/ingest`
Expected: PASS, the whole ingest suite.

- [ ] **Step 6: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/ingest
git commit -m "feat(ingest): route a one-sided transfer to the review queue"
```

---

### Task 11: `confirmOneSidedTransfer`

**Files:**
- Modify: `mobile/lib/review/resolve_actions.ts`
- Modify: `mobile/hooks/mutations/use_review_action.ts:45-65`
- Test: `mobile/lib/review/__tests__/resolve_actions.test.ts`

**Interfaces:**
- Consumes: `attachCounterpartLeg` (Task 3), `proposalFrom` / `openItem` / `resolve` / `teachFrom` (existing privates in `resolve_actions.ts`).
- Produces:
  - `async function confirmOneSidedTransfer(itemId: string, counterpartWalletId: string, feeAmount: Centavos, now: EpochMs): Promise<string | null>` — returns the captured leg's transaction id.
  - `ReviewAction` gains `{ kind: "confirm-one-sided-transfer"; itemId: string; counterpartWalletId: string; feeAmount: Centavos }`.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/lib/review/__tests__/resolve_actions.test.ts`:

```ts
test("confirming mints the counterpart, links the pair and teaches a rule", async () => {
  const item = await enqueue({
    kind: "one-sided-transfer",
    payload: {
      amount: 100_000,
      direction: "in",
      walletId: gcash,
      counterpartWalletId: null,
      signal: "text",
      providerKey: "gcash",
      merchant: "BPI",
      confidence: 0.9,
    },
  });

  const committedId = await confirmOneSidedTransfer(item.id, bpi, 0, NOW);

  const rows = await listTransactions({});
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.transferLinkId !== null)).toBe(true);
  expect(rows.find((row) => row.id === committedId)?.walletId).toBe(gcash);

  const [rule] = await listUserRules();
  expect(rule?.action).toEqual({ kind: "mark-transfer", counterpartWalletId: bpi });

  expect((await getReviewItem(item.id))?.resolvedAt).not.toBeNull();
});

test("a fee lands on the source wallet as its own expense", async () => {
  const item = await enqueue({
    kind: "one-sided-transfer",
    payload: {
      amount: 98_500,
      direction: "in",
      walletId: gcash,
      counterpartWalletId: bpi,
      signal: "rule",
      providerKey: "gcash",
      confidence: 0.9,
    },
  });

  await confirmOneSidedTransfer(item.id, bpi, 1_500, NOW);

  const rows = await listTransactions({});
  const fee = rows.find((row) => row.categoryId === "cat_fees_charges");
  expect(fee?.walletId).toBe(bpi);
  expect(fee?.amount).toBe(1_500);
  expect(fee?.transferLinkId).toBeNull();
});

test("an already-resolved item is a no-op", async () => {
  const item = await enqueue({
    kind: "one-sided-transfer",
    payload: { amount: 100_000, direction: "in", walletId: gcash, confidence: 0.9 },
  });
  await confirmOneSidedTransfer(item.id, bpi, 0, NOW);

  expect(await confirmOneSidedTransfer(item.id, bpi, 0, NOW)).toBeNull();
  expect(await listTransactions({})).toHaveLength(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest lib/review/__tests__/resolve_actions.test.ts -t "one-sided"`
Expected: FAIL — `confirmOneSidedTransfer` is not exported.

- [ ] **Step 3: Implement**

Append to `resolve_actions.ts`:

```ts
/**
 * "Yes, this was a transfer — the other half was here."
 *
 * ONE WRITE. The captured leg (committed here if the pipeline only queued it),
 * the minted counterpart, an optional fee row, the link, the teaching rule and
 * the resolved item are all one transaction. A partial success would either
 * leave an internal movement counted as real money, or put a card the user
 * already answered back in front of them.
 *
 * TAKES A CLOCK, unlike `confirmAsTransfer`: this action writes a UserRule and
 * therefore has something to stamp.
 *
 * THE RULE IS WRITTEN ON CONFIRM ONLY. "Not a transfer" writes nothing — that
 * is a statement about one notification, not about the next one, and the
 * negative rule it would imply cannot be expressed by any matcher anyway.
 */
export async function confirmOneSidedTransfer(
  itemId: string,
  counterpartWalletId: string,
  feeAmount: Centavos,
  now: EpochMs,
): Promise<string | null> {
  return withUnitOfWork(async () => {
    const item = await openItem(itemId);
    if (item === null) return null;

    const proposal = proposalFrom(item, {}, await occurredAtFor(item));
    const result = await attachCounterpartLeg(
      { captured: { proposal }, counterpartWalletId, feeAmount },
      now,
    );

    const committedId =
      proposal.direction === "out" ? result.outLegId : result.inLegId;

    await teachFrom(item, { kind: "mark-transfer", counterpartWalletId }, now);
    await resolve(itemId, "confirmed");
    return committedId;
  });
}
```

Adapt the `teachFrom` call to that function's actual signature — read it first; it already builds the matcher from the item's provider and merchant, which is exactly the matcher wanted here. Do not write a second matcher builder.

- [ ] **Step 4: Add the action to the mutation hook**

In `use_review_action.ts`:

```ts
  /**
   * The user named the wallet the other half of a transfer moved to or from.
   * CARRIES the wallet and the fee, because both come from controls on the card
   * — nothing here may be re-derived, or the app would be choosing where the
   * user's money went.
   */
  | {
      kind: "confirm-one-sided-transfer";
      itemId: string;
      counterpartWalletId: string;
      feeAmount: Centavos;
    }
```

and dispatch it to `confirmOneSidedTransfer(action.itemId, action.counterpartWalletId, action.feeAmount, Date.now())` in the hook's switch, invalidating the same queries the other transfer actions do.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mobile && npx jest lib/review`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/review mobile/hooks/mutations/use_review_action.ts
git commit -m "feat(review): confirm a one-sided transfer and remember the account pair"
```

---

### Task 12: The one-sided transfer card

**Files:**
- Create: `mobile/components/review/one_sided_transfer_body.tsx`
- Modify: `mobile/components/review/review_card.tsx`
- Modify: `mobile/app/review/index.tsx:108-175` (`primaryActionFor`, `secondaryActionFor`, `rejectActionFor`) and the `ReviewCard` props at `:305-330`
- Test: `mobile/components/review/__tests__/review_card.test.tsx`, `mobile/app/__tests__/review_queue.test.tsx`

**Interfaces:**
- Consumes: `ReviewAction` (Task 11), the payload shape (Task 10).
- Produces: `ReviewCard` prop `onChooseTransferWallet?: (item: ReviewQueueItem, walletId: string, feeAmount: Centavos) => void`.

- [ ] **Step 1: Write the failing tests**

In `review_card.test.tsx`:

```ts
test("a one-sided transfer card offers every other unarchived wallet", () => {
  const view = render(
    <ReviewCard
      item={oneSidedItem({ walletId: "w_gcash", counterpartWalletId: null })}
      wallets={[gcashWallet, bpiWallet, cashWallet, archivedWallet]}
      categories={categories}
      onPrimary={jest.fn()}
      onSecondary={jest.fn()}
      onChooseTransferWallet={jest.fn()}
    />,
  );

  expect(view.queryByTestId("one-sided-wallet-w_bpi")).not.toBeNull();
  expect(view.queryByTestId("one-sided-wallet-w_cash")).not.toBeNull();
  expect(view.queryByTestId("one-sided-wallet-w_gcash")).toBeNull();
  expect(view.queryByTestId("one-sided-wallet-w_archived")).toBeNull();
});

test("a rule-sourced item preselects its wallet", () => {
  const view = render(
    <ReviewCard
      item={oneSidedItem({ walletId: "w_gcash", counterpartWalletId: "w_bpi", signal: "rule" })}
      wallets={[gcashWallet, bpiWallet]}
      categories={categories}
      onPrimary={jest.fn()}
      onSecondary={jest.fn()}
      onChooseTransferWallet={jest.fn()}
    />,
  );

  expect(view.getByTestId("one-sided-wallet-w_bpi").props.accessibilityState?.selected).toBe(true);
});

test("confirming reports the chosen wallet and fee", () => {
  const onChoose = jest.fn();
  const view = render(
    <ReviewCard
      item={oneSidedItem({ walletId: "w_gcash", counterpartWalletId: null })}
      wallets={[gcashWallet, bpiWallet]}
      categories={categories}
      onPrimary={jest.fn()}
      onSecondary={jest.fn()}
      onChooseTransferWallet={onChoose}
    />,
  );

  fireEvent.press(view.getByTestId("one-sided-wallet-w_bpi"));
  fireEvent.press(view.getByTestId("review-card-primary"));

  expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ kind: "one-sided-transfer" }), "w_bpi", 0);
});

test("the primary is disabled until a wallet is chosen", () => {
  const view = render(
    <ReviewCard
      item={oneSidedItem({ walletId: "w_gcash", counterpartWalletId: null })}
      wallets={[gcashWallet, bpiWallet]}
      categories={categories}
      onPrimary={jest.fn()}
      onSecondary={jest.fn()}
      onChooseTransferWallet={jest.fn()}
    />,
  );

  expect(view.getByTestId("review-card-primary").props.accessibilityState?.disabled).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest components/review/__tests__/review_card.test.tsx -t "one-sided"`
Expected: FAIL — the kind renders no body.

- [ ] **Step 3: Build the body**

Create `mobile/components/review/one_sided_transfer_body.tsx`:

```tsx
// components/review/one_sided_transfer_body.tsx — the body of a
// `one-sided-transfer` card.
//
// WHAT THE USER IS ACTUALLY DECIDING is where the other half of a movement
// went, and the app must not decide it for them: confirming MINTS a ledger row
// on the wallet chosen here. A prefill from a `mark-transfer` rule is a
// suggestion the user can change, never an answer — see the design spec §5.4.
//
// CASH WALLETS ARE OFFERED, DELIBERATELY. docs/03-ingest-pipeline.md §7 rule 6
// forbids AUTO-linking a cash leg because a cash leg has no second
// notification; this card is the flow that lets a human supply it. An ATM
// withdrawal — bank notification, no cash notification — is the single most
// common transfer this feature exists to catch.
import { useState } from "react";
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { ListRow } from "@/components/ui/list_row";
import { NumericField } from "@/components/ui/numeric_field";
import { formatDateTime } from "@/lib/datetime";

import type { Centavos, ReviewQueueItem, Wallet } from "@/types/domain";

export type OneSidedTransferBodyProps = {
  item: ReviewQueueItem;
  wallets: Wallet[];
  /** The captured leg's own wallet — never offered as its own counterpart. */
  capturedWalletId: string | null;
  selectedWalletId: string | null;
  onSelectWallet: (walletId: string) => void;
  feeAmount: Centavos;
  onChangeFee: (amount: Centavos) => void;
};

export function OneSidedTransferBody({
  item,
  wallets,
  capturedWalletId,
  selectedWalletId,
  onSelectWallet,
  feeAmount,
  onChangeFee,
}: OneSidedTransferBodyProps) {
  const amount = Number(item.payload.amount ?? 0) as Centavos;
  const direction = item.payload.direction === "out" ? "out" : "in";
  const candidates = wallets.filter(
    (wallet) => !wallet.isArchived && wallet.id !== capturedWalletId,
  );

  return (
    <View testID="one-sided-transfer-body" className="gap-3">
      <Text className="text-body text-fg-muted dark:text-fg-muted-dark">
        {direction === "in" ? "Where did this money come from?" : "Where did this money go?"}
      </Text>

      <View className="flex-row items-center gap-2">
        <AmountText amount={amount} direction={direction} />
        <Text className="text-caption text-fg-muted dark:text-fg-muted-dark">
          {formatDateTime(Number(item.payload.occurredAt ?? item.createdAt))}
        </Text>
      </View>

      {candidates.map((wallet) => (
        <ListRow
          key={wallet.id}
          testID={`one-sided-wallet-${wallet.id}`}
          title={wallet.name}
          onPress={() => onSelectWallet(wallet.id)}
          accessibilityRole="button"
          accessibilityState={{ selected: wallet.id === selectedWalletId }}
        />
      ))}

      <NumericField
        testID="one-sided-fee"
        label="Fee (optional)"
        value={feeAmount}
        onChange={onChangeFee}
      />
    </View>
  );
}
```

Then in `review_card.tsx`, for `kind === "one-sided-transfer"`, hold the selection and the fee in
the card's own state, seed the selection from `item.payload.counterpartWalletId`, render the body,
and pass the pair up on primary:

```tsx
const [transferWalletId, setTransferWalletId] = useState<string | null>(
  typeof item.payload.counterpartWalletId === "string" ? item.payload.counterpartWalletId : null,
);
const [transferFee, setTransferFee] = useState<Centavos>(0 as Centavos);

// WITHHELD, not supplied-and-inert: this file's own rule renders an absent
// `onPrimary` as disabled-but-visible, so the outcome still reads on screen
// while the tap that would mint a row on an unnamed wallet cannot happen.
const primary =
  transferWalletId === null || onChooseTransferWallet === undefined
    ? undefined
    : () => onChooseTransferWallet(item, transferWalletId, transferFee);
```

Use whatever numeric input the codebase already standardises on (`components/ui/numeric_field.tsx`
per the W1 numeric-input spec) rather than a bare `TextInput` — that spec's acceptance test is a
grep for `keyboardType="numeric"`. If `ListRow`'s props differ from the sketch above, follow the
component as it exists; the testIDs are what the tests pin.

- [ ] **Step 4: Wire the screen**

In `app/review/index.tsx`:

- `primaryActionFor` — return `null` for `"one-sided-transfer"`. The wallet is a choice the card owns, exactly as `loan-match` returns `null` when several loans are plausible; the actual action is dispatched through `onChooseTransferWallet`.
- `secondaryActionFor` — `{ kind: "confirm", itemId: item.id }`, labelled "Not a transfer": commit the captured leg unpaired, so both sides count normally.
- `rejectActionFor` — `null`. Real money moved and the amount parsed; the open question is how to record it, never whether. The same call `ambiguous-transfer` already makes.
- Pass the new handler:

```tsx
  onChooseTransferWallet={(item, walletId, feeAmount) =>
    triage.mutate({
      kind: "confirm-one-sided-transfer",
      itemId: item.id,
      counterpartWalletId: walletId,
      feeAmount,
    })
  }
```

- Add the label pair to `REVIEW_ACTIONS` for the new kind: primary "It's a transfer", secondary "Not a transfer".

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mobile && npx jest components/review app/__tests__/review_queue.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/components/review mobile/app/review/index.tsx mobile/app/__tests__/review_queue.test.tsx
git commit -m "feat(review): add the one-sided transfer card"
```

Gap 2 is now closed end to end. Tasks 13–15 handle the late notification.

---

### Task 13: `supersedeMintedLeg`

**Files:**
- Modify: `mobile/lib/db/repos/transactions_repo.ts`
- Test: `mobile/lib/db/repos/__tests__/transactions_repo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:

```ts
export async function supersedeMintedLeg(id: string, provider: {
  amount: Centavos;
  occurredAt: EpochMs;
  referenceNo: string | null;
  balanceAfter: Centavos | null;
  rawNotificationId: string;
  counterparty: string | null;
  confidence: number;
}): Promise<Transaction>
```

- [ ] **Step 1: Write the failing tests**

Append to `mobile/lib/db/repos/__tests__/transactions_repo.test.ts`:

```ts
test("superseding rewrites provenance and settles the balance", async () => {
  const minted = await insertTransaction({
    walletId: bpi,
    categoryId: CATEGORY_ID,
    amount: 100_000,
    direction: "out",
    occurredAt: NOW - HOUR,
    source: "manual",
    confidence: 1,
  });
  await db.runAsync("UPDATE transactions SET transfer_link_id = 'tl_1' WHERE id = ?", [minted.id]);
  const before = (await getWallet(bpi))?.balance ?? 0;

  const row = await supersedeMintedLeg(minted.id, {
    amount: 101_500,
    occurredAt: NOW - HOUR + 60_000,
    referenceNo: "REF-9",
    balanceAfter: null,
    rawNotificationId: "raw_1",
    counterparty: "GCASH",
    confidence: 0.95,
  });

  expect(row.source).toBe("notification");
  expect(row.referenceNo).toBe("REF-9");
  expect(row.rawNotificationId).toBe("raw_1");
  expect(row.amount).toBe(101_500);
  // The link survives — the pair the user confirmed is the same pair.
  expect(row.transferLinkId).toBe("tl_1");

  // Reverse-then-apply: the minted 100_000 out is undone, the real 101_500 applied.
  expect((await getWallet(bpi))?.balance).toBe(before - 1_500);
});

test("superseding keeps exactly one row", async () => {
  const minted = await insertTransaction({
    walletId: bpi,
    categoryId: CATEGORY_ID,
    amount: 100_000,
    direction: "out",
    occurredAt: NOW - HOUR,
    source: "manual",
    confidence: 1,
  });

  await supersedeMintedLeg(minted.id, {
    amount: 100_000,
    occurredAt: NOW - HOUR,
    referenceNo: "REF-9",
    balanceAfter: null,
    rawNotificationId: "raw_1",
    counterparty: null,
    confidence: 0.95,
  });

  expect(await listTransactions({})).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest lib/db/repos/__tests__/transactions_repo.test.ts -t "supersed"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement**

Add to `transactions_repo.ts`, reusing the same reverse-then-apply balance settlement `updateTransaction` performs (factor the settlement into a shared private helper if that is a clean lift; otherwise mirror it exactly):

```ts
/**
 * Replaces a MINTED transfer leg with the provider's own record of it.
 *
 * WHY THIS IS NOT `updateTransaction`. `TransactionPatch` deliberately excludes
 * `source`, `rawNotificationId` and `balanceAfter` so the edit form cannot
 * relabel a row's provenance. Superseding is not an edit — it is one record of a
 * movement being replaced by a better one — so it gets its own door rather than
 * widening that patch type for everybody.
 *
 * THE BALANCE IS SETTLED REVERSE-THEN-APPLY, exactly as `updateTransaction`
 * does: the minted row already moved the wallet balance, and the provider's
 * amount may legitimately differ (the user guessed; the bank knows).
 *
 * `transferLinkId` IS NOT TOUCHED. The link is the same link and the pair is the
 * same pair — the user's confirmation is not re-litigated by the arrival of a
 * receipt.
 */
export async function supersedeMintedLeg(
  id: string,
  provider: {
    amount: Centavos;
    occurredAt: EpochMs;
    referenceNo: string | null;
    balanceAfter: Centavos | null;
    rawNotificationId: string;
    counterparty: string | null;
    confidence: number;
  },
): Promise<Transaction> {
  const db = await getDatabase();
  const now = Date.now();
  let record: Transaction | null = null;

  await db.withTransactionAsync(async () => {
    const existing = await getTransaction(id);
    if (existing === null) throw new TransactionNotFoundError(id);

    // Reverse the minted row's effect, then apply the provider's. Two
    // statements rather than "apply the difference" for the same reason
    // `updateTransaction` uses two: this formulation is correct for an amount
    // change and a direction flip at once, and nets out to nothing when neither
    // moved. The wallet never changes here — a supersede that landed on a
    // different wallet would not be the same movement.
    await applySignedEffect(db, existing.walletId, existing.direction, -existing.amount);
    await applySignedEffect(db, existing.walletId, existing.direction, provider.amount);

    await db.runAsync(
      `UPDATE transactions
          SET amount = ?, occurred_at = ?, reference_no = ?, counterparty = ?,
              source = 'notification', confidence = ?, raw_notification_id = ?,
              balance_after = ?, updated_at = ?
        WHERE id = ?`,
      [
        provider.amount,
        provider.occurredAt,
        provider.referenceNo,
        provider.counterparty,
        provider.confidence,
        provider.rawNotificationId,
        provider.balanceAfter,
        now,
        id,
      ],
    );

    record = await getTransaction(id);
  });

  return record as Transaction;
}
```

`applySignedEffect` is whatever private helper `updateTransaction` already uses to move a
wallet balance by a signed amount — read that function first and call the same one. If the
settlement there is inline rather than factored out, lift it into a private helper and have both
call it, so the two paths cannot drift apart. `TransactionNotFoundError` is the error
`updateTransaction` already throws for a missing id.

A `balanceAfter` that arrives non-null makes this row an anchor, exactly as it would on insert.
Re-deriving the wallet from the last anchor is reconciliation work and stays out of scope — the
same known limitation `updateTransaction`'s own header documents.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest lib/db/repos/__tests__/transactions_repo.test.ts`
Expected: PASS, whole file.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/db/repos/transactions_repo.ts mobile/lib/db/repos/__tests__/transactions_repo.test.ts
git commit -m "feat(db): let a provider notification supersede a minted transfer leg"
```

---

### Task 14: The dedupe gate recognises a minted leg

**Files:**
- Modify: `mobile/lib/ingest/dedupe_gate.ts:58-101` (`DedupeVerdict`, `RecentEvent`), `:325+` (`checkDuplicate`)
- Test: `mobile/lib/ingest/__tests__/dedupe_gate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RecentEvent.mintedTransferLeg: boolean`; `DedupeVerdict` gains `{ kind: "supersedes"; ofTransactionId: string }`.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/lib/ingest/__tests__/dedupe_gate.test.ts`:

```ts
const mintedLeg = (over: Partial<RecentEvent> = {}): RecentEvent => ({
  transactionId: "t_minted",
  providerKey: null,
  channel: null,
  amount: 100_000,
  direction: "out",
  referenceNo: null,
  occurredAt: NOW,
  mintedTransferLeg: true,
  ...over,
});

test("a provider notification supersedes the minted leg it describes", () => {
  const verdict = checkDuplicate(
    event({ amount: 100_000, direction: "out", occurredAt: NOW + 60_000 }),
    [mintedLeg()],
    TUNABLES,
  );

  expect(verdict).toEqual({ kind: "supersedes", ofTransactionId: "t_minted" });
});

test("an ordinary hand-typed row is still never a twin", () => {
  const verdict = checkDuplicate(
    event({ amount: 100_000, direction: "out", occurredAt: NOW + 60_000 }),
    [mintedLeg({ mintedTransferLeg: false })],
    TUNABLES,
  );

  expect(verdict).toEqual({ kind: "unique" });
});

test("a different direction is a different movement", () => {
  const verdict = checkDuplicate(
    event({ amount: 100_000, direction: "in", occurredAt: NOW + 60_000 }),
    [mintedLeg()],
    TUNABLES,
  );

  expect(verdict).toEqual({ kind: "unique" });
});

test("an amount outside tolerance falls through to the normal path", () => {
  const verdict = checkDuplicate(
    event({ amount: 450_000, direction: "out", occurredAt: NOW + 60_000 }),
    [mintedLeg()],
    TUNABLES,
  );

  expect(verdict).toEqual({ kind: "unique" });
});

test("a minted leg outside the twin window is not superseded", () => {
  const verdict = checkDuplicate(
    event({ amount: 100_000, direction: "out", occurredAt: NOW + 5 * 24 * 60 * 60 * 1000 }),
    [mintedLeg()],
    TUNABLES,
  );

  expect(verdict).toEqual({ kind: "unique" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest lib/ingest/__tests__/dedupe_gate.test.ts -t "supersede"`
Expected: FAIL — `supersedes` is not a verdict.

- [ ] **Step 3: Implement**

Add to `DedupeVerdict`:

```ts
  /**
   * This event is the provider's own record of a leg the app MINTED earlier,
   * when the user confirmed a transfer only one side of which was captured.
   *
   * NOT `duplicate` — that outcome discards the incoming event, and here the
   * incoming event is the authoritative one. NOT `possible-duplicate` — that
   * asks the user a question they already answered when they confirmed the
   * transfer.
   */
  | { kind: "supersedes"; ofTransactionId: string }
```

Add to `RecentEvent`:

```ts
  /**
   * This row was written by the app as a placeholder for a notification that had
   * not arrived yet — `source: "manual"`, a `transferLinkId`, and no
   * `rawNotificationId`. Supplied by the orchestrator, exactly as `providerKey`
   * and `channel` are.
   *
   * IT IS THE ONE EXCEPTION TO `describesSameMovement`'s refusal of
   * `providerKey: null` rows. That refusal protects a hand-typed entry, whose
   * user may well have recorded a different thing; a minted leg is not that — it
   * is a stand-in for this very notification, written on the user's explicit
   * confirmation that the movement happened.
   */
  mintedTransferLeg: boolean;
```

And in `checkDuplicate`, **before** the strong-key check:

```ts
  const minted = nearestInTime(
    event,
    recent.filter((row) => matchesMintedLeg(event, row, tunables)),
  );
  if (minted !== null) {
    return { kind: "supersedes", ofTransactionId: minted.transactionId };
  }
```

with

```ts
/**
 * Deliberately does NOT consult `describesSameMovement` — that function's
 * provider rule is what this branch exists to except. Everything else it checks
 * is restated here explicitly rather than inherited, so the exception is one
 * function wide and cannot quietly widen.
 */
function matchesMintedLeg(
  event: NormalizedEvent,
  row: RecentEvent,
  tunables: PipelineTunables,
): boolean {
  if (!row.mintedTransferLeg) return false;
  if (event.direction !== row.direction) return false;
  if (event.amount !== row.amount) return false;

  return isWithin(event, row, tunables.dedupeTwinWindowMs);
}
```

Amount equality, not a tolerance: a minted leg was created equal to the leg the user confirmed, so an unequal provider figure is evidence of a *different* movement, not of drift. The out-of-tolerance case in §6.5 of the spec is exactly this falling through.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest lib/ingest/__tests__/dedupe_gate.test.ts`
Expected: PASS, whole file. Every existing `RecentEvent` fixture in the suite needs `mintedTransferLeg: false`.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/ingest/dedupe_gate.ts mobile/lib/ingest/__tests__/dedupe_gate.test.ts
git commit -m "feat(ingest): recognise the provider's own record of a minted transfer leg"
```

---

### Task 15: The pipeline supersedes instead of inserting

**Files:**
- Modify: `mobile/lib/ingest/pipeline.ts` (`recentEventsFor`, the `runVerdicts` result handling)
- Test: `mobile/lib/ingest/__tests__/pipeline.test.ts`

**Interfaces:**
- Consumes: Task 13's `supersedeMintedLeg`, Task 14's verdict and flag.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `pipeline.test.ts`:

```ts
test("the bank's late notification replaces the minted leg rather than duplicating it", async () => {
  await seedWalletMatcher("bpi", bpiWalletId);

  // The user already confirmed a one-sided transfer, so a minted BPI leg exists.
  const { outLegId, transferLinkId } = await attachCounterpartLeg(
    {
      captured: {
        proposal: {
          walletId: gcashWalletId,
          categoryId: UNCATEGORIZED_ID,
          amount: 100_000,
          direction: "in",
          occurredAt: NOW,
          source: "notification",
          confidence: 0.95,
        },
      },
      counterpartWalletId: bpiWalletId,
      feeAmount: 0,
    },
    NOW,
  );

  await processCapture(
    bpiCapture({ text: "PHP 1,000.00 has been debited from your account. Ref BPI-77." }),
  );

  const rows = await listTransactions({});
  expect(rows).toHaveLength(2);

  const superseded = rows.find((row) => row.id === outLegId);
  expect(superseded?.source).toBe("notification");
  expect(superseded?.referenceNo).toBe("BPI-77");
  expect(superseded?.transferLinkId).toBe(transferLinkId);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest lib/ingest/__tests__/pipeline.test.ts -t "late notification"`
Expected: FAIL — three rows, the third a duplicate BPI leg.

- [ ] **Step 3: Supply the flag**

In `recentEventsFor`, set the field from the row's own columns:

```ts
    mintedTransferLeg:
      row.source === "manual" && row.transferLinkId !== null && row.rawNotificationId === null,
```

- [ ] **Step 4: Handle the verdict**

In `runStages`, beside the existing `duplicate` early return:

```ts
  if (verdicts.dedupe.kind === "supersedes") {
    // The transfer verdict is discarded here on purpose: the leg is already
    // linked, and re-detecting would hunt a second counterpart for a pair that
    // is already complete.
    await supersedeMintedLeg(verdicts.dedupe.ofTransactionId, {
      amount: event.amount,
      occurredAt: event.occurredAt,
      referenceNo: event.referenceNo ?? null,
      balanceAfter: event.balanceAfter ?? null,
      rawNotificationId: capture.id,
      counterparty: event.counterparty ?? null,
      confidence: event.confidence,
    });
    return { kind: "superseded", transactionId: verdicts.dedupe.ofTransactionId };
  }
```

Add `superseded` to `PipelineOutcome` with a one-line comment saying what it means, and handle it wherever `PipelineOutcome` is switched on (search for the type's other consumers before assuming there are none).

- [ ] **Step 5: Run the whole suite**

Run: `cd mobile && npx jest`
Expected: PASS, every test in the project.

- [ ] **Step 6: Typecheck and commit**

```bash
cd mobile && npm run typecheck
git add mobile/lib/ingest/pipeline.ts mobile/lib/ingest/__tests__/pipeline.test.ts
git commit -m "feat(ingest): let a late provider notification take over its minted leg"
```

---

## Verification before calling this done

- [ ] `cd mobile && npx jest` — whole suite green.
- [ ] `cd mobile && npm run typecheck` — clean.
- [ ] Manual pass on the device (see `docs/13-on-device-verification.md`): record a wallet-to-wallet transfer with a fee; confirm both balances and that the fee appears in the ledger and in this month's spend; confirm neither leg appears in spend or income.
- [ ] Manual pass: trigger a cash-in notification with no bank counterpart, confirm the Review Queue card, check the ledger holds a correct two-leg transfer.
- [ ] Acceptance criteria 1–7 in the spec's §9 all demonstrated.
