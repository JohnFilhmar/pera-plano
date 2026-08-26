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
import {
  getLoan,
  listAdjustments,
  listLoans,
  listPayments,
  LoanNotFoundError,
  outstandingBalance,
  recordPayment,
} from "@/lib/db/repos/loans_repo";
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import {
  getTransaction,
  insertTransaction,
  listTransactions,
} from "@/lib/db/repos/transactions_repo";
import { withUnitOfWork } from "@/lib/db/unit_of_work";
import { startOfLocalDay } from "@/lib/dates";
import type {
  Centavos,
  EpochMs,
  Loan,
  LoanPayment,
  Transaction,
  TxDirection,
} from "@/types/domain";

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
  /**
   * The other party the parser read off the notification — the SENDER on an
   * inbound transfer, which is the only name an owed-to-me repayment carries.
   * A provider's receive template captures a `counterparty` and no `merchant`
   * (see assets/parser_rules/seed.json), so a sheet keyed on `merchant` alone
   * labels every repayment "Unknown" — unusable in the browse-everything list,
   * where the name is what the user is scanning for.
   */
  counterparty: string | null;
  /** 0..1. Above `CANDIDATE_FLOOR` to be offered at all. */
  score: number;
  /**
   * WHY this transaction was offered, in the user's words. Not in the m2b
   * plan's type, and its own Task 8 rule 5 needs it: the match sheet shows each
   * candidate "with its amount, date, and WHY IT MATCHED". A bare score is not
   * a reason — it asks the user to trust a number they cannot check, on a
   * decision that moves their loan balance.
   */
  reasons: string[];
};

const DAY_MS = 86_400_000;

/** Loans rule 18's default category for a payment the app creates itself. */
const UTANG_CATEGORY_ID = "cat_utang_loan_payments";

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

/**
 * A NAME FRAGMENT IS WORTH LESS THAN THE WHOLE NAME, but it is not worth
 * nothing.
 *
 * Rule 8(c) says "`counterparty` matching the Transaction `merchant` or parsed
 * recipient", and a literal substring test reads that as an institution's
 * name: "GLoan" appears verbatim inside "GLOAN PAYMENT". A PERSON does not
 * survive the trip — the user writes "Kuya Ben" and GCash sends "BEN SANTOS",
 * so the one signal carrying 0.4 of the score never fires for owed-to-me
 * loans, which are lending to people almost by definition. That is why
 * repayments from a borrower were never suggested while payments to a lender
 * were: not a direction bug, a name-shape bug that only bites one direction.
 *
 * Below the full weight because a shared first name is genuinely weaker
 * evidence than a full match: on its own it stays under `CANDIDATE_FLOOR` and
 * still needs a second signal to be offered at all.
 */
const PARTIAL_NAME_WEIGHT = 0.25;

/**
 * What a PARTIAL payment is worth (spec rule 11: "a partial payment reduces
 * the outstanding `nextDueAmount` remainder without advancing the date").
 *
 * Rule 8(d) only scores an amount within ±2% of what is due, which is a
 * scheduled installment landing in full. Informal lending does not work that
 * way — a borrower sends ₱500 against ₱2,000 whenever they have it — so under
 * 8(d) alone every real partial repayment scores zero on the one signal the
 * user can most easily verify. Worth less than an exact match, deliberately:
 * any smaller outflow is arithmetically a "partial" of something.
 */
const PARTIAL_AMOUNT_WEIGHT = 0.15;

/**
 * The smallest share of what is due that still reads as a payment rather than
 * as an unrelated purchase that happens to be smaller. A tenth: below that,
 * "partial payment" describes a bus fare as well as it describes a repayment.
 */
const MIN_PARTIAL_SHARE = 0.1;

/**
 * Words that identify a RELATIONSHIP rather than a person, so they can never
 * appear in a provider's transfer text. The user labels a loan "Kuya Ben" or
 * "Tita Mercy" because that is who the person is to them; the bank only knows
 * "BEN SANTOS". Left in, "KUYA" is a token that matches nothing and drags no
 * weight — dropped, "BEN" is the token that does the work.
 */
const RELATIONSHIP_WORDS = new Set([
  "KUYA",
  "ATE",
  "TITO",
  "TITA",
  "LOLO",
  "LOLA",
  "NANAY",
  "TATAY",
  "MAMA",
  "PAPA",
  "INAY",
  "ITAY",
  "SIR",
  "MAAM",
  "MAM",
  "MR",
  "MRS",
  "MS",
]);

/** The shortest token worth comparing — below this, initials collide with everything. */
const MIN_TOKEN_LENGTH = 3;

function normalizeName(name: string | null): string {
  return (name ?? "").trim().toUpperCase();
}

/**
 * The comparable words in a name: uppercase, punctuation and provider masking
 * removed, relationship words and initials dropped.
 */
function nameTokens(name: string): string[] {
  return name
    .replace(/[^A-Z0-9]+/gu, " ")
    .split(" ")
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !RELATIONSHIP_WORDS.has(token));
}

/** One token matches another when either is the other's prefix — "SANTOS" answers "SANTOS JR". */
function tokenMatches(left: string, right: string): boolean {
  return left.startsWith(right) || right.startsWith(left);
}

/**
 * How strongly a transaction's name fields identify this loan's counterparty:
 * `full` for the whole name, `partial` for some of it, `none` otherwise.
 *
 * Checked against the merchant AND the parsed counterparty, because a provider
 * writes the other party into whichever of the two its template captured — an
 * outbound GCash transfer names a recipient, an inbound one names a sender,
 * and rule 8(c) means both.
 */
function nameStrength(
  loanCounterparty: string,
  transaction: Transaction,
): "full" | "partial" | "none" {
  const loanName = normalizeName(loanCounterparty);
  if (loanName === "") return "none";

  const fields = [normalizeName(transaction.merchant), normalizeName(transaction.counterparty)]
    .filter((field) => field !== "");
  if (fields.length === 0) return "none";

  // Containment EITHER WAY. "GLOAN PAYMENT" contains the loan's "GLoan", and a
  // loan written "Ben Santos Jr" contains a transaction's "BEN SANTOS".
  if (fields.some((field) => field.includes(loanName) || loanName.includes(field))) return "full";

  const loanTokens = nameTokens(loanName);
  if (loanTokens.length === 0) return "none";

  const fieldTokens = fields.flatMap((field) => nameTokens(field));
  const matched = loanTokens.filter((token) =>
    fieldTokens.some((other) => tokenMatches(token, other)),
  );

  if (matched.length === 0) return "none";
  // Every word of a MULTI-WORD name accounted for is the same evidence as the
  // whole string matching — only the word order or a middle name differed. A
  // single word is not: "Kuya Ben" reduces to the one token "BEN", and half
  // the country has a Ben. That stays `partial`, which on its own sits under
  // `CANDIDATE_FLOOR` and needs a second signal before it is offered.
  return matched.length === loanTokens.length && loanTokens.length >= 2 ? "full" : "partial";
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
  outstanding: Centavos,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Worded from the LOAN'S DIRECTION. "Paid to Kuya Ben" on a loan Ben is
  // repaying states the opposite of what happened, and the reasons list is the
  // whole basis on which the user decides whether to accept the match.
  const nameReason =
    loan.direction === "i-owe"
      ? `Paid to ${loan.counterparty}`
      : `Received from ${loan.counterparty}`;

  switch (nameStrength(loan.counterparty, transaction)) {
    case "full":
      score += SIGNAL_WEIGHT.counterparty;
      reasons.push(nameReason);
      break;
    case "partial":
      score += PARTIAL_NAME_WEIGHT;
      reasons.push(`${nameReason} — name partly matches`);
      break;
    default:
      break;
  }

  // The figure a payment is measured against: what is due if there is a
  // schedule or a user-set next due, otherwise the whole outstanding balance —
  // a free-form utang has no installment, and without this fallback the amount
  // signal simply never fires for the loans most likely to be repaid in bits.
  const ceiling = expectedAmount !== null && expectedAmount > 0 ? expectedAmount : outstanding;

  if (ceiling > 0) {
    const drift = Math.abs(transaction.amount - ceiling) / ceiling;
    if (drift <= AMOUNT_TOLERANCE) {
      score += SIGNAL_WEIGHT.amount;
      reasons.push(expectedAmount === null ? "Settles the balance" : "Matches the amount due");
    } else if (
      transaction.amount < ceiling &&
      transaction.amount >= Math.round(ceiling * MIN_PARTIAL_SHARE)
    ) {
      // Spec rule 11's partial: less than what is owed, but enough of it to be
      // a payment rather than an unrelated smaller purchase.
      score += PARTIAL_AMOUNT_WEIGHT;
      reasons.push("Could be a partial payment");
    }
  }

  if (dueDate !== null) {
    const due = new Date(`${dueDate}T00:00:00`).getTime();
    const days = Math.abs(startOfLocalDay(transaction.occurredAt) - startOfLocalDay(due)) / DAY_MS;
    if (days <= TIMING_WINDOW_DAYS) {
      score += SIGNAL_WEIGHT.timing;
      reasons.push("Around the due date");
    }
  }

  if (loan.linkedWalletId !== null && transaction.walletId === loan.linkedWalletId) {
    score += SIGNAL_WEIGHT.wallet;
    reasons.push("From this loan's usual account");
  }

  return { score, reasons };
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
  /**
   * Drops `CANDIDATE_FLOOR` and returns every unclaimed transaction that could
   * pay this loan, scored but unfiltered — what the match sheet's "Show every
   * transaction" fallback lists.
   *
   * THE FLOOR IS RIGHT FOR A SUGGESTION AND WRONG FOR A SEARCH. Scoring exists
   * so the app does not volunteer noise, but a user who is looking at a
   * repayment they know arrived needs to be able to point at it — and the
   * signals are exactly weakest for the case they most often have: a partial
   * amount from a person, on a free-form utang with no due date. Without this,
   * the only way to record it is to create a SECOND transaction for money that
   * already moved.
   */
  includeBelowFloor = false,
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
      counterparty: transaction.counterparty ?? null,
      ...scoreCandidate(
        loan,
        transaction,
        due.amount > 0 ? due.amount : null,
        due.dueDate === "" ? null : due.dueDate,
        outstanding,
      ),
    }))
    .filter((candidate) => includeBelowFloor || candidate.score >= CANDIDATE_FLOOR)
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

/**
 * The spec's "Record payment" flow (loans, flow §Record a payment, step 2):
 * "The app creates a `source: manual` Transaction in that Wallet (direction
 * `out` for I-owe, `in` for owed-to-me), categorized Utang & Loan Payments,
 * and appends it to `paymentHistory[]`."
 *
 * BOTH WRITES OR NEITHER. A transaction created without its loan link is a
 * mystery outflow in the ledger AND a loan that still looks unpaid — the user
 * would record the payment twice trying to fix it.
 *
 * The category is applied because this transaction is BEING CREATED here; rule
 * 18's "never overwrites a category the user set by hand" is about MATCHING an
 * existing transaction, which `confirmPaymentMatch` does and deliberately does
 * not recategorize.
 */
export async function recordManualPayment(input: {
  loanId: string;
  amount: Centavos;
  occurredAt: number;
  walletId: string;
}): Promise<LoanPayment> {
  const loan = await getLoan(input.loanId);
  if (loan === null) throw new LoanNotFoundError(input.loanId);

  return withUnitOfWork(async () => {
    const transaction = await insertTransaction({
      walletId: input.walletId,
      // RULE 18 IS ABOUT I-OWE ONLY: "Payments on I-owe loans default to the
      // Utang & Loan Payments category". Money ARRIVING from a borrower is not
      // a loan payment the user made, and filing it under the category that
      // names their own debts is what makes an owed-to-me repayment read, in
      // the ledger and in Reports, as if they had paid something.
      categoryId: loan.direction === "i-owe" ? UTANG_CATEGORY_ID : UNCATEGORIZED_ID,
      amount: input.amount,
      direction: payingDirection(loan),
      occurredAt: input.occurredAt,
      merchant: loan.counterparty,
      source: "manual",
      confidence: 1,
    });
    return recordPayment({ loanId: input.loanId, transactionId: transaction.id });
  });
}

// ---------------------------------------------------------------------------
// History — spec rules 7 and 13
// ---------------------------------------------------------------------------

/**
 * One line in a loan's history. Rule 7: "Every `paymentHistory[]` entry
 * references either a ledger Transaction (matched or manually created) or a
 * balance adjustment (Rule 13). There are no free-floating payment records."
 *
 * A DISCRIMINATED UNION, NOT ONE WIDENED ROW WITH NULLABLE EXTRAS, because
 * rule 13 requires the screen to mark an adjustment "clearly ... as an
 * adjustment, not a payment" — and a shape where the two are told apart only by
 * which optional fields happen to be filled in is a shape where a renderer can
 * silently forget to check. `kind` makes the distinction the first thing the
 * type system asks about, so the marking cannot be dropped by accident.
 */
export type LoanHistoryEntry =
  | {
      kind: "payment";
      /** The `loan_payments` row id, not the transaction's. */
      id: string;
      occurredAt: EpochMs;
      /** Always positive — the ledger stores magnitude and sign separately. */
      amount: Centavos;
      /** `out` on an I-owe loan, `in` on an owed-to-me one (rules 7 and 17). */
      direction: TxDirection;
      transactionId: string;
      walletId: string;
    }
  | {
      kind: "adjustment";
      id: string;
      occurredAt: EpochMs;
      /** SIGNED: positive increases what is owed, negative reduces it. */
      amount: Centavos;
      /** Required by rule 13, and the only record of WHY the balance moved. */
      note: string;
    };

/**
 * A loan's payments and balance adjustments as one list, NEWEST FIRST.
 *
 * THE ORDER IS DELIBERATELY THE REVERSE OF THE REPOSITORY'S. `listPayments`
 * and `listAdjustments` both return oldest first, and for storage that is the
 * right answer — a repayment record read end to end has to run forwards. A
 * SCREEN is a different question: the user opens a loan to check the thing that
 * just happened, and on a 5-6 loan collected weekly for a year that entry is
 * forty rows down. Reversed here rather than inside the component so the
 * ordering and the reason for it stay next to the merge that produced it.
 *
 * A PAYMENT WHOSE TRANSACTION IS GONE IS DROPPED, not rendered as a blank or a
 * zero. `deletePayment`'s own header is explicit that un-matching never touches
 * the transaction, so `deleteTransaction` is the only way a row can vanish from
 * under a still-live link — and the honest thing to show for it is nothing,
 * rather than a payment line with no amount that the balance beside it does not
 * count either (`outstandingBalance` joins through the same transaction and
 * skips it for the same reason).
 */
export async function listLoanHistory(loanId: string): Promise<LoanHistoryEntry[]> {
  const [payments, adjustments] = await Promise.all([
    listPayments(loanId),
    listAdjustments(loanId),
  ]);

  const entries: LoanHistoryEntry[] = [];

  for (const payment of payments) {
    const transaction = await getTransaction(payment.transactionId);
    if (transaction === null) continue;
    entries.push({
      kind: "payment",
      id: payment.id,
      occurredAt: transaction.occurredAt,
      amount: transaction.amount,
      direction: transaction.direction,
      transactionId: transaction.id,
      walletId: transaction.walletId,
    });
  }

  for (const adjustment of adjustments) {
    entries.push({
      kind: "adjustment",
      id: adjustment.id,
      occurredAt: adjustment.occurredAt,
      amount: adjustment.amount,
      note: adjustment.note,
    });
  }

  // Ties are broken on `id` so the order is TOTAL rather than merely sorted.
  // Two entries genuinely can share an instant — a back-dated manual payment
  // and an adjustment on the same day both land on the start of that local day
  // — and an unstable comparator lets them swap places between renders, which
  // reads on screen as a list flickering for no reason the user can see.
  return entries.sort(
    (left, right) => right.occurredAt - left.occurredAt || left.id.localeCompare(right.id),
  );
}
