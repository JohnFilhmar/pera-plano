// lib/transactions/__tests__/delete_transaction_service.test.ts — GAP-108, the
// ledger delete that docs/04-features/08-review-queue.md rule 9 has promised
// since the queue shipped.
//
// AGAINST THE REAL MIGRATIONS through `freshDb()`, and that is the whole design
// of this file. Every failure it guards against is a foreign key in
// 001_core.sql with no ON DELETE action, under `PRAGMA foreign_keys = ON`: the
// bug is not that some TypeScript branch is missing, it is that SQLite refuses
// the DELETE and the user reads "FOREIGN KEY constraint failed". A suite that
// mocked the repositories would pass against a schema that cannot run.
//
// THE TESTS ARE WRITTEN AS RULES. Each names the state it prevents, because
// almost all of them are silent: a loan whose balance still counts a payment
// that no longer exists, a bill the app believes was settled by nothing, a
// counterpart leg quietly re-entering spend — none of them errors, and every
// one of them is a number the user will read and believe.
import { closeDatabase } from "@/lib/db/database";
import {
  createBill,
  getBillPaymentByTransaction,
  getCycle,
  recordBillPayment,
} from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import {
  createLoan,
  getPaymentByTransaction,
  outstandingBalance,
  recordPayment,
} from "@/lib/db/repos/loans_repo";
import {
  isRawCaptureUnreferenced,
  listUnprocessedRawCaptures,
  storeRawCapture,
} from "@/lib/db/repos/raw_notifications_repo";
import { listOpen } from "@/lib/db/repos/review_queue_repo";
import { getTransaction, insertTransaction, sumSpend } from "@/lib/db/repos/transactions_repo";
import {
  linkTransfer,
  listLinksForTransaction,
  unlinkTransfer,
} from "@/lib/db/repos/transfer_links_repo";
import { createWallet, dismissBalanceDrift, getWallet } from "@/lib/db/repos/wallets_repo";
import { raiseLoanMatchSuggestion } from "@/lib/loans/loan_match_queue";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";
import type { RawCapture, Transaction, Wallet } from "@/types/domain";

import {
  deleteTransactionAndLinks,
  planTransactionDeletion,
  TransactionDeleteRefusedError,
} from "../delete_transaction_service";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 8, 18, 12, 0).getTime(); // Sep 18 2026
const OPENING = 100_000;

let db: SQLiteDatabase;
let gcash: Wallet;
let bpi: Wallet;

async function commit(overrides: Partial<Transaction> = {}): Promise<Transaction> {
  return insertTransaction({
    walletId: overrides.walletId ?? gcash.id,
    categoryId: overrides.categoryId ?? UNCATEGORIZED_ID,
    amount: overrides.amount ?? 25_000,
    direction: overrides.direction ?? "out",
    occurredAt: overrides.occurredAt ?? NOW,
    merchant: overrides.merchant ?? "JUAN D",
    source: overrides.source ?? "manual",
    confidence: 1,
    rawNotificationId: overrides.rawNotificationId ?? null,
  });
}

function capture(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    id: "cap-1",
    packageName: "com.globe.gcash.android",
    title: "GCash",
    text: "You have sent PHP 250.00 to JUAN D. Ref. 1234567",
    subText: null,
    bigText: null,
    postedAt: NOW,
    capturedAt: NOW,
    notificationKey: null,
    ...overrides,
  };
}

beforeEach(async () => {
  db = await freshDb();
  await seedDefaultCategories();
  gcash = await createWallet({ name: "GCash", openingBalance: OPENING });
  bpi = await createWallet({ name: "BPI Savings", openingBalance: OPENING });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// The plain row — the case the whole gap is about. A mis-tapped Confirm on a
// scrolling review queue is one gesture; without this it is also permanent.
// ---------------------------------------------------------------------------

describe("a transaction nothing else claims", () => {
  test("is deleted, and the wallet balance returns to what it was before it", async () => {
    const tx = await commit({ amount: 25_000, direction: "out" });
    expect((await getWallet(gcash.id))?.balance).toBe(OPENING - 25_000);

    await deleteTransactionAndLinks(tx.id);

    // Both halves. The row alone would leave the wallet describing a
    // transaction that no longer exists — a total and the ledger meant to
    // explain it, disagreeing, which is the failure this app may never show.
    expect(await getTransaction(tx.id)).toBeNull();
    expect((await getWallet(gcash.id))?.balance).toBe(OPENING);
    expect(await sumSpend({ from: NOW - DAY, to: NOW + DAY })).toBe(0);
  });

  test("is planned with nothing to warn about", async () => {
    const tx = await commit();

    expect(await planTransactionDeletion(tx.id)).toEqual({ refusal: null, alsoRemoves: [] });
  });

  test("takes a drift dismissal naming it with it, silently", async () => {
    const tx = await commit();
    await dismissBalanceDrift(gcash.id, tx.id);

    // The FOURTH foreign key onto `transactions(id)` — `wallets`.003 — and the
    // only one already handled inside the repository primitive. It is neither
    // refused nor announced, because a dismissal is a note about what the user
    // has READ rather than a claim about money: acknowledging a drift reported
    // by a transaction that no longer exists acknowledges nothing.
    await deleteTransactionAndLinks(tx.id);

    expect(await getTransaction(tx.id)).toBeNull();
    expect((await getWallet(gcash.id))?.driftDismissedTransactionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loan_payments.transaction_id — NOT NULL UNIQUE REFERENCES transactions(id),
// no ON DELETE. The naive delete throws; nothing in the app un-matches a loan
// payment from any screen, so a refusal here would be a dead end.
// ---------------------------------------------------------------------------

describe("a transaction matched to a loan", () => {
  async function withLoanPayment() {
    const loan = await createLoan({
      direction: "i-owe",
      counterparty: "Juan Dela Cruz",
      principal: 500_000,
    });
    const tx = await commit({ amount: 50_000, direction: "out" });
    await recordPayment({ loanId: loan.id, transactionId: tx.id });
    return { loan, tx };
  }

  test("says so before the delete, naming the loan", async () => {
    const { tx } = await withLoanPayment();

    const plan = await planTransactionDeletion(tx.id);

    expect(plan.refusal).toBeNull();
    // The counterparty, not a loan id: the confirmation is read by someone who
    // knows who they owe and has never seen a row id.
    expect(plan.alsoRemoves).toEqual([
      "The payment it records on your loan with Juan Dela Cruz is removed, and that loan's balance goes back up.",
    ]);
  });

  test("releases the payment, and the loan balance goes back up", async () => {
    const { loan, tx } = await withLoanPayment();
    expect(await outstandingBalance(loan.id)).toBe(450_000);

    await deleteTransactionAndLinks(tx.id);

    expect(await getTransaction(tx.id)).toBeNull();
    expect(await getPaymentByTransaction(tx.id)).toBeNull();
    // Derived by summing the linked ledger rows, so releasing the claim IS the
    // reversal — there is no second stored figure to correct.
    expect(await outstandingBalance(loan.id)).toBe(500_000);
    expect((await getWallet(gcash.id))?.balance).toBe(OPENING);
  });

  test("closes the open card that was still asking about it", async () => {
    const loan = await createLoan({
      direction: "i-owe",
      counterparty: "Juan Dela Cruz",
      principal: 500_000,
    });
    const tx = await commit({ amount: 50_000, direction: "out", merchant: "JUAN DELA CRUZ" });
    await raiseLoanMatchSuggestion(tx);
    expect(await listOpen()).toHaveLength(1);

    await deleteTransactionAndLinks(tx.id);

    // Left open, the card offers an accept that can only fail: `recordPayment`
    // would insert a `loan_payments` row pointing at a transaction that is not
    // there, and the user would be told "that didn't go through" forever.
    expect(await listOpen()).toHaveLength(0);
    expect(await outstandingBalance(loan.id)).toBe(500_000);
  });
});

// ---------------------------------------------------------------------------
// bill_payments.transaction_id — the same shape of key, plus a cycle row that
// says the bill was paid.
// ---------------------------------------------------------------------------

describe("a transaction matched to a bill", () => {
  async function withBillPayment() {
    const bill = await createBill({
      name: "Meralco",
      amount: 235_000,
      amountMode: "estimated",
      dueRule: { kind: "day-of-month", day: 20 },
    });
    const tx = await commit({ amount: 235_000, direction: "out", merchant: "MERALCO" });
    await recordBillPayment({ billId: bill.id, dueDate: "2026-09-20", transactionId: tx.id });
    return { bill, tx };
  }

  test("says so before the delete, naming the bill and the cycle", async () => {
    const { tx } = await withBillPayment();

    const plan = await planTransactionDeletion(tx.id);

    expect(plan.refusal).toBeNull();
    expect(plan.alsoRemoves).toEqual(["Meralco's bill due Sep 20, 2026 goes back to unpaid."]);
  });

  test("releases the payment and reopens the cycle", async () => {
    const { bill, tx } = await withBillPayment();
    expect((await getCycle(bill.id, "2026-09-20"))?.state).toBe("paid");

    await deleteTransactionAndLinks(tx.id);

    expect(await getTransaction(tx.id)).toBeNull();
    expect(await getBillPaymentByTransaction(tx.id)).toBeNull();
    // Openness is the absence of a row (see `deleteBillPayment`). A cycle left
    // marked paid by a transaction that no longer exists is a bill the app
    // believes was settled by nothing.
    expect(await getCycle(bill.id, "2026-09-20")).toBeNull();
    expect((await getWallet(gcash.id))?.balance).toBe(OPENING);
  });
});

// ---------------------------------------------------------------------------
// transfer_links.out_transaction_id / .in_transaction_id — the one reference
// this refuses, because releasing it would change a SECOND ledger row.
// ---------------------------------------------------------------------------

describe("a transfer leg", () => {
  async function linkedPair() {
    const out = await commit({ walletId: gcash.id, amount: 30_000, direction: "out" });
    const inLeg = await insertTransaction({
      walletId: bpi.id,
      categoryId: UNCATEGORIZED_ID,
      amount: 30_000,
      direction: "in",
      occurredAt: NOW,
      source: "manual",
      confidence: 1,
    });
    const link = await linkTransfer(out.id, inLeg.id, 0);
    return { out, inLeg, link };
  }

  test("refuses, naming the wallet on the other side", async () => {
    const { out } = await linkedPair();

    const plan = await planTransactionDeletion(out.id);

    expect(plan.refusal).toBe(
      'This is one leg of a transfer with BPI Savings. Tap "Not a transfer" above first, then delete it.',
    );
    // Nothing else is offered alongside a refusal: a confirmation listing what
    // WOULD be removed beside a message saying it cannot be is two answers.
    expect(plan.alsoRemoves).toEqual([]);
  });

  test("throws a typed refusal rather than a foreign-key error", async () => {
    const { out } = await linkedPair();

    // THE POINT OF THE TYPE. This is the throw that would otherwise reach the
    // user as "FOREIGN KEY constraint failed" — a sentence naming nothing they
    // can act on, about a table they have never heard of.
    await expect(deleteTransactionAndLinks(out.id)).rejects.toThrow(
      TransactionDeleteRefusedError,
    );
    await expect(deleteTransactionAndLinks(out.id)).rejects.toThrow(/BPI Savings/);

    expect(await getTransaction(out.id)).not.toBeNull();
    expect((await getWallet(gcash.id))?.balance).toBe(OPENING - 30_000);
  });

  test("deletes once the user has unlinked it, and the dissolved row goes with it", async () => {
    const { out, inLeg, link } = await linkedPair();
    await unlinkTransfer(link.id);

    await deleteTransactionAndLinks(out.id);

    expect(await getTransaction(out.id)).toBeNull();
    // `unlinkTransfer` DISSOLVES rather than deletes, so the link row survives
    // an unlink still holding NOT NULL foreign keys onto both legs. Without
    // clearing it the delete fails on a link the user was told they had already
    // broken — the exact dead end a "just unlink first" refusal would create.
    expect(await listLinksForTransaction(out.id)).toEqual([]);
    // The counterpart is untouched and countable, which it already was the
    // moment the user unlinked.
    expect(await getTransaction(inLeg.id)).not.toBeNull();
    expect((await getWallet(gcash.id))?.balance).toBe(OPENING);
  });
});

// ---------------------------------------------------------------------------
// The reference that is NOT a foreign key, and the one the gap entry never
// mentioned: the captured notification the row was parsed from.
// ---------------------------------------------------------------------------

describe("a transaction parsed from a captured notification", () => {
  test("leaves a marker, so the recovery sweep does not put the row back", async () => {
    await storeRawCapture(capture(), NOW);
    const tx = await commit({ rawNotificationId: "cap-1", source: "notification" });

    await deleteTransactionAndLinks(tx.id);

    // `startIngest`'s sweep re-runs every stored capture that points at neither
    // a Transaction nor a Review Queue card, because that is how a capture
    // stranded by a crash gets finished. A deliberately deleted row looks
    // identical — so without the marker the next launch parses this capture
    // again and commits it again, and the user watches the transaction they
    // removed come back under an id they have never seen.
    expect(await listUnprocessedRawCaptures(NOW + DAY, 100)).toEqual([]);
    expect(await isRawCaptureUnreferenced("cap-1")).toBe(false);
  });

  test("writes the marker already resolved, so no card is ever shown for it", async () => {
    await storeRawCapture(capture(), NOW);
    const tx = await commit({ rawNotificationId: "cap-1", source: "notification" });

    await deleteTransactionAndLinks(tx.id);

    // A visible card would ask the user about a movement they just removed.
    expect(await listOpen()).toEqual([]);
    const markers = await db.getAllAsync<{ resolved_at: number | null }>(
      "SELECT resolved_at FROM review_queue_items WHERE raw_notification_id = 'cap-1'",
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]?.resolved_at).not.toBeNull();
  });

  test("writes no marker when a real card already covers the capture", async () => {
    await storeRawCapture(capture(), NOW);
    const tx = await commit({ rawNotificationId: "cap-1", source: "notification" });
    const now = Date.now();
    await db.runAsync(
      `INSERT INTO review_queue_items (id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at)
       VALUES ('rq-1', 'low-confidence', '{}', 'cap-1', ?, ?, NULL)`,
      [now, now + 30 * DAY],
    );

    await deleteTransactionAndLinks(tx.id);

    // The existing card already says everything the marker would, and a second
    // row would claim the user was asked twice.
    const rows = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM review_queue_items WHERE raw_notification_id = 'cap-1'",
    );
    expect(rows.map((row) => row.id)).toEqual(["rq-1"]);
  });

  test("writes no marker for a manually entered row", async () => {
    const tx = await commit({ source: "manual" });

    await deleteTransactionAndLinks(tx.id);

    expect(await listOpen()).toEqual([]);
    const rows = await db.getAllAsync<{ id: string }>("SELECT id FROM review_queue_items");
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Atomicity. Each release is destructive on its own; a half-applied delete is
// worse than no delete at all.
// ---------------------------------------------------------------------------

test("a refused delete releases nothing", async () => {
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Juan Dela Cruz",
    principal: 500_000,
  });
  const out = await commit({ amount: 30_000, direction: "out" });
  const inLeg = await insertTransaction({
    walletId: bpi.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 30_000,
    direction: "in",
    occurredAt: NOW,
    source: "manual",
    confidence: 1,
  });
  await recordPayment({ loanId: loan.id, transactionId: out.id });
  await linkTransfer(out.id, inLeg.id, 0);

  await expect(deleteTransactionAndLinks(out.id)).rejects.toThrow(TransactionDeleteRefusedError);

  // The refusal is checked before any release, and the whole thing runs in one
  // unit of work besides. A loan payment silently withdrawn by a delete that
  // then refused would be a repayment the user has to find and match again,
  // with nothing on screen admitting it happened.
  expect(await getPaymentByTransaction(out.id)).not.toBeNull();
  expect(await outstandingBalance(loan.id)).toBe(470_000);
});
