// lib/db/repos/__tests__/loans_repo.test.ts — m2b Task 5.
//
// Against the REAL migrations through freshDb(). The m2b plan's interface for
// this task does not survive contact with 001_core.sql, and each divergence is
// called out where it bites:
//
//   `loan_payments` has NO `amount`, NO `paid_at` and NO `note`, and its
//   `transaction_id` is NOT NULL UNIQUE — which is domain invariant I12 and
//   loans rule 7 ("There are no free-floating payment records") in schema form.
//   The plan's `recordPayment({ amount, paidAt, transactionId?: null })` cannot
//   be stored. Payments reference a ledger transaction; the money that never
//   touched a tracked wallet is a BALANCE ADJUSTMENT (rule 13), which is what
//   migration 005 exists for.
import { closeDatabase, getDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { freshDb } from "@/test_support/db";
import type { Installment, Wallet } from "@/types/domain";

import {
  archiveLoan,
  countLoans,
  createLoan,
  deleteAdjustment,
  deletePayment,
  getLoan,
  listAdjustments,
  listLoans,
  listPayments,
  LoanNotFoundError,
  outstandingBalance,
  PaymentAlreadyMatchedError,
  PaymentDirectionMismatchError,
  recordAdjustment,
  recordPayment,
  updateLoan,
} from "../loans_repo";

const NOW = new Date(2026, 7, 15, 12, 0).getTime();
const DAY = 86_400_000;

let cash: Wallet;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  cash = await createWallet({ name: "Cash" });
});

afterEach(async () => {
  await closeDatabase();
});

/** A ledger transaction that could pay a loan. */
async function payment(amount: number, at = NOW): Promise<string> {
  const row = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "out",
    occurredAt: at,
    source: "manual",
    confidence: 1,
  });
  return row.id;
}

// ---------------------------------------------------------------------------
// Create and read — rules 1-3
// ---------------------------------------------------------------------------
test("BOTH DIRECTIONS ARE FIRST-CLASS", async () => {
  // Rule 1: "'Owed to me' is not an afterthought — lending to family is a
  // defining Filipino money flow and the spec treats it as a peer of
  // borrowing."
  const iOwe = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 5000000,
  });
  const owedToMe = await createLoan({
    direction: "owed-to-me",
    counterparty: "Kuya Ben",
    principal: 300000,
  });

  expect((await getLoan(iOwe.id))?.direction).toBe("i-owe");
  expect((await getLoan(owedToMe.id))?.direction).toBe("owed-to-me");
  expect(await countLoans()).toBe(2);
});

test("a FREE-FORM loan has no schedule and no interest", async () => {
  // Rule 2: "Forcing an interest formula onto a ₱500 loan from a cousin would
  // be wrong." Domain models this as `schedule: null`.
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 500000,
  });

  expect(loan.schedule).toBeNull();
  expect(loan.interestRate).toBeNull();
  expect(loan.nextDueDate).toBeNull();
  expect(await getLoan(loan.id)).toEqual(loan);
});

test("a scheduled loan round-trips its installments", async () => {
  // `Loan.schedule` is `Installment[] | null` (types/domain.ts), NOT the m2b
  // plan's `{ kind: "amortized" | "flat" | "free-form" }` tagged union. The
  // shipped model stores the MATERIALIZED schedule — which is exactly what
  // Task 6's builders produce — and free-form is the absence of one.
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 5000000,
    interestRate: 12,
    schedule: [
      { dueDate: "2026-09-15", amountDue: 444244, principalPortion: 394244, interestPortion: 50000 },
      { dueDate: "2026-10-15", amountDue: 444244, principalPortion: 398186, interestPortion: 46058 },
    ],
    nextDueDate: "2026-09-15",
    nextDueAmount: 444244,
  });

  const read = await getLoan(loan.id);
  expect(read?.schedule).toHaveLength(2);
  expect(read?.schedule?.[0]).toEqual({
    dueDate: "2026-09-15",
    amountDue: 444244,
    principalPortion: 394244,
    interestPortion: 50000,
  });
  expect(read?.interestRate).toBe(12);
  expect(read?.nextDueDate).toBe("2026-09-15");
});

test("a FLAT schedule carries no interest split", async () => {
  // Rule 3, and spec rule 4: 5-6 "never gets an interest formula". The
  // installments are stated totals; the absence of a principal/interest split
  // is how the model says so.
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 500000,
    schedule: [
      { dueDate: "2026-08-22", amountDue: 100000 },
      { dueDate: "2026-08-29", amountDue: 100000 },
    ],
  });

  expect(loan.schedule?.[0].interestPortion).toBeUndefined();
  expect(loan.interestRate).toBeNull();
});

test("getLoan returns null for an unknown id", async () => {
  expect(await getLoan("no-such-loan")).toBeNull();
});

test("listLoans filters by direction", async () => {
  const iOwe = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 5000000 });
  const owed = await createLoan({
    direction: "owed-to-me",
    counterparty: "Kuya Ben",
    principal: 300000,
  });

  expect((await listLoans({ direction: "i-owe" })).map((l) => l.id)).toEqual([iOwe.id]);
  expect((await listLoans({ direction: "owed-to-me" })).map((l) => l.id)).toEqual([owed.id]);
  expect((await listLoans()).length).toBe(2);
});

test("updateLoan patches and leaves the rest alone", async () => {
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 5000000,
    linkedWalletId: cash.id,
  });

  const updated = await updateLoan(loan.id, { nextDueDate: "2026-09-15", nextDueAmount: 444244 });

  expect(updated.nextDueDate).toBe("2026-09-15");
  expect(updated.counterparty).toBe("GLoan");
  expect(updated.linkedWalletId).toBe(cash.id);
});

test("updateLoan throws LoanNotFoundError for an unknown id", async () => {
  await expect(updateLoan("no-such-loan", { counterparty: "x" })).rejects.toThrow(
    LoanNotFoundError,
  );
});

// ---------------------------------------------------------------------------
// Reminder offsets — rule 15, migration 008
// ---------------------------------------------------------------------------
test("A LOAN SPECIFYING NONE STILL GETS THE SPEC'S DEFAULT THREE", async () => {
  // Rule 15: "3 days before nextDueDate, on the due date, and 3 days after."
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 500000,
  });

  expect(loan.reminderOffsets).toEqual([-3, 0, 3]);
  expect((await getLoan(loan.id))?.reminderOffsets).toEqual([-3, 0, 3]);
});

test("createLoan stores custom offsets, sorted ascending and deduplicated", async () => {
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Home Credit",
    principal: 500000,
    reminderOffsets: [0, -7, -7, -1],
  });

  expect(loan.reminderOffsets).toEqual([-7, -1, 0]);
});

test("AN EXPLICIT EMPTY ARRAY TURNS REMINDERS OFF ENTIRELY", async () => {
  // Rule 15: "many 5-6 borrowers do not want a due-date reminder for a
  // collector who simply shows up."
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 500000,
    reminderOffsets: [],
  });

  expect(loan.reminderOffsets).toEqual([]);
  expect((await getLoan(loan.id))?.reminderOffsets).toEqual([]);
});

test("updateLoan can turn reminders off, and later back on", async () => {
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 500000,
  });
  expect(loan.reminderOffsets).toEqual([-3, 0, 3]);

  const off = await updateLoan(loan.id, { reminderOffsets: [] });
  expect(off.reminderOffsets).toEqual([]);

  const backOn = await updateLoan(loan.id, { reminderOffsets: [-1] });
  expect(backOn.reminderOffsets).toEqual([-1]);
});

test("updateLoan without mentioning reminderOffsets leaves them untouched", async () => {
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 500000,
    reminderOffsets: [-1],
  });

  const updated = await updateLoan(loan.id, { counterparty: "Aling Nena (updated)" });

  expect(updated.reminderOffsets).toEqual([-1]);
});

// ---------------------------------------------------------------------------
// Payments — rules 4 and 5
// ---------------------------------------------------------------------------
test("PAYMENTS REDUCE THE OUTSTANDING BALANCE", async () => {
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });

  expect(await outstandingBalance(loan.id)).toBe(500000);

  await recordPayment({ loanId: loan.id, transactionId: await payment(200000) });
  expect(await outstandingBalance(loan.id)).toBe(300000);

  await recordPayment({ loanId: loan.id, transactionId: await payment(100000) });
  expect(await outstandingBalance(loan.id)).toBe(200000);
});

test("THE PAYMENT AMOUNT COMES FROM THE LEDGER, never a copy of it", async () => {
  // `loan_payments` has no `amount` column, and that is a feature: a
  // denormalized copy can drift from the transaction it describes, and then the
  // loan history and the ledger disagree about the same peso.
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });
  const txId = await payment(200000);
  await recordPayment({ loanId: loan.id, transactionId: txId });

  const payments = await listPayments(loan.id);
  expect(payments).toHaveLength(1);
  expect(payments[0].transactionId).toBe(txId);
  expect(payments[0]).not.toHaveProperty("amount");
});

test("A TRANSACTION CAN PAY AT MOST ONE LOAN (invariant I12)", async () => {
  // `loan_payments.transaction_id` is UNIQUE. Without that, one ₱2,000 payment
  // could pay down two different loans by ₱2,000 each.
  const first = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });
  const second = await createLoan({ direction: "i-owe", counterparty: "Home Credit", principal: 500000 });
  const txId = await payment(200000);
  await recordPayment({ loanId: first.id, transactionId: txId });

  await expect(recordPayment({ loanId: second.id, transactionId: txId })).rejects.toThrow(
    PaymentAlreadyMatchedError,
  );
});

test("an overpayment FLOORS the balance at zero and never goes negative", async () => {
  // Rule 5. A negative balance would render as the lender owing the user money.
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });

  await recordPayment({ loanId: loan.id, transactionId: await payment(700000) });

  expect(await outstandingBalance(loan.id)).toBe(0);
});

test("deletePayment RESTORES the balance", async () => {
  // Un-matching a payment the matcher got wrong has to give the money back to
  // the balance, or a mis-match permanently understates a debt.
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });
  const txId = await payment(200000);
  const recorded = await recordPayment({ loanId: loan.id, transactionId: txId });

  await deletePayment(recorded.id);

  expect(await outstandingBalance(loan.id)).toBe(500000);
  expect(await listPayments(loan.id)).toEqual([]);
});

test("un-matching frees the transaction to match a different loan", async () => {
  const first = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 500000 });
  const second = await createLoan({ direction: "i-owe", counterparty: "Home Credit", principal: 500000 });
  const txId = await payment(200000);
  const recorded = await recordPayment({ loanId: first.id, transactionId: txId });

  await deletePayment(recorded.id);

  await expect(
    recordPayment({ loanId: second.id, transactionId: txId }),
  ).resolves.toBeDefined();
});

test("listPayments is CHRONOLOGICAL by when the money moved", async () => {
  // Ordered by the transaction's `occurred_at`, not by when the match was
  // recorded — a payment matched last week can be for a transaction from last
  // month, and a history out of date order is unreadable.
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 5000000 });
  const late = await payment(100000, NOW);
  const early = await payment(100000, NOW - 30 * DAY);
  const middle = await payment(100000, NOW - 10 * DAY);

  await recordPayment({ loanId: loan.id, transactionId: late });
  await recordPayment({ loanId: loan.id, transactionId: early });
  await recordPayment({ loanId: loan.id, transactionId: middle });

  expect((await listPayments(loan.id)).map((p) => p.transactionId)).toEqual([early, middle, late]);
});

test("recordPayment throws for an unknown loan", async () => {
  await expect(
    recordPayment({ loanId: "no-such-loan", transactionId: await payment(100) }),
  ).rejects.toThrow(LoanNotFoundError);
});

// ---------------------------------------------------------------------------
// Balance adjustments — spec rule 13 (migration 005)
// ---------------------------------------------------------------------------
test("AN ADJUSTMENT CHANGES THE BALANCE WITHOUT A TRANSACTION", async () => {
  // Rule 13: adjustments "cover reality the app cannot see" — accrued interest,
  // lender corrections, penalties, or a relative paying the collector directly.
  const loan = await createLoan({ direction: "i-owe", counterparty: "Aling Nena", principal: 500000 });

  await recordAdjustment({
    loanId: loan.id,
    amount: 50000, // a penalty the lender charged
    occurredAt: NOW,
    note: "Late fee charged by the collector",
  });

  expect(await outstandingBalance(loan.id)).toBe(550000);
  expect(await listPayments(loan.id)).toEqual([]); // NOT a payment
});

test("an adjustment can REDUCE the balance too", async () => {
  // Signed, because a lender-side correction goes the other way. This is why
  // the column carries no positive-only CHECK.
  const loan = await createLoan({ direction: "i-owe", counterparty: "Aling Nena", principal: 500000 });

  await recordAdjustment({
    loanId: loan.id,
    amount: -100000,
    occurredAt: NOW,
    note: "Paid the collector in cash, outside any tracked wallet",
  });

  expect(await outstandingBalance(loan.id)).toBe(400000);
});

test("AN ADJUSTMENT REQUIRES A NOTE", async () => {
  // Rule 13 makes the note required, and for a reason: an adjustment has no
  // ledger entry behind it, so the note is the ONLY record of why a balance
  // moved. A blank one is a number the user will not recognise in six months.
  const loan = await createLoan({ direction: "i-owe", counterparty: "Aling Nena", principal: 500000 });

  await expect(
    recordAdjustment({ loanId: loan.id, amount: 50000, occurredAt: NOW, note: "   " }),
  ).rejects.toThrow();

  expect(await listAdjustments(loan.id)).toEqual([]);
});

test("adjustments and payments combine in the balance", async () => {
  // Spec rule 2's free-form arithmetic: "principal ... minus payments, plus any
  // balance adjustments".
  const loan = await createLoan({ direction: "i-owe", counterparty: "Aling Nena", principal: 500000 });

  await recordPayment({ loanId: loan.id, transactionId: await payment(200000) });
  await recordAdjustment({ loanId: loan.id, amount: 50000, occurredAt: NOW, note: "Late fee" });

  expect(await outstandingBalance(loan.id)).toBe(350000);
});

test("deleteAdjustment restores the balance", async () => {
  const loan = await createLoan({ direction: "i-owe", counterparty: "Aling Nena", principal: 500000 });
  const adjustment = await recordAdjustment({
    loanId: loan.id,
    amount: 50000,
    occurredAt: NOW,
    note: "Late fee",
  });

  await deleteAdjustment(adjustment.id);

  expect(await outstandingBalance(loan.id)).toBe(500000);
});

// ---------------------------------------------------------------------------
// The balance by schedule kind — spec rule 2, which is three rules
//
//   "Amortized: remaining balance per the schedule after applied payments.
//    Flat: total repayable minus the sum of `paymentHistory[]`.
//    Free-form: `principal` ... minus payments, plus any balance adjustments."
//
// All three count down from `principal`, because `principal` already IS each
// of those figures: `loan_form.tsx` stores `installment * count` for a flat
// loan, and `buildAmortizationSchedule`'s principal column sums to the
// principal. What differs is how much of a PAYMENT comes off it.
// ---------------------------------------------------------------------------

/** Three months of ₱10,000 principal at ₱4,000 a month — ₱2,000 of interest. */
const AMORTIZED: Installment[] = [
  { dueDate: "2026-09-15", amountDue: 400000, principalPortion: 300000, interestPortion: 100000 },
  { dueDate: "2026-10-15", amountDue: 400000, principalPortion: 330000, interestPortion: 70000 },
  { dueDate: "2026-11-15", amountDue: 400000, principalPortion: 370000, interestPortion: 30000 },
];

async function amortized() {
  return createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 1000000,
    interestRate: 12,
    schedule: AMORTIZED,
  });
}

test("AN AMORTIZED LOAN IS NOT SETTLED WHILE INTEREST ROWS REMAIN", async () => {
  // THE DEFECT THIS FIXES. ₱10,000 borrowed, ₱12,000 repayable over three
  // installments. Subtracting whole installments from a principal balance made
  // the loan read settled after ₱10,000 — two and a half payments — with a
  // third installment still to collect. Rule 2 wants "remaining balance per
  // the schedule", and the schedule's balance column is principal.
  const loan = await amortized();

  expect(await outstandingBalance(loan.id)).toBe(1000000);

  await recordPayment({ loanId: loan.id, transactionId: await payment(400000) });
  // ₱4,000 handed over, of which ₱1,000 was interest.
  expect(await outstandingBalance(loan.id)).toBe(1000000 - 300000);

  await recordPayment({ loanId: loan.id, transactionId: await payment(400000) });
  expect(await outstandingBalance(loan.id)).toBe(1000000 - 300000 - 330000);

  // ₱8,000 paid. The old formula called this ₱2,000 outstanding on the way to
  // settling at ₱10,000; the schedule says ₱3,700 of principal is still owed.
  expect(await outstandingBalance(loan.id)).toBeGreaterThan(0);
  expect((await listLoans({ includeSettled: false })).map((row) => row.id)).toEqual([loan.id]);

  await recordPayment({ loanId: loan.id, transactionId: await payment(400000) });
  // Settled by the LAST installment, not before it.
  expect(await outstandingBalance(loan.id)).toBe(0);
  expect(await listLoans({ includeSettled: false })).toEqual([]);
});

test("THE OPEN-LOAN FILTER ASKS THE BALANCE, it does not re-derive one in SQL", async () => {
  // `listLoans({ includeSettled: false })` is what the matcher scans, and it
  // used to carry its own WHERE-clause copy of `principal - paid + adjustments`.
  // Here the two answers diverge: ₱10,000 handed over on a ₱10,000 amortized
  // loan is only ₱8,000 of principal, so ₱2,000 is still owed — and the SQL
  // copy would have called that settled and dropped the loan out of the scan,
  // leaving the user with a payment they cannot record against it.
  const loan = await amortized();

  await recordPayment({ loanId: loan.id, transactionId: await payment(400000) });
  await recordPayment({ loanId: loan.id, transactionId: await payment(400000) });
  await recordPayment({ loanId: loan.id, transactionId: await payment(200000) });

  expect(await outstandingBalance(loan.id)).toBe(200000);
  expect((await listLoans({ includeSettled: false })).map((row) => row.id)).toEqual([loan.id]);
});

test("a PART-PAID amortized installment clears its interest before its principal", async () => {
  // How a lender applies a short payment, and it keeps the reduction inside
  // the row: ₱1,500 against a ₱4,000 installment carrying ₱1,000 of interest
  // clears ₱500 of principal, not ₱1,500.
  const loan = await amortized();

  await recordPayment({ loanId: loan.id, transactionId: await payment(150000) });

  expect(await outstandingBalance(loan.id)).toBe(1000000 - 50000);
});

test("an overpayment past the last installment still clears a late fee", async () => {
  // Rule 11: "an overpayment applies the excess to the balance", and rule 20
  // reopens a settled loan with exactly such a fee. Without counting the tail
  // beyond the schedule, the ₱500 paid to clear the ₱500 fee would land on no
  // installment and the loan could never reach zero again.
  const loan = await amortized();
  await recordAdjustment({
    loanId: loan.id,
    amount: 50000,
    occurredAt: NOW,
    note: "Late fee",
  });

  await recordPayment({ loanId: loan.id, transactionId: await payment(1200000 + 50000) });

  expect(await outstandingBalance(loan.id)).toBe(0);
});

test("THE DOC'S OWN 5-6 EXAMPLE: borrow ₱5,000, repay ₱6,000", async () => {
  // docs/04-features/06-loans.md, flow §5-6: "the app tracks outstanding =
  // ₱6,000.00 minus payments". `loan_form.tsx` is what makes that true — it
  // saves `installment * count` as a flat loan's principal, so ₱6,000 is what
  // reaches this layer and the borrowed ₱5,000 is never the balance. Pinned
  // here because GAP-082 will change that field's UI and must not change this.
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 600000,
    schedule: [
      { dueDate: "2026-09-01", amountDue: 100000 },
      { dueDate: "2026-09-08", amountDue: 100000 },
      { dueDate: "2026-09-15", amountDue: 100000 },
      { dueDate: "2026-09-22", amountDue: 100000 },
      { dueDate: "2026-09-29", amountDue: 100000 },
      { dueDate: "2026-10-06", amountDue: 100000 },
    ],
  });

  expect(await outstandingBalance(loan.id)).toBe(600000);

  // Five collector visits — the whole ₱5,000 borrowed.
  for (let visit = 0; visit < 5; visit++) {
    await recordPayment({ loanId: loan.id, transactionId: await payment(100000) });
  }

  // Rule 4: every peso of a 5-6 loan is principal, so nothing is withheld —
  // and the sixth installment is still owed.
  expect(await outstandingBalance(loan.id)).toBe(100000);
  expect((await listLoans({ includeSettled: false })).map((row) => row.id)).toEqual([loan.id]);
});

// ---------------------------------------------------------------------------
// Settled — the spec's states table, derived
// ---------------------------------------------------------------------------
test("A SETTLED LOAN IS ONE WITH A ZERO BALANCE — there is no close action", async () => {
  // The spec's states table: "Settled | Balance ₱0.00. Loan moves to a settled
  // list; history retained." Derived, exactly like a Goal's Reached — so the
  // m2b plan's `closeLoan(id, now)` has no column to write and no need to
  // exist. Rule 6's "closing is reversible because people repay and re-borrow"
  // falls out for free: record a balance adjustment and the loan is open again.
  const settled = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 200000 });
  const open = await createLoan({ direction: "i-owe", counterparty: "Home Credit", principal: 500000 });
  await recordPayment({ loanId: settled.id, transactionId: await payment(200000) });

  expect((await listLoans()).map((l) => l.id).sort()).toEqual([settled.id, open.id].sort());
  expect((await listLoans({ includeSettled: false })).map((l) => l.id)).toEqual([open.id]);
});

test("a settled loan reopens when its balance moves again", async () => {
  // Rule 6, without a flag to flip.
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 200000 });
  const recorded = await recordPayment({ loanId: loan.id, transactionId: await payment(200000) });
  expect(await listLoans({ includeSettled: false })).toEqual([]);

  await deletePayment(recorded.id);

  expect((await listLoans({ includeSettled: false })).map((l) => l.id)).toEqual([loan.id]);
});

test("listLoans is empty on a fresh database", async () => {
  expect(await listLoans()).toEqual([]);
  expect(await countLoans()).toBe(0);
});

// ---------------------------------------------------------------------------
// Archive — migration 010. Loans had NO retirement path at all before it: no
// column, no function, nothing. Owner's device report: "plan loans
// unarchivable, softdelete data, no hard delete".
// ---------------------------------------------------------------------------

test("archiving a loan hides it without destroying its payment history", async () => {
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "Tita",
    principal: 500000,
  });
  const recorded = await recordPayment({ loanId: loan.id, transactionId: await payment(100000) });

  await archiveLoan(loan.id);

  expect(await listLoans()).toEqual([]);
  // THE WHOLE REASON THERE IS NO HARD DELETE: `loan_payments` rows point at
  // real ledger Transactions. Deleting the loan would leave the money visibly
  // gone from the ledger with nothing to explain it.
  expect((await listPayments(loan.id)).map((p) => p.id)).toEqual([recorded.id]);
  expect((await getLoan(loan.id))?.archivedAt).toEqual(expect.any(Number));
  expect((await listLoans({ includeArchived: true })).map((l) => l.id)).toEqual([loan.id]);
});

test("an archived loan stops counting against the free tier's cap", async () => {
  // `canCreateLoan` reads `countLoans`. Counting retired loans would let a user
  // reach the cap with loans they are finished with and give them no way back
  // under it, since nothing is ever deleted.
  const loan = await createLoan({ direction: "i-owe", counterparty: "Kuya", principal: 100000 });
  expect(await countLoans()).toBe(1);

  await archiveLoan(loan.id);

  expect(await countLoans()).toBe(0);
});

test("ARCHIVED IS NOT SETTLED — they are separate filters", async () => {
  // A settled loan reached zero and the spec keeps it in a visible settled
  // list. An archived one is a loan the user is done tracking, whatever its
  // balance. Collapsing the two would hide loans that are still owed.
  const loan = await createLoan({ direction: "i-owe", counterparty: "Ate", principal: 500000 });

  await archiveLoan(loan.id);

  // Still unsettled — the balance never moved — yet correctly absent.
  expect(await outstandingBalance(loan.id)).toBe(500000);
  expect(await listLoans({ includeSettled: false })).toEqual([]);
});

test("archiving is idempotent and does not restamp the date", async () => {
  const loan = await createLoan({ direction: "owed-to-me", counterparty: "Boss", principal: 1000 });

  await archiveLoan(loan.id);
  const first = (await getLoan(loan.id))?.archivedAt;
  await archiveLoan(loan.id);

  expect((await getLoan(loan.id))?.archivedAt).toBe(first);
});

test("archiving an unknown id is silent", async () => {
  await expect(archiveLoan("no-such-loan")).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// Payment direction — loans rule 17
// ---------------------------------------------------------------------------

/** A ledger transaction pointing the other way — money ARRIVING. */
async function inflow(amount: number, at = NOW): Promise<string> {
  const row = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "in",
    occurredAt: at,
    source: "manual",
    confidence: 1,
  });
  return row.id;
}

test("AN OUTFLOW CANNOT PAY A LOAN OWED TO YOU", async () => {
  // The defect this guard exists for: `loan_payments` records no sign, so an
  // unguarded link let money the user SPENT reduce a balance a borrower was
  // supposed to repay — the two directions sharing one set of functions.
  const loan = await createLoan({
    direction: "owed-to-me",
    counterparty: "Kuya Ben",
    principal: 300000,
  });
  const spent = await payment(100000);

  await expect(recordPayment({ loanId: loan.id, transactionId: spent })).rejects.toBeInstanceOf(
    PaymentDirectionMismatchError,
  );
  expect(await outstandingBalance(loan.id)).toBe(300000);
});

test("AN INFLOW CANNOT PAY A LOAN YOU OWE", async () => {
  // The symmetric case, and the more damaging one: the inbound transaction is
  // very likely the user's salary, so accepting it would both erase a debt
  // nobody paid and pull a payday out of income detection.
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 500000,
  });
  const received = await inflow(100000);

  await expect(recordPayment({ loanId: loan.id, transactionId: received })).rejects.toBeInstanceOf(
    PaymentDirectionMismatchError,
  );
  expect(await outstandingBalance(loan.id)).toBe(500000);
});

test("an inflow DOES repay a loan owed to you", async () => {
  const loan = await createLoan({
    direction: "owed-to-me",
    counterparty: "Kuya Ben",
    principal: 300000,
  });

  await recordPayment({ loanId: loan.id, transactionId: await inflow(120000) });

  expect(await outstandingBalance(loan.id)).toBe(180000);
});

test("A MISMATCHED PAYMENT ALREADY IN THE DATABASE STOPS COUNTING", async () => {
  // Rows written before the guard existed. The balance queries filter on the
  // paying direction too, so a device that already recorded one recovers on
  // upgrade rather than carrying a wrong balance forever.
  const loan = await createLoan({
    direction: "owed-to-me",
    counterparty: "Kuya Ben",
    principal: 300000,
  });
  const spent = await payment(100000);
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO loan_payments (id, loan_id, transaction_id, created_at, updated_at)
     VALUES ('legacy', ?, ?, ?, ?)`,
    [loan.id, spent, NOW, NOW],
  );

  expect(await outstandingBalance(loan.id)).toBe(300000);
  expect((await listLoans({ includeSettled: false })).map((row) => row.id)).toEqual([loan.id]);
});
