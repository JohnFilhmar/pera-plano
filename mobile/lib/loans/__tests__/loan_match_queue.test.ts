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
import { listUserRules } from "@/lib/db/repos/user_rules_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { findLoanMatchesForTransaction } from "@/lib/loans/loans_service";
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
  recordPaymentAndCloseCards,
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
  /** The SENDER on an inbound transfer — the only name a repayment carries. */
  counterparty?: string | null;
  at?: number;
}): Promise<Transaction> {
  return insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: args.amount,
    direction: args.direction ?? "in",
    occurredAt: args.at ?? NOW,
    merchant: args.merchant ?? null,
    counterparty: args.counterparty ?? null,
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

/**
 * A loan and a transaction that plausibly pays it, with a SECOND loan from the
 * same counterparty scoring exactly as well — the same shape as "TWO PLAUSIBLE
 * LOANS PRODUCE ONE ITEM LISTING BOTH" above. The already-recorded-payment
 * tests below need `otherLoan` to be a real candidate on the raised card,
 * because `confirmLoanMatch` refuses a `loanId` that is not in its own
 * payload.
 */
async function aLoanAndAPlausibleTransaction() {
  const loan = await utang("Ben Santos", 200000, "owed-to-me");
  const otherLoan = await utang("Ben Santos", 200000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  return { loan, otherLoan, transaction };
}

beforeEach(async () => {
  db = await freshDb();
  await seedDefaultCategories();
  cash = await createWallet({ name: "Cash" });
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

// THE OWNER'S 2026-09-05 REPORT, IN ONE TEST. The notification raised a card;
// the owner then confirmed the same transaction from the loan screen's match
// sheet. The card survived, and pressing "Record this payment" on it threw
// PaymentAlreadyMatchedError, which the review screen rendered as "That didn't
// go through, and nothing was saved". Every word of that was false, and the
// only button left that did anything said the payment was not a payment.
test("recording a payment closes the open card for the same transaction", async () => {
  const { loan, transaction } = await aLoanAndAPlausibleTransaction();
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;
  expect(itemId).not.toBeNull();

  await recordPaymentAndCloseCards(loan.id, transaction.id);

  const open = await listOpen();
  expect(open.map((item) => item.id)).not.toContain(itemId);
});

// The card that slipped through anyway: raised, then the payment recorded by
// some other path. Confirming it must recognise the existing match and answer
// the card's question, not throw at the user for doing what the app asked.
test("confirming a card whose payment is already recorded resolves it", async () => {
  const { loan, transaction } = await aLoanAndAPlausibleTransaction();
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;
  await recordPayment({ loanId: loan.id, transactionId: transaction.id });

  const payment = await confirmLoanMatch(itemId, loan.id);

  expect(payment).not.toBeNull();
  expect(payment?.transactionId).toBe(transaction.id);
  const open = await listOpen();
  expect(open.map((item) => item.id)).not.toContain(itemId);
});

// I12 STILL HOLDS: one transaction pays at most one loan. A card offering a
// SECOND loan for a transaction the first loan already claimed must not record
// anything, and must still close, because its question has an answer.
test("a card is not a second claim on an already-paid transaction", async () => {
  const { loan, otherLoan, transaction } = await aLoanAndAPlausibleTransaction();
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;
  await recordPayment({ loanId: loan.id, transactionId: transaction.id });

  await confirmLoanMatch(itemId, otherLoan.id);

  const payments = await listPayments(otherLoan.id);
  expect(payments).toHaveLength(0);
  expect((await listOpen()).map((item) => item.id)).not.toContain(itemId);
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

// ---------------------------------------------------------------------------
// Rule 8 signal (b) — what a confirmation teaches
// ---------------------------------------------------------------------------

/** The `mark-loan-payment` rules a confirmation left behind. */
async function taughtRules() {
  return listUserRules("mark-loan-payment");
}

test("CONFIRMING A MATCH TEACHES ONE RULE, KEYED ON THE TRAIL THE PROVIDER WROTE", async () => {
  // Flow step 4: "A confirmed match creates a UserRule (e.g. 'transfers to
  // JUAN D → payment on loan Juan-utang')". Before this, every repayment was a
  // suggestion forever — the same monthly card, at the same score, with the
  // user's previous answer stored nowhere.
  const loan = await utang("Ben Santos", 400000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

  await confirmLoanMatch(itemId, loan.id);

  const rules = await taughtRules();
  expect(rules).toHaveLength(1);
  expect(rules[0].action).toEqual({ kind: "mark-loan-payment", loanId: loan.id });
  // The PROVIDER's rendering of the name, not the loan's own "Ben Santos" —
  // only the first will be in next month's notification.
  expect(rules[0].matcher).toEqual({ merchantPattern: "BEN SANTOS", direction: "in" });
  // Invariant I15: traceable to the correction that produced it.
  expect(rules[0].createdFrom).toBe(itemId);
});

test("an inbound repayment teaches from `counterparty` when there is no merchant", async () => {
  // A provider's RECEIVE template captures the sender as `counterparty` and
  // leaves `merchant` null (assets/parser_rules/seed.json). A teaching path
  // reading `merchant` alone would learn every i-owe payment and no owed-to-me
  // repayment at all — the exact one-sided failure `nameStrength` was fixed
  // for, reintroduced one layer up.
  const loan = await utang("Ben Santos", 400000, "owed-to-me");
  const transaction = await commit({ amount: 200000, counterparty: "BEN SANTOS" });
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

  await confirmLoanMatch(itemId, loan.id);

  expect((await taughtRules())[0]?.matcher.merchantPattern).toBe("BEN SANTOS");
});

test("THE SECOND MONTH'S PAYMENT SCORES HIGHER, AND IS STILL A SUGGESTION", async () => {
  // The acceptance criterion, and the line rule 9 draws through it. Two open
  // utangs from the same person, deliberately identical once the first payment
  // lands: same outstanding, same name, same amount. The only thing telling
  // them apart in September is that the user confirmed one of them in August.
  //
  // So the taught loan leads the card — flow step 4's "matches with higher
  // confidence" — and the card is still raised, because rule 9 reserves
  // auto-matching for explicit provider loan events and adds that "if two or
  // more open loans are plausible for one Transaction, it is always a
  // suggestion listing the candidates". A rule that silently claimed the row
  // would pay down whichever utang the user happened to confirm first and pull
  // the transaction out of income detection (rule 17) on the way past, neither
  // of which announces itself.
  const taught = await utang("Ben Santos", 400000, "owed-to-me");
  const untaught = await utang("Ben Santos", 200000, "owed-to-me");

  const august = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  const augustItem = (await raiseLoanMatchSuggestion(august)) as string;
  await confirmLoanMatch(augustItem, taught.id);
  // Both loans now owe exactly ₱2,000, so every signal but the rule is a tie.
  expect(await outstandingBalance(taught.id)).toBe(await outstandingBalance(untaught.id));

  const september = await commit({
    amount: 200000,
    merchant: "BEN SANTOS",
    at: NOW + 30 * 86_400_000,
  });
  const candidates = await findLoanMatchesForTransaction(september);

  expect(candidates.map((candidate) => candidate.loanId)).toEqual([taught.id, untaught.id]);
  expect(candidates[0].score - candidates[1].score).toBeCloseTo(0.5, 10);
  // The reason is the user's own earlier decision, not the machinery.
  expect(candidates[0].reasons).toContain("You confirmed a payment like this before");

  // NOTHING WAS RECORDED. The rule raised a score; it did not answer the
  // question. September is still unclaimed and both balances are untouched.
  await raiseLoanMatchAfterCommit(september);
  expect(await loanMatchItems()).toHaveLength(1);
  expect(await listPayments(taught.id)).toHaveLength(1);
  expect(await listPayments(untaught.id)).toHaveLength(0);
  expect(await outstandingBalance(taught.id)).toBe(200000);
});

test("a taught trail carries a loan that would otherwise fall under the floor", async () => {
  // The signal has to be worth something on its own, or "matches with higher
  // confidence" means nothing for the case it exists to serve: a borrower who
  // sends whatever they have, whenever they have it, on a free-form utang with
  // no due date. A single weak name token scores 0.25 and is not offered; with
  // the trail the user already confirmed it is.
  const loan = await utang("Kuya Ben", 1_000_000, "owed-to-me");
  const first = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  const itemId = (await raiseLoanMatchSuggestion(first)) as string;
  await confirmLoanMatch(itemId, loan.id);

  // ₱30 of an ₱8,000 balance: under `MIN_PARTIAL_SHARE`, so the amount signal
  // is silent and only the single-token name ("BEN") would have scored.
  const dribble = await commit({
    amount: 3000,
    merchant: "BEN SANTOS",
    at: NOW + 40 * 86_400_000,
  });

  const candidates = await findLoanMatchesForTransaction(dribble);
  expect(candidates.map((candidate) => candidate.loanId)).toEqual([loan.id]);
});

test("confirming a second payment on the same trail writes no second rule", async () => {
  // One rule per trail per loan. A duplicate adds nothing to the score — the
  // signal fires once — and doubles a row in the settings list the user has to
  // be able to read.
  const loan = await utang("Ben Santos", 600000, "owed-to-me");

  const august = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  await confirmLoanMatch((await raiseLoanMatchSuggestion(august)) as string, loan.id);

  const september = await commit({
    amount: 200000,
    merchant: "BEN SANTOS",
    at: NOW + 30 * 86_400_000,
  });
  await confirmLoanMatch((await raiseLoanMatchSuggestion(september)) as string, loan.id);

  expect(await listPayments(loan.id)).toHaveLength(2);
  expect(await taughtRules()).toHaveLength(1);
});

test("a rule the user switched off is not rewritten by the next confirmation", async () => {
  // Disabling a rule is a decision. Re-creating it on the next confirmation
  // would overturn that decision silently, which is the whole complaint rule
  // 10 makes about writing rules the user did not ask for.
  const loan = await utang("Ben Santos", 600000, "owed-to-me");
  const august = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  await confirmLoanMatch((await raiseLoanMatchSuggestion(august)) as string, loan.id);

  await db.runAsync("UPDATE user_rules SET is_enabled = 0");

  const september = await commit({
    amount: 200000,
    merchant: "BEN SANTOS",
    at: NOW + 30 * 86_400_000,
  });
  await confirmLoanMatch((await raiseLoanMatchSuggestion(september)) as string, loan.id);

  const rules = await taughtRules();
  expect(rules).toHaveLength(1);
  expect(rules[0].isEnabled).toBe(false);
});

test("a transaction with no name at all teaches nothing", async () => {
  // A blank `merchantPattern` fails closed in the scorer exactly as it does in
  // `rule_matcher.ts`, so a rule built from a nameless row could never fire. It
  // would sit in the settings list implying the confirmation was learned when
  // nothing was — worse than having no rule (docs/09 §2b.4).
  const loan = await utang("Ben Santos", 400000, "owed-to-me");
  const anonymous = await commit({ amount: 200000, merchant: null });

  await recordPaymentAndCloseCards(loan.id, anonymous.id);

  expect(await listPayments(loan.id)).toHaveLength(1);
  expect(await taughtRules()).toHaveLength(0);
});

test("the loan detail's own confirm teaches the same rule the card does", async () => {
  // Flow step 3 names both surfaces — "the user confirms or rejects from the
  // loan detail OR the Review Queue" — and step 4's rule belongs to the
  // confirmation, not to the screen it was made on. Teaching from one only
  // would leave match-sheet users at the confidence they started with, and
  // leave the two surfaces disagreeing about the same pair of rows.
  const loan = await utang("Ben Santos", 400000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });

  await recordPaymentAndCloseCards(loan.id, transaction.id);

  const rules = await taughtRules();
  expect(rules).toHaveLength(1);
  expect(rules[0].action).toEqual({ kind: "mark-loan-payment", loanId: loan.id });
  expect(rules[0].createdFrom).toBe(transaction.id);
});

test("A CARD OVERTAKEN BY ANOTHER LOAN'S PAYMENT TEACHES NOTHING", async () => {
  // The card offered two loans and the user picked one; by then the match
  // sheet had already recorded the transaction against the OTHER. The item
  // closes on the honest existing payment (the owner's 2026-09-05 report,
  // above) — and must not also learn "this trail pays the loan the money did
  // not go to", which would score every future repayment towards the wrong
  // utang.
  const { loan, otherLoan, transaction } = await aLoanAndAPlausibleTransaction();
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;
  await recordPayment({ loanId: otherLoan.id, transactionId: transaction.id });

  await confirmLoanMatch(itemId, loan.id);

  expect(await taughtRules()).toHaveLength(0);
});

test("a rejected suggestion teaches nothing", async () => {
  // Rule 10: "Rejecting a suggestion never creates a negative UserRule
  // automatically." It must not create a positive one either.
  const loan = await utang("Ben Santos", 400000, "owed-to-me");
  const transaction = await commit({ amount: 200000, merchant: "BEN SANTOS" });
  const itemId = (await raiseLoanMatchSuggestion(transaction)) as string;

  await dismissLoanMatch(itemId);

  expect(await taughtRules()).toHaveLength(0);
  expect(await listPayments(loan.id)).toHaveLength(0);
});
