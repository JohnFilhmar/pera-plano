// lib/wallets/__tests__/reconcile_activity.test.ts — the ledger read the cash
// reconciliation scheduler is built on (`listReconcileActivity`,
// lib/db/repos/wallets_repo.ts).
//
// AGAINST A REAL DATABASE, not a mock, because everything this read gets wrong
// it gets wrong in SQL: the `is_adjustment` exclusion that keeps a
// reconciliation from resetting its own idle clock, the note that separates a
// cash reconciliation from a starting-balance correction, and the
// `transfer_link_id` that identifies an ATM cash-out. A mocked repository would
// prove only that the scheduler reads whatever it is handed.
import { closeDatabase, type SQLiteDatabase } from "@/lib/db/database";
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { createWallet, listReconcileActivity } from "@/lib/db/repos/wallets_repo";
import { RECONCILE_NOTE } from "@/lib/wallets/reconcile";
import { freshDb } from "@/test_support/db";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 5, 12, 0).getTime();

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, 'Uncategorized', NULL, 'circle-help', 1, 0, ?, ?)`,
    [UNCATEGORIZED_ID, NOW, NOW],
  );
});

afterEach(async () => {
  await closeDatabase();
});

/** An ordinary cash spend. */
function spend(walletId: string, occurredAt: number) {
  return insertTransaction({
    walletId,
    categoryId: UNCATEGORIZED_ID,
    amount: 12000,
    direction: "out",
    occurredAt,
    source: "manual",
    confidence: 1,
  });
}

/** Exactly what `useReconcileCash` writes: the delta, marked as an adjustment. */
function reconciliation(walletId: string, occurredAt: number) {
  return insertTransaction({
    walletId,
    categoryId: UNCATEGORIZED_ID,
    amount: 20000,
    direction: "out",
    occurredAt,
    source: "manual",
    confidence: 1,
    note: RECONCILE_NOTE,
    isAdjustment: true,
  });
}

test("a wallet with no transactions is absent, not a row of nulls", async () => {
  await createWallet({ name: "Pocket cash", openingBalance: 50000 });

  expect(await listReconcileActivity()).toEqual([]);
});

test("reads the last reconciliation and the last real activity as SEPARATE facts", async () => {
  // The whole point of the exclusion: a reconciliation two days ago must not
  // make the wallet look active two days ago, or trigger (c) — "14 days with no
  // cash activity at all" — could never fire, because answering the prompt
  // would reset the very clock the prompt is measured against.
  const wallet = await createWallet({ name: "Pocket cash", openingBalance: 50000 });
  await spend(wallet.id, NOW - 15 * DAY);
  await reconciliation(wallet.id, NOW - 2 * DAY);

  expect(await listReconcileActivity()).toEqual([
    {
      walletId: wallet.id,
      lastReconciledAt: NOW - 2 * DAY,
      lastActivityAt: NOW - 15 * DAY,
      lastCashInAt: null,
    },
  ]);
});

test("a starting-balance correction is not a reconciliation", async () => {
  // Both are adjustments (migration 017) and both are `source: manual`; only
  // the note tells them apart, and only one of them means "the user counted
  // their pocket". Counting a balance correction as a reconciliation would
  // postpone the next prompt by a week for a question nobody was asked.
  const wallet = await createWallet({ name: "Pocket cash", openingBalance: 50000 });
  await spend(wallet.id, NOW - 20 * DAY);
  await insertTransaction({
    walletId: wallet.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 5000,
    direction: "in",
    occurredAt: NOW - 1 * DAY,
    source: "manual",
    confidence: 1,
    note: "Starting balance / manual correction",
    isAdjustment: true,
  });

  const [activity] = await listReconcileActivity();
  expect(activity.lastReconciledAt).toBeNull();
  expect(activity.lastActivityAt).toBe(NOW - 20 * DAY);
});

test("an incoming transfer leg is the ATM cash-out trigger", async () => {
  // Trigger (b). The out-leg on the bank wallet must not be reported as a
  // cash-in on that wallet, so both wallets are asserted.
  const bank = await createWallet({ name: "BPI", openingBalance: 500000 });
  const cash = await createWallet({ name: "Pocket cash", openingBalance: 0 });
  const out = await insertTransaction({
    walletId: bank.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 100000,
    direction: "out",
    occurredAt: NOW - 3 * DAY,
    source: "notification",
    confidence: 1,
  });
  const cashIn = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 100000,
    direction: "in",
    occurredAt: NOW - 3 * DAY,
    source: "manual",
    confidence: 1,
  });
  await linkTransfer(out.id, cashIn.id, 0);

  const byWallet = new Map(
    (await listReconcileActivity()).map((row) => [row.walletId, row]),
  );
  expect(byWallet.get(cash.id)?.lastCashInAt).toBe(NOW - 3 * DAY);
  expect(byWallet.get(bank.id)?.lastCashInAt).toBeNull();
});

test("keeps each wallet's facts to itself", async () => {
  const first = await createWallet({ name: "Pocket cash", openingBalance: 50000 });
  const second = await createWallet({ name: "Drawer", openingBalance: 20000 });
  await spend(first.id, NOW - 1 * DAY);
  await reconciliation(second.id, NOW - 9 * DAY);

  const byWallet = new Map(
    (await listReconcileActivity()).map((row) => [row.walletId, row]),
  );
  expect(byWallet.get(first.id)).toEqual({
    walletId: first.id,
    lastReconciledAt: null,
    lastActivityAt: NOW - 1 * DAY,
    lastCashInAt: null,
  });
  expect(byWallet.get(second.id)).toEqual({
    walletId: second.id,
    lastReconciledAt: NOW - 9 * DAY,
    lastActivityAt: null,
    lastCashInAt: null,
  });
});
