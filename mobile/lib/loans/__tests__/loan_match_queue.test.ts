// lib/loans/__tests__/loan_match_queue.test.ts — the post-commit loan matcher
// (docs/04-features/06-loans.md §"Flow: automatic payment matching from the
// ledger", rules 8-10 and 17).
//
// Against the REAL migrations through `freshDb()` — including 011, which is the
// only reason a `'loan-match'` row can be INSERTed at all. Nothing is mocked:
// the CHECK constraint, the direction invariant in `recordPayment`, and the
// one-transaction-one-loan UNIQUE on `loan_payments` are the three things most
// worth failing against, and all three live in SQLite.
//
// THE TESTS ARE WRITTEN AS RULES, NOT AS FUNCTIONS. Every one of them names the
// failure it prevents, because the failures here are silent by nature: a
// suggestion that never appears looks exactly like a transaction that was not a
// payment, and a wrong match corrupts the loan balance AND the user's income at
// once (rule 17 pulls matched rows out of income cadence detection).
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import {
  createLoan,
  listPayments,
  outstandingBalance,
  PaymentDirectionMismatchError,
  recordPayment,
  updateLoan,
} from "@/lib/db/repos/loans_repo";
import { listOpen } from "@/lib/db/repos/review_queue_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";
import type { Transaction, Wallet } from "@/types/domain";

import {
  confirmLoanMatch,
  dismissLoanMatch,
  LOAN_MATCH_KIND,
  raiseLoanMatchAfterCommit,
  raiseLoanMatchSuggestion,
  readLoanMatchPayload,
} from "../loan_match_queue";

const NOW = new Date(2026, 8, 18, 12, 0).getTime(); // Sep 18 2026

let db: SQLiteDatabase;
let cash: Wallet;

/**
 * A committed ledger row — the state every test here starts from, because this
 * module only ever runs AFTER the money moved.
 */
async function commit(args: {
  amount: number;
  direction?: "in" | "out";
  merchant?: string | null;
  at?: number;
}): Promise<Transaction> {
  return insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: args.amount,
    direction: args.direction ?? "in",
    occurredAt: args.at ?? NOW,
    merchant: args.merchant ?? null,
    source: "manual",
    confidence: 1,
  });
}

/**
 * A free-form utang from a named person — the shape the whole feature is worst
 * at and therefore the one worth testing. No schedule, no due date: the only
 * signals available are the counterparty name (rule 8c, 0.4) and the amount
 * against the outstanding balance (rule 8d, 0.3), which together clear the
 * candidate floor and nothing else does.
 */
async function utang(counterparty: string, principal: number, direction: "i-owe" | "owed-to-me") {
  return createLoan({ direction, counterparty, principal });
}

/** Every open review item that is a loan-match card. */
async function loanMatchItems() {
  return (await listOpen()).filter((item) => item.kind === LOAN_MATCH_KIND);
}

beforeEach(async () => {
  db = await freshDb();
  await seedDefaultCategories();
  cash = await createWallet({ name: "Cash", type: "cash" });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Migration 011 — the kind has to exist before anything else can be true
// ---------------------------------------------------------------------------

test("MIGRATION 011 LETS THE CHECK CONSTRAINT ACCEPT 'loan-match'", async () => {
  // The whole feature rests on this one value. Before 011 the CHECK in
  // 001_core.sql listed four kinds, and every enqueue below would have failed
  // with "CHECK constraint failed" — at runtime, inside a guarded post-commit
  // hook that swallows, which is to say invisibly.
  const loan = await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });

  const itemId = await raiseLoanMatchSuggestion(transaction);
  expect(itemId).not.toBeNull();

  // Read the raw column: a kind outside the constraint's set would have thrown
  // on INSERT and never reached this row.
  const row = await db.getFirstAsync<{ kind: string }>(
    "SELECT kind FROM review_queue_items WHERE id = ?",
    [itemId as string],
  );
  expect(row?.kind).toBe("loan-match");
  void loan;
});

test("migration 011 keeps the four original kinds and the open-items index", async () => {
  // The rebuild dance drops and recreates the table; both of these are what it
  // could silently take with it. A missing index is not an error — it is
  // `countOpen`, which the tab badge polls every 30 seconds, degrading to a
  // full scan for the life of the install.
  const sql = await db.getFirstAsync<{ sql: string }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'review_queue_items'",
  );
  for (const kind of [
    "low-confidence",
    "unknown-provider",
    "ambiguous-transfer",
    "possible-duplicate",
    "loan-match",
  ]) {
    expect(sql?.sql).toContain(`'${kind}'`);
  }
  expect(sql?.sql).toContain("REFERENCES raw_notifications(id)");

  const index = await db.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_review_queue_open'",
  );
  expect(index?.name).toBe("idx_review_queue_open");
});

// ---------------------------------------------------------------------------
// Rule 8 step 1 — a commit is what starts the matcher
// ---------------------------------------------------------------------------

test("A COMMITTED REPAYMENT RAISES EXACTLY ONE REVIEW QUEUE ITEM", async () => {
  // Spec rule 8 step 1: "After a Transaction commits to the ledger, the matcher
  // scores it against open loans." Before this feature the answer was "when the
  // user next opens Plan -> Loans", which for a repayment that lands on a
  // Tuesday is "never".
  const loan = await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });

  await raiseLoanMatchAfterCommit(transaction);

  const items = await loanMatchItems();
  expect(items).toHaveLength(1);

  const payload = readLoanMatchPayload(items[0]);
  expect(payload?.transactionId).toBe(transaction.id);
  expect(payload?.candidates.map((candidate) => candidate.loanId)).toEqual([loan.id]);
  // The reasons are the user's only basis for accepting — a bare score asks
  // them to trust a number they cannot check.
  expect(payload?.candidates[0].reasons.length).toBeGreaterThan(0);
});

test("nothing is auto-matched, at any score", async () => {
  // Spec rule 9: only an explicit provider loan event with an unambiguous
  // single-loan mapping may auto-match, and provider loan events are not
  // modelled anywhere yet. So even a perfect name-and-amount agreement stays a
  // suggestion — the loan's balance must not move until the user says so.
  const loan = await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });

  await raiseLoanMatchAfterCommit(transaction);

  expect(await listPayments(loan.id)).toHaveLength(0);
  expect(await outstandingBalance(loan.id)).toBe(200000);
});

test("a transaction that looks like nothing raises no item", async () => {
  // The floor exists so the queue stays worth reading: suggesting everything is
  // the same as suggesting nothing. No name agreement, and ₱37 against a
  // ₱2,000 balance is under the partial-payment share.
  await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 3700, merchant: "JOLLIBEE" });

  await raiseLoanMatchAfterCommit(transaction);

  expect(await loanMatchItems()).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// The direction invariant
// ---------------------------------------------------------------------------

test("A WRONG-DIRECTION TRANSACTION RAISES NO ITEM", async () => {
  // Plan rule 3 and `recordPayment`'s own guard: an 'owed-to-me' loan is repaid
  // only by money ARRIVING. An outgoing transaction to the same person, for the
  // exact balance, is not a weak candidate — it is not a candidate, because
  // confirming it could only throw `PaymentDirectionMismatchError` at a user
  // who did what the card asked.
  await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS", direction: "out" });

  await raiseLoanMatchAfterCommit(transaction);

  expect(await loanMatchItems()).toHaveLength(0);
});

test("the mirrored case: an inbound transaction never suggests a loan the user owes", async () => {
  await utang("GLoan", 500000, "i-owe");
  const transaction = await commit({ amount: 500000, merchant: "GLoan", direction: "in" });

  await raiseLoanMatchAfterCommit(transaction);

  expect(await loanMatchItems()).toHaveLength(0);
});

test("recordPayment is never bypassed — a flipped loan still throws on confirm", async () => {
  // The card is raised against a direction that was correct at the time. If the
  // user then edits the loan's direction, the invariant has to hold at WRITE
  // time, not only at suggestion time — the repository is the only write path
  // into `loan_payments` and the only place this can be enforced for certain.
  const loan = await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

  await updateLoan(loan.id, { direction: "i-owe" });

  await expect(confirmLoanMatch(itemId, loan.id)).rejects.toBeInstanceOf(
    PaymentDirectionMismatchError,
  );
  // The item stays OPEN. A card closed by a failed write is a suggestion the
  // user can neither act on nor find again.
  expect(await loanMatchItems()).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Settled and already-claimed loans
// ---------------------------------------------------------------------------

test("A SETTLED LOAN RAISES NO ITEM", async () => {
  // Spec rule 20 keeps a settled loan and its history visible; nothing may be
  // suggested against it. Without this the user pays off an utang and is then
  // asked, on every subsequent transfer from the same person, whether it pays
  // the loan they already cleared.
  const loan = await utang("Ben Santos", 200000, "owed-to-me");
  const settling = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  await recordPayment({ loanId: loan.id, transactionId: settling.id });
  expect(await outstandingBalance(loan.id)).toBe(0);

  const later = await commit({ amount: 200000, merchant: "BEN SANTOS", at: NOW + 86_400_000 });
  await raiseLoanMatchAfterCommit(later);

  expect(await loanMatchItems()).toHaveLength(0);
});

test("a transaction already matched to a loan raises no item", async () => {
  // Invariant I12: one transaction pays at most one loan. Offering a claimed
  // row would produce a card whose only outcome is `PaymentAlreadyMatchedError`.
  const first = await utang("Ben Santos", 400000, "owed-to-me");
  await utang("Ben Santos", 400000, "owed-to-me");
  const transaction = await commit({ amount: 400000, merchant: "BEN SANTOS" });
  await recordPayment({ loanId: first.id, transactionId: transaction.id });

  await raiseLoanMatchAfterCommit(transaction);

  expect(await loanMatchItems()).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Rule 9 — two plausible loans are one card listing both
// ---------------------------------------------------------------------------

test("TWO PLAUSIBLE LOANS PRODUCE ONE ITEM LISTING BOTH", async () => {
  // Spec rule 9: "If two or more open loans are plausible for one Transaction,
  // it is always a suggestion listing the candidates — never an auto-match."
  // Two utangs from the same person is not an exotic case; it is how informal
  // lending works.
  const first = await utang("Ben Santos", 200000, "owed-to-me");
  const second = await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });

  await raiseLoanMatchAfterCommit(transaction);

  // ONE item, not two. Two cards racing for the same row would leave the loser
  // unacceptable (invariant I12) and sitting in the queue until it expires.
  const items = await loanMatchItems();
  expect(items).toHaveLength(1);

  const payload = readLoanMatchPayload(items[0]);
  expect(payload?.candidates.map((candidate) => candidate.loanId).sort()).toEqual(
    [first.id, second.id].sort(),
  );
  // And no payment was recorded against either — picking one is the user's job.
  expect(await listPayments(first.id)).toHaveLength(0);
  expect(await listPayments(second.id)).toHaveLength(0);
});

test("the same transaction never gets a second open card", async () => {
  // `processStored` reprocesses a durable capture after a crash (pipeline rule
  // 10) and a user can retry a failed manual entry. A duplicate card is not
  // cosmetic: the user confirms one, and the other becomes unacceptable.
  await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });

  await raiseLoanMatchAfterCommit(transaction);
  await raiseLoanMatchAfterCommit(transaction);

  expect(await loanMatchItems()).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Confirm and dismiss
// ---------------------------------------------------------------------------

test("CONFIRMING RECORDS THE PAYMENT AND CLOSES THE ITEM, IN ONE WRITE", async () => {
  const loan = await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

  const payment = await confirmLoanMatch(itemId, loan.id);

  expect(payment?.transactionId).toBe(transaction.id);
  expect(await listPayments(loan.id)).toHaveLength(1);
  expect(await outstandingBalance(loan.id)).toBe(0);
  // A recorded payment beside an open card means the card comes back and the
  // second confirm throws `PaymentAlreadyMatchedError` at the user.
  expect(await loanMatchItems()).toHaveLength(0);
});

test("confirming twice is a no-op, not a second payment", async () => {
  const loan = await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

  await confirmLoanMatch(itemId, loan.id);
  await expect(confirmLoanMatch(itemId, loan.id)).resolves.toBeNull();

  expect(await listPayments(loan.id)).toHaveLength(1);
});

test("confirming a loan the card never offered records nothing", async () => {
  // The card's own candidate list is the authority. Without this guard the
  // queue would expose a general "attach any transaction to any loan" write,
  // with none of the scoring that produced the card.
  await utang("Ben Santos", 200000, "owed-to-me");
  const unrelated = await utang("Aling Nena", 500000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

  await expect(confirmLoanMatch(itemId, unrelated.id)).resolves.toBeNull();

  expect(await listPayments(unrelated.id)).toHaveLength(0);
  expect(await loanMatchItems()).toHaveLength(1);
});

test("DISMISSING CLOSES THE ITEM AND WRITES NOTHING ELSE", async () => {
  // Spec rule 10: "Rejecting a suggestion never creates a negative UserRule
  // automatically." The transaction stays committed and counted; only the
  // question goes away.
  const loan = await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

  await dismissLoanMatch(itemId);

  expect(await loanMatchItems()).toHaveLength(0);
  expect(await listPayments(loan.id)).toHaveLength(0);
  expect(await outstandingBalance(loan.id)).toBe(200000);

  const rules = await db.getAllAsync<{ id: string }>("SELECT id FROM user_rules");
  expect(rules).toHaveLength(0);
});

test("a dismissal does not silence the NEXT transaction from the same person", async () => {
  // The other half of rule 10. Suppressing future suggestions for a merchant
  // after one rejection is a negative rule with the storage moved — and the
  // user who skipped one transfer would never be offered the real repayment.
  const loan = await utang("Ben Santos", 400000, "owed-to-me");
  const first = await commit({ amount: 400000, merchant: "BEN SANTOS" });
  await dismissLoanMatch((await raiseLoanMatchSuggestion(first)) as string);

  const second = await commit({ amount: 400000, merchant: "BEN SANTOS", at: NOW + 86_400_000 });
  await raiseLoanMatchAfterCommit(second);

  const items = await loanMatchItems();
  expect(items).toHaveLength(1);
  expect(readLoanMatchPayload(items[0])?.transactionId).toBe(second.id);
  void loan;
});

// ---------------------------------------------------------------------------
// The commit must survive the matcher
// ---------------------------------------------------------------------------

test("A MATCHER FAILURE NEVER ESCAPES INTO THE COMMIT PATH", async () => {
  // The money moved regardless of what this module thinks about it, and the
  // ledger row is already durable by the time it runs. An escaping error would
  // read as the COMMIT failing at both call sites — `pipeline.ts`'s guarded
  // catches would treat the capture as unprocessed, and `useCreateTransaction`
  // would report a failed save for a transaction that is already in the ledger,
  // with the user's next move being to type it in again.
  await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });

  // The bluntest possible fault: the table the matcher writes to is gone.
  await db.execAsync("DROP TABLE review_queue_items;");
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  await expect(raiseLoanMatchAfterCommit(transaction)).resolves.toBeUndefined();
  // Swallowed, but not silent — the difference between diagnosing this on a
  // device and guessing.
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
