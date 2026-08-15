// lib/loans/loans_service.ts — loans against the ledger (m2b Task 7;
// docs/04-features/06-loans.md rules 8-11).
//
// MATCHING PROPOSES, NEVER RECORDS. Plan rule 1, and spec rule 9 is stricter
// still: only an explicit provider loan event with an unambiguous single-loan
// mapping may auto-match, and "if two or more open loans are plausible for one
// Transaction, it is always a suggestion listing the candidates — never an
// auto-match." Provider loan events are not modelled yet, so NOTHING here
// auto-matches; every candidate is a suggestion the user confirms.
//
// A wrong auto-match corrupts two numbers at once — the loan balance and, by
// pulling a transaction out of income detection (rule 17), the user's income.
// Neither failure announces itself.
//
// REMINDERS LIVE IN loan_reminders.ts, NOT HERE. `scheduleReminder` reaches
// `expo-notifications` and the `NotificationListener` native module, and this
// module is what a screen calls to draw a list. m2 Task 8 learned that the hard
// way when the Plan tab could not render under Jest.
import { getLoan, listLoans, listPayments, outstandingBalance, recordPayment } from "@/lib/db/repos/loans_repo";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import { startOfLocalDay } from "@/lib/dates";
import type { Centavos, Loan, LoanPayment, Transaction } from "@/types/domain";

import { nextDue } from "./loan_math";

export type LoanStatus = {
  loan: Loan;
  outstanding: Centavos;
  nextDue: { dueDate: string; amount: Centavos } | null;
  overdue: boolean;
  paidCount: number;
};

export type PaymentCandidate = {
  transactionId: string;
  amount: Centavos;
  occurredAt: number;
  merchant: string | null;
  /** 0..1. Above `CANDIDATE_FLOOR` to be offered at all. */
  score: number;
};

const DAY_MS = 86_400_000;

/** How far back to look for a payment the user has not matched yet. */
const CANDIDATE_WINDOW_DAYS = 60;

/**
 * The floor a candidate must clear to be shown. The spec names the SIGNALS
 * (rule 8) but not a number, so this is chosen: it is just above what a lone
 * weak signal scores, which means a transaction has to agree with the loan on
 * at least two counts before the app mentions it. Suggesting everything is the
 * same as suggesting nothing — the user stops reading the list.
 */
const CANDIDATE_FLOOR = 0.35;

/** Spec rule 8's weights, in its own descending order of importance. */
const SIGNAL_WEIGHT = {
  /** (c) counterparty matches the merchant or parsed recipient. */
  counterparty: 0.4,
  /** (d) amount within ±2% of the expected installment. */
  amount: 0.3,
  /** (e) timestamp within 7 days of the due date. */
  timing: 0.2,
  /** (f) the transaction's wallet is the loan's linked wallet. */
  wallet: 0.1,
} as const;

/** Rule 8(d)'s tolerance. */
const AMOUNT_TOLERANCE = 0.02;
/** Rule 8(e)'s window. */
const TIMING_WINDOW_DAYS = 7;

function normalizeName(name: string | null): string {
  return (name ?? "").trim().toUpperCase();
}

/**
 * Which direction of transaction can pay this loan (plan rule 3).
 *
 * Money leaving pays a debt; money arriving repays one owed to you. A direction
 * mismatch is not a weak candidate — it is not a candidate, because counting a
 * salary as a payment on a loan you owe would reduce a debt nobody paid.
 */
function payingDirection(loan: Loan): "in" | "out" {
  return loan.direction === "i-owe" ? "out" : "in";
}

/** Every loan with its balance, next installment and overdue state. */
export async function listLoanStatuses(now: number): Promise<LoanStatus[]> {
  const loans = await listLoans();
  const statuses: LoanStatus[] = [];

  for (const loan of loans) {
    const outstanding = await outstandingBalance(loan.id);
    const payments = await listPayments(loan.id);
    // What the schedule says is next, given how much has been paid against it.
    // A free-form loan has no schedule, so it falls back to whatever the user
    // set by hand (spec rule 1: "nextDueDate/nextDueAmount optional and
    // user-managed").
    const scheduled = nextDue(loan, loan.principal - outstanding);
    const due =
      scheduled ??
      (loan.nextDueDate === null
        ? null
        : { dueDate: loan.nextDueDate, amount: loan.nextDueAmount ?? outstanding });

    statuses.push({
      loan,
      outstanding,
      nextDue: due,
      // Rule 12: "nextDueDate passes without full coverage". Compared in local
      // calendar days, so a loan due today is not overdue at 00:30 — the same
      // rule goals' past-due state keeps.
      overdue:
        due !== null &&
        outstanding > 0 &&
        startOfLocalDay(new Date(`${due.dueDate}T00:00:00`).getTime()) < startOfLocalDay(now),
      paidCount: payments.length,
    });
  }

  return statuses;
}

/**
 * Scores one transaction against one loan, 0..1, using spec rule 8's signals.
 *
 * Signals (a) and (b) — explicit provider loan events and an existing UserRule
 * — are not scored here because neither is modelled yet. When they arrive they
 * belong ABOVE this function, not inside it: (a) is the only signal permitted
 * to auto-match (rule 9), and mixing it into a score would let a merely
 * high-scoring suggestion become one.
 */
function scoreCandidate(
  loan: Loan,
  transaction: Transaction,
  expectedAmount: Centavos | null,
  dueDate: string | null,
): number {
  let score = 0;

  const counterparty = normalizeName(loan.counterparty);
  if (counterparty !== "") {
    const merchant = normalizeName(transaction.merchant);
    const recipient = normalizeName(transaction.counterparty);
    if (merchant.includes(counterparty) || recipient.includes(counterparty)) {
      score += SIGNAL_WEIGHT.counterparty;
    }
  }

  if (expectedAmount !== null && expectedAmount > 0) {
    const drift = Math.abs(transaction.amount - expectedAmount) / expectedAmount;
    if (drift <= AMOUNT_TOLERANCE) score += SIGNAL_WEIGHT.amount;
  }

  if (dueDate !== null) {
    const due = new Date(`${dueDate}T00:00:00`).getTime();
    const days = Math.abs(startOfLocalDay(transaction.occurredAt) - startOfLocalDay(due)) / DAY_MS;
    if (days <= TIMING_WINDOW_DAYS) score += SIGNAL_WEIGHT.timing;
  }

  if (loan.linkedWalletId !== null && transaction.walletId === loan.linkedWalletId) {
    score += SIGNAL_WEIGHT.wallet;
  }

  return score;
}

/**
 * Transactions that might be payments on this loan, best first.
 *
 * EXCLUDES ANYTHING ALREADY MATCHED TO ANY LOAN (plan rule 4). Invariant I12
 * makes one transaction pay at most one loan, so offering a claimed transaction
 * would produce a suggestion the user cannot accept.
 */
export async function findPaymentCandidates(
  loanId: string,
  now: number,
  limit = 5,
): Promise<PaymentCandidate[]> {
  const loan = await getLoan(loanId);
  if (loan === null) return [];

  const outstanding = await outstandingBalance(loanId);
  // A settled loan wants no payments suggested against it.
  if (outstanding <= 0) return [];

  const due = nextDue(loan, loan.principal - outstanding) ?? {
    dueDate: loan.nextDueDate ?? "",
    amount: loan.nextDueAmount ?? 0,
  };

  const transactions = await listTransactions({
    from: now - CANDIDATE_WINDOW_DAYS * DAY_MS,
    to: now + 1,
    direction: payingDirection(loan),
  });

  // One query for every claimed transaction, rather than one per candidate.
  const claimed = new Set(
    (
      await Promise.all((await listLoans()).map((candidate) => listPayments(candidate.id)))
    ).flatMap((payments) => payments.map((payment) => payment.transactionId)),
  );

  return transactions
    .filter((transaction) => !claimed.has(transaction.id))
    .map((transaction) => ({
      transactionId: transaction.id,
      amount: transaction.amount,
      occurredAt: transaction.occurredAt,
      merchant: transaction.merchant ?? null,
      score: scoreCandidate(
        loan,
        transaction,
        due.amount > 0 ? due.amount : null,
        due.dueDate === "" ? null : due.dueDate,
      ),
    }))
    .filter((candidate) => candidate.score >= CANDIDATE_FLOOR)
    .sort((a, b) => b.score - a.score || b.occurredAt - a.occurredAt)
    .slice(0, limit);
}

/**
 * Records the match the user confirmed.
 *
 * This is also what removes the transaction from income detection — loans rule
 * 17: "Transactions matched to an owed-to-me loan are excluded from income
 * cadence detection so that a borrower's regular repayments are never mistaken
 * for a payday." `income_repo.listLoanPaymentTransactionIds` reads the same
 * rows this writes, so the exclusion needs no second bookkeeping.
 */
export async function confirmPaymentMatch(
  loanId: string,
  transactionId: string,
): Promise<LoanPayment> {
  return recordPayment({ loanId, transactionId });
}
