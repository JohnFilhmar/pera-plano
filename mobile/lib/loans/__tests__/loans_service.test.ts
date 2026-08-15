// lib/loans/__tests__/loans_service.test.ts — m2b Task 7.
//
// Against the REAL migrations through freshDb(), and NOTHING IS MOCKED —
// reminders live in loan_reminders.ts precisely so this module stays free of
// the notification stack.
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { listLoanPaymentTransactionIds } from "@/lib/db/repos/income_repo";
import { createLoan, outstandingBalance, recordPayment } from "@/lib/db/repos/loans_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { selectCandidates } from "@/lib/income/candidates";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import {
  confirmPaymentMatch,
  findPaymentCandidates,
  listLoanStatuses,
} from "../loans_service";

const NOW = new Date(2026, 8, 18, 12, 0).getTime(); // Sep 18 2026
const DAY = 86_400_000;

let cash: Wallet;
let other: Wallet;

async function spend(args: {
  amount: number;
  at?: number;
  merchant?: string | null;
  direction?: "in" | "out";
  walletId?: string;
}): Promise<string> {
  const row = await insertTransaction({
    walletId: args.walletId ?? cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: args.amount,
    direction: args.direction ?? "out",
    occurredAt: args.at ?? NOW,
    merchant: args.merchant ?? null,
    source: "manual",
    confidence: 1,
  });
  return row.id;
}

/** A loan due Sep 15 for ₱4,442.44, linked to the cash wallet. */
async function gloan() {
  return createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 5000000,
    linkedWalletId: cash.id,
    schedule: [
      { dueDate: "2026-09-15", amountDue: 444244 },
      { dueDate: "2026-10-15", amountDue: 444244 },
    ],
    nextDueDate: "2026-09-15",
    nextDueAmount: 444244,
  });
}

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  cash = await createWallet({ name: "Cash", type: "cash" });
  other = await createWallet({ name: "GCash", type: "e-wallet" });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------
test("statuses report outstanding, next due and paid count", async () => {
  const loan = await gloan();

  const [status] = await listLoanStatuses(NOW);

  expect(status.loan.id).toBe(loan.id);
  expect(status.outstanding).toBe(5000000);
  expect(status.nextDue).toEqual({ dueDate: "2026-09-15", amount: 444244 });
  expect(status.paidCount).toBe(0);
});

test("A LOAN PAST ITS DUE DATE AND UNCOVERED IS OVERDUE", async () => {
  // Spec rule 12. Sep 15 has passed and nothing is paid.
  const loan = await gloan();

  const [status] = await listLoanStatuses(NOW);

  expect(status.overdue).toBe(true);
  void loan;
});

test("a loan due TODAY is not overdue", async () => {
  // Compared in local calendar days, the same rule a Goal's past-due state
  // keeps: the user still has the whole day to pay.
  await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 500000,
    nextDueDate: "2026-09-18",
    nextDueAmount: 100000,
  });

  const [status] = await listLoanStatuses(new Date(2026, 8, 18, 0, 30).getTime());

  expect(status.overdue).toBe(false);
});

test("a settled loan is never overdue, whatever its date says", async () => {
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 200000,
    nextDueDate: "2026-01-01",
    nextDueAmount: 200000,
  });
  await recordPayment({ loanId: loan.id, transactionId: await spend({ amount: 200000 }) });

  const [status] = await listLoanStatuses(NOW);

  expect(status.outstanding).toBe(0);
  expect(status.overdue).toBe(false);
});

test("a payment advances the next due to the following installment", async () => {
  const loan = await gloan();
  await recordPayment({ loanId: loan.id, transactionId: await spend({ amount: 444244 }) });

  const [status] = await listLoanStatuses(NOW);

  expect(status.nextDue).toEqual({ dueDate: "2026-10-15", amount: 444244 });
  expect(status.paidCount).toBe(1);
});

test("a FREE-FORM loan falls back to the due date the user set", async () => {
  // Spec rule 1: free-form has "no schedule; nextDueDate/nextDueAmount optional
  // and user-managed". `nextDue` returns null for it, so the status has to read
  // the loan's own fields or a 5-6 loan would never show a due date at all.
  await createLoan({
    direction: "i-owe",
    counterparty: "Aling Nena",
    principal: 600000,
    nextDueDate: "2026-09-25",
    nextDueAmount: 100000,
  });

  const [status] = await listLoanStatuses(NOW);

  expect(status.nextDue).toEqual({ dueDate: "2026-09-25", amount: 100000 });
  expect(status.overdue).toBe(false);
});

// ---------------------------------------------------------------------------
// Candidates — spec rule 8, plan rules 2-4
// ---------------------------------------------------------------------------
test("AN EXACT-AMOUNT PAYMENT TO THE NAMED COUNTERPARTY SCORES HIGHEST", async () => {
  const loan = await gloan();
  const best = await spend({ amount: 444244, at: new Date(2026, 8, 15).getTime(), merchant: "GLOAN PAYMENT" });
  await spend({ amount: 444244, at: new Date(2026, 8, 15).getTime(), merchant: "SOMETHING ELSE" });

  const candidates = await findPaymentCandidates(loan.id, NOW);

  expect(candidates[0].transactionId).toBe(best);
  expect(candidates[0].score).toBeGreaterThan(candidates[1].score);
});

test("A WRONG-DIRECTION TRANSACTION IS NEVER A CANDIDATE", async () => {
  // Plan rule 3. Counting an inbound credit as a payment on a loan you OWE
  // would reduce a debt nobody paid — and the same transaction is very likely
  // the user's salary.
  const loan = await gloan();
  await spend({
    amount: 444244,
    at: new Date(2026, 8, 15).getTime(),
    merchant: "GLOAN",
    direction: "in",
  });

  expect(await findPaymentCandidates(loan.id, NOW)).toEqual([]);
});

test("an owed-to-me loan is paid by INBOUND transactions", async () => {
  // Rule 1's other half: lending to family is a peer of borrowing, so the
  // direction test has to work symmetrically.
  const loan = await createLoan({
    direction: "owed-to-me",
    counterparty: "Kuya Ben",
    principal: 300000,
    nextDueDate: "2026-09-15",
    nextDueAmount: 100000,
  });
  const repayment = await spend({
    amount: 100000,
    at: new Date(2026, 8, 15).getTime(),
    merchant: "KUYA BEN",
    direction: "in",
  });

  const candidates = await findPaymentCandidates(loan.id, NOW);

  expect(candidates.map((c) => c.transactionId)).toEqual([repayment]);
});

test("AN ALREADY-MATCHED TRANSACTION IS NEVER OFFERED AGAIN", async () => {
  // Plan rule 4. Invariant I12 means one transaction pays at most one loan, so
  // offering a claimed one produces a suggestion the user cannot accept.
  const first = await gloan();
  const second = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 5000000,
    nextDueDate: "2026-09-15",
    nextDueAmount: 444244,
  });
  const txId = await spend({ amount: 444244, at: new Date(2026, 8, 15).getTime(), merchant: "GLOAN" });
  await recordPayment({ loanId: first.id, transactionId: txId });

  expect(await findPaymentCandidates(second.id, NOW)).toEqual([]);
});

test("A FAR-OFF AMOUNT WITH NOTHING ELSE MATCHING FALLS BELOW THE FLOOR", async () => {
  // One weak signal is not a suggestion. Offering everything is the same as
  // offering nothing — the user stops reading the list.
  const loan = await gloan();
  await spend({ amount: 12345, at: new Date(2026, 5, 1).getTime(), merchant: "JOLLIBEE", walletId: other.id });

  expect(await findPaymentCandidates(loan.id, NOW)).toEqual([]);
});

test("two agreeing signals are enough to be offered", async () => {
  // The floor is set so that a transaction has to agree with the loan on at
  // least two counts — here the amount and the due date, with no name match.
  const loan = await gloan();
  const txId = await spend({
    amount: 444244,
    at: new Date(2026, 8, 15).getTime(),
    merchant: null,
    walletId: other.id,
  });

  expect((await findPaymentCandidates(loan.id, NOW)).map((c) => c.transactionId)).toEqual([txId]);
});

test("a settled loan suggests nothing", async () => {
  const loan = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 200000,
    nextDueDate: "2026-09-15",
    nextDueAmount: 200000,
  });
  await recordPayment({ loanId: loan.id, transactionId: await spend({ amount: 200000 }) });
  await spend({ amount: 200000, at: new Date(2026, 8, 15).getTime(), merchant: "GLOAN" });

  expect(await findPaymentCandidates(loan.id, NOW)).toEqual([]);
});

test("candidates are capped and returned best first", async () => {
  const loan = await gloan();
  for (let index = 0; index < 8; index++) {
    await spend({
      amount: 444244,
      at: new Date(2026, 8, 14 - index).getTime(),
      merchant: "GLOAN",
    });
  }

  const candidates = await findPaymentCandidates(loan.id, NOW);

  expect(candidates.length).toBeLessThanOrEqual(5);
  for (let index = 1; index < candidates.length; index++) {
    expect(candidates[index - 1].score).toBeGreaterThanOrEqual(candidates[index].score);
  }
});

test("an unknown loan yields no candidates rather than throwing", async () => {
  expect(await findPaymentCandidates("no-such-loan", NOW)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Confirming — plan rule 5
// ---------------------------------------------------------------------------
test("confirming records the payment and reduces the balance", async () => {
  const loan = await gloan();
  const txId = await spend({ amount: 444244, at: new Date(2026, 8, 15).getTime(), merchant: "GLOAN" });

  const recorded = await confirmPaymentMatch(loan.id, txId);

  expect(recorded.transactionId).toBe(txId);
  expect(await outstandingBalance(loan.id)).toBe(5000000 - 444244);
});

test("A CONFIRMED PAYMENT IS EXCLUDED FROM INCOME DETECTION", async () => {
  // Loans rule 17: "Transactions matched to an owed-to-me loan are excluded
  // from income cadence detection so that a borrower's regular repayments are
  // never mistaken for a payday." A monthly ₱3,000 repayment from a cousin
  // otherwise looks exactly like a small monthly salary.
  const loan = await createLoan({
    direction: "owed-to-me",
    counterparty: "Kuya Ben",
    principal: 300000,
    nextDueDate: "2026-09-15",
    nextDueAmount: 300000,
  });
  const txId = await spend({
    amount: 300000,
    at: new Date(2026, 8, 15).getTime(),
    merchant: "KUYA BEN",
    direction: "in",
  });

  await confirmPaymentMatch(loan.id, txId);

  // End to end through the income side's own reader, not a re-implementation.
  const claimed = new Set(await listLoanPaymentTransactionIds());
  expect(claimed.has(txId)).toBe(true);
  const candidates = selectCandidates(await listTransactions({}), claimed);
  expect(candidates.map((candidate) => candidate.transactionId)).not.toContain(txId);
});

test("NOTHING IS RECORDED BY MERELY FINDING CANDIDATES", async () => {
  // Plan rule 1: "Matching proposes, never auto-records." Spec rule 9 is
  // stricter still — only an explicit provider loan event may auto-match, and
  // none is modelled yet, so nothing here may write.
  const loan = await gloan();
  await spend({ amount: 444244, at: new Date(2026, 8, 15).getTime(), merchant: "GLOAN" });

  await findPaymentCandidates(loan.id, NOW);

  expect(await outstandingBalance(loan.id)).toBe(5000000);
  expect((await listLoanStatuses(NOW))[0].paidCount).toBe(0);
});
