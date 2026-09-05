// lib/loans/__tests__/loans_service.test.ts — m2b Task 7.
//
// Against the REAL migrations through freshDb(), and NOTHING IS MOCKED —
// reminders live in loan_reminders.ts precisely so this module stays free of
// the notification stack.
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { listLoanPaymentTransactionIds } from "@/lib/db/repos/income_repo";
import {
  createLoan,
  listRejectedTransactionIds,
  outstandingBalance,
  recordPayment,
  rejectCandidates,
} from "@/lib/db/repos/loans_repo";
import { insertTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { selectCandidates } from "@/lib/income/candidates";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import {
  confirmPaymentMatch,
  findPaymentCandidates,
  listLoanStatuses,
  recordManualPayment,
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
  cash = await createWallet({ name: "Cash" });
  other = await createWallet({ name: "GCash" });
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
// Rejections — "None of these" (019_loan_match_rejections)
// ---------------------------------------------------------------------------

/** A loan with one transaction that plausibly pays it, and a second loan sharing its counterparty. */
async function aLoanWithOnePlausiblePayment() {
  const loan = await gloan();
  const otherLoanSameCounterparty = await createLoan({
    direction: "i-owe",
    counterparty: "GLoan",
    principal: 5000000,
    nextDueDate: "2026-09-15",
    nextDueAmount: 444244,
  });
  const paying = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 444244,
    direction: "out",
    occurredAt: new Date(2026, 8, 15).getTime(),
    merchant: "GLOAN PAYMENT",
    source: "manual",
    confidence: 1,
  });
  return { loan, paying, otherLoanSameCounterparty };
}

// "NONE OF THESE" HAS TO SURVIVE THE SHEET CLOSING. Before this, the button
// called `onDismiss` and nothing else, so the same rows were re-scored on the
// next visit and the loan kept advertising "2 possible payments". The owner
// reported it as the button having "no actual wired function".
test("a rejected transaction stops being suggested for that loan", async () => {
  const { loan, paying } = await aLoanWithOnePlausiblePayment();

  const before = await findPaymentCandidates(loan.id, NOW);
  expect(before.map((candidate) => candidate.transactionId)).toContain(paying.id);

  await rejectCandidates(loan.id, [paying.id]);

  const after = await findPaymentCandidates(loan.id, NOW);
  expect(after.map((candidate) => candidate.transactionId)).not.toContain(paying.id);
});

// THE REJECTION IS A UI MEMORY, NOT A NEGATIVE RULE (loans rule 10). "Show
// every transaction" is a SEARCH, and a user who rejected a row and then
// realised it was the payment must still be able to find it and confirm it.
test("the browse-everything list still offers a rejected transaction", async () => {
  const { loan, paying } = await aLoanWithOnePlausiblePayment();
  await rejectCandidates(loan.id, [paying.id]);

  const all = await findPaymentCandidates(loan.id, NOW, 50, true);

  expect(all.map((candidate) => candidate.transactionId)).toContain(paying.id);
});

// Rule 10 again, from the other side: a rejection names ONE pair. It says
// nothing about the counterparty, and a second loan with the same person must
// still be offered the same row.
test("a rejection on one loan does not silence the row on another", async () => {
  const { loan, paying, otherLoanSameCounterparty } = await aLoanWithOnePlausiblePayment();
  await rejectCandidates(loan.id, [paying.id]);

  const other = await findPaymentCandidates(otherLoanSameCounterparty.id, NOW);

  expect(other.map((candidate) => candidate.transactionId)).toContain(paying.id);
});

// THE MULTI-ROW SHAPE, WHICH IS THE ONLY ONE THE BUTTON EVER PRODUCES. "None
// of these" rejects EVERY candidate the sheet was showing, and the sheet is
// only worth opening when a loan advertises more than one — so two ids in one
// call is the reported case rather than an edge of it. `rejectCandidates`
// builds one `VALUES` tuple per id into a single statement, and every
// rejection test above passes a one-element array, which never assembles a
// multi-tuple statement at all: a bug in that string would ship green.
//
// The second half pins the idempotency the repo documents. The same sheet can
// be opened and rejected twice, and `INSERT OR IGNORE` against
// UNIQUE(loan_id, transaction_id) is the whole mechanism that keeps the second
// press silent instead of a constraint error the user would be shown.
test("rejecting a whole candidate list silences all of it, and re-rejecting changes nothing", async () => {
  const { loan, paying } = await aLoanWithOnePlausiblePayment();
  const alsoPaying = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 444244,
    direction: "out",
    occurredAt: new Date(2026, 8, 14).getTime(),
    merchant: "GLOAN AUTOPAY",
    source: "manual",
    confidence: 1,
  });

  const before = await findPaymentCandidates(loan.id, NOW);
  expect(before.map((candidate) => candidate.transactionId)).toEqual(
    expect.arrayContaining([paying.id, alsoPaying.id]),
  );

  await rejectCandidates(loan.id, [paying.id, alsoPaying.id]);

  const after = await findPaymentCandidates(loan.id, NOW);
  expect(after.map((candidate) => candidate.transactionId)).not.toContain(paying.id);
  expect(after.map((candidate) => candidate.transactionId)).not.toContain(alsoPaying.id);
  expect((await listRejectedTransactionIds(loan.id)).sort()).toEqual(
    [paying.id, alsoPaying.id].sort(),
  );

  await expect(rejectCandidates(loan.id, [paying.id])).resolves.toBeUndefined();

  expect((await listRejectedTransactionIds(loan.id)).sort()).toEqual(
    [paying.id, alsoPaying.id].sort(),
  );
  const afterRepeat = await findPaymentCandidates(loan.id, NOW);
  expect(afterRepeat.map((candidate) => candidate.transactionId)).toEqual(
    after.map((candidate) => candidate.transactionId),
  );
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

// ---------------------------------------------------------------------------
// Owed-to-me repayments — rules 8(c), 11, 17
// ---------------------------------------------------------------------------

/** A free-form loan to a person, the shape owed-to-me lending actually takes. */
async function lentToBen() {
  return createLoan({
    direction: "owed-to-me",
    counterparty: "Kuya Ben",
    principal: 300000,
    nextDueDate: "2026-09-15",
    nextDueAmount: 100000,
  });
}

test("A PARTIAL REPAYMENT IS OFFERED, not only an exact one", async () => {
  // Spec rule 11 makes partial payments first-class, but rule 8(d) only scores
  // an amount within ±2% of what is due. Informal lending is repaid in bits —
  // under 8(d) alone every real partial scores zero on the amount.
  const loan = await lentToBen();
  const partial = await spend({
    amount: 40000, // ₱400 against ₱1,000 due
    at: new Date(2026, 8, 15).getTime(),
    merchant: null,
    direction: "in",
    walletId: other.id,
  });

  const candidates = await findPaymentCandidates(loan.id, NOW);

  expect(candidates.map((candidate) => candidate.transactionId)).toEqual([partial]);
  expect(candidates[0].reasons).toContain("Could be a partial payment");
});

test("A SMALLER PURCHASE IS NOT A PARTIAL PAYMENT", async () => {
  // The other side of the same rule: below a tenth of what is due, "partial"
  // describes a bus fare as well as it describes a repayment.
  const loan = await lentToBen();
  await spend({
    amount: 2000, // ₱20 against ₱1,000 due
    at: new Date(2026, 8, 15).getTime(),
    merchant: null,
    direction: "in",
    walletId: other.id,
  });

  expect(await findPaymentCandidates(loan.id, NOW)).toEqual([]);
});

test("A PERSON'S NAME MATCHES THE WAY A PROVIDER WRITES IT", async () => {
  // Rule 8(c) read as a literal substring only ever fires for institutions:
  // "GLoan" sits inside "GLOAN PAYMENT", but the user writes "Kuya Ben" and
  // GCash sends "BEN SANTOS". That is why owed-to-me repayments were never
  // suggested while payments to a lender were.
  const loan = await lentToBen();
  const repayment = await spend({
    amount: 40000,
    // Inside the 60-day candidate window but well clear of the due date, so
    // the name and the partial amount are the only signals carrying it.
    at: new Date(2026, 7, 1).getTime(),
    merchant: "BEN SANTOS",
    direction: "in",
    walletId: other.id,
  });

  const candidates = await findPaymentCandidates(loan.id, NOW);

  expect(candidates.map((candidate) => candidate.transactionId)).toEqual([repayment]);
});

test("a shared first name alone is NOT enough to be offered", async () => {
  // A partial name is weaker evidence than a full one and stays under the
  // floor by itself — it still needs a second signal.
  const loan = await lentToBen();
  await spend({
    amount: 999999, // nothing like the amount due, and an overpayment
    at: new Date(2026, 7, 1).getTime(),
    merchant: "BEN SANTOS",
    direction: "in",
    walletId: other.id,
  });

  expect(await findPaymentCandidates(loan.id, NOW)).toEqual([]);
});

test("THE REASONS ARE WORDED FROM THE LOAN'S DIRECTION", async () => {
  // "Paid to Kuya Ben" on a loan Ben is repaying states the opposite of what
  // happened, and the reasons are the whole basis for accepting the match.
  const loan = await lentToBen();
  await spend({
    amount: 100000,
    at: new Date(2026, 8, 15).getTime(),
    merchant: "KUYA BEN",
    direction: "in",
  });

  const [candidate] = await findPaymentCandidates(loan.id, NOW);

  expect(candidate.reasons).toContain("Received from Kuya Ben");
  expect(candidate.reasons.join(" ")).not.toContain("Paid to");
});

test("THE UNFILTERED LIST OFFERS WHAT SCORING MISSED", async () => {
  // The way out when every signal is weak: a repayment the user watched land
  // must be linkable, or their only option is to create a SECOND transaction
  // for money that already moved.
  const loan = await lentToBen();
  const quiet = await spend({
    amount: 2000,
    at: new Date(2026, 8, 15).getTime(),
    merchant: null,
    direction: "in",
    walletId: other.id,
  });

  expect(await findPaymentCandidates(loan.id, NOW)).toEqual([]);
  const all = await findPaymentCandidates(loan.id, NOW, 50, true);
  expect(all.map((candidate) => candidate.transactionId)).toContain(quiet);
});

test("the unfiltered list STILL respects direction and existing matches", async () => {
  // Dropping the score floor drops a ranking, not an invariant.
  const loan = await lentToBen();
  await spend({ amount: 100000, at: new Date(2026, 8, 15).getTime(), merchant: "KUYA BEN" });
  const claimed = await spend({
    amount: 50000,
    at: new Date(2026, 8, 14).getTime(),
    merchant: "KUYA BEN",
    direction: "in",
  });
  await confirmPaymentMatch(loan.id, claimed);

  expect(await findPaymentCandidates(loan.id, NOW, 50, true)).toEqual([]);
});

test("A REPAYMENT IS NOT FILED UNDER THE USER'S OWN DEBT CATEGORY", async () => {
  // Rule 18 names I-owe loans only. Money arriving from a borrower is not a
  // loan payment the user made, and filing it under the category that names
  // their debts is what makes it read as one in the ledger and in Reports.
  const loan = await lentToBen();

  await recordManualPayment({
    loanId: loan.id,
    amount: 50000,
    occurredAt: NOW,
    walletId: cash.id,
  });

  const [recorded] = await listTransactions({ direction: "in" });
  expect(recorded.direction).toBe("in");
  expect(recorded.categoryId).toBe(UNCATEGORIZED_ID);
});

test("a payment on a loan you owe still gets the Utang category", async () => {
  const loan = await gloan();

  await recordManualPayment({
    loanId: loan.id,
    amount: 444244,
    occurredAt: NOW,
    walletId: cash.id,
  });

  const [recorded] = await listTransactions({ direction: "out" });
  expect(recorded.categoryId).toBe("cat_utang_loan_payments");
});
