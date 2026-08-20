// lib/db/repos/loans_repo.ts — the only SQL surface for the Loan aggregate
// (interface contract §3; m2b Task 5). Same house shape as wallets_repo.ts.
//
// ---------------------------------------------------------------------------
// The m2b plan's interface for this task cannot be stored, and should not be
// ---------------------------------------------------------------------------
// It specifies `recordPayment({ loanId, amount, paidAt, transactionId?: string
// | null, note? })`. 001_core.sql's `loan_payments` has NO amount, NO paid_at
// and NO note, and its `transaction_id` is NOT NULL UNIQUE — which is domain
// invariant I12 and loans rule 7 ("There are no free-floating payment records")
// written into the schema.
//
// The spec keeps the two cases apart deliberately, and so does this file:
//
//   A PAYMENT references a ledger transaction. Its amount is READ FROM THAT
//   TRANSACTION rather than copied here — a denormalized copy can drift, and
//   then the loan history and the ledger disagree about the same peso.
//
//   A BALANCE ADJUSTMENT is money the app cannot see (rule 13): accrued
//   interest, a lender-side correction, a penalty, or a relative paying the
//   collector directly. It has its own table (migration 005), its own signed
//   amount, and a REQUIRED note, and it shows in history "clearly marked as an
//   adjustment, not a payment".
//
// SETTLED IS DERIVED, NOT STORED. The spec's states table says "Settled |
// Balance ₱0.00", so there is no `closeLoan` here and no column for one —
// exactly as a Goal's Reached is derived from its wallet balance. Rule 6's
// "closing is reversible, because people repay and re-borrow" then costs
// nothing: change the balance and the loan is open again.
import { DEFAULT_LOAN_REMINDER_OFFSETS } from "@/constants/loans";
import { getDatabase } from "@/lib/db/database";
import { newId } from "@/lib/ids";
import type { Centavos, Installment, Loan, LoanDirection, LoanPayment } from "@/types/domain";

export type NewLoan = {
  direction: LoanDirection;
  counterparty: string;
  principal: Centavos;
  /**
   * Percent, informational only (domain §3.8). Spec rule 3 requires the UNIT to
   * be explicit at entry — PH lenders commonly quote monthly add-on rates —
   * which is a screen concern; by the time it reaches here it is whatever the
   * schedule was built from.
   */
  interestRate?: number | null;
  /**
   * The MATERIALIZED installments, or `null` for free-form. `Loan.schedule` is
   * `Installment[] | null` in types/domain.ts, NOT the m2b plan's
   * `{ kind: "amortized" | "flat" | "free-form" }` tagged union — the shipped
   * model stores the schedule Task 6's builders produce, and free-form is the
   * absence of one. A flat schedule is distinguishable by its installments
   * carrying no principal/interest split (spec rule 4: 5-6 "never gets an
   * interest formula").
   */
  schedule?: Installment[] | null;
  linkedWalletId?: string | null;
  nextDueDate?: string | null;
  nextDueAmount?: Centavos | null;
  /**
   * Negative = before `nextDueDate`, positive = after; `[]` turns reminders
   * off (migration 008). Omitted (`undefined`) falls back to
   * `DEFAULT_LOAN_REMINDER_OFFSETS` — a loan that "specifies none" keeps the
   * spec's default three (loans rule 15), same fallback shape as
   * `NewBill.reminderOffsets`.
   */
  reminderOffsets?: number[];
};

export type LoanAdjustment = {
  id: string;
  loanId: string;
  /** SIGNED: positive increases what is owed, negative reduces it. */
  amount: Centavos;
  occurredAt: number;
  note: string;
  createdAt: number;
  updatedAt: number;
};

type LoanRow = {
  id: string;
  direction: string;
  counterparty: string;
  principal: number;
  interest_rate: number | null;
  schedule_json: string | null;
  linked_wallet_id: string | null;
  next_due_date: string | null;
  next_due_amount: number | null;
  reminder_offsets_json: string;
  created_at: number;
  updated_at: number;
  /** 010_soft_delete_and_derived_limits — appended by ALTER TABLE, hence last. */
  archived_at: number | null;
};

/**
 * Ascending (firing order), deduplicated. Same shape as bills_repo.ts's
 * `normalizeOffsets` — kept local rather than shared, matching how each repo
 * file here is otherwise self-contained.
 */
function normalizeOffsets(offsets: number[]): number[] {
  return [...new Set(offsets)].sort((a, b) => a - b);
}

export class LoanNotFoundError extends Error {
  constructor(public readonly loanId: string) {
    super(`loan not found: ${loanId}`);
    this.name = "LoanNotFoundError";
  }
}

/** Invariant I12: a Transaction appears in at most one loan's payment history. */
export class PaymentAlreadyMatchedError extends Error {
  constructor(public readonly transactionId: string) {
    super(`transaction already matched to a loan: ${transactionId}`);
    this.name = "PaymentAlreadyMatchedError";
  }
}

/** Loans rule 13 makes the note required — see `recordAdjustment`. */
export class AdjustmentNoteRequiredError extends Error {
  constructor() {
    super("a balance adjustment needs a note explaining it");
    this.name = "AdjustmentNoteRequiredError";
  }
}

function rowToLoan(row: LoanRow): Loan {
  return {
    id: row.id,
    direction: row.direction as LoanDirection,
    counterparty: row.counterparty,
    principal: row.principal,
    interestRate: row.interest_rate,
    schedule: row.schedule_json === null ? null : (JSON.parse(row.schedule_json) as Installment[]),
    linkedWalletId: row.linked_wallet_id,
    nextDueDate: row.next_due_date,
    nextDueAmount: row.next_due_amount,
    reminderOffsets: JSON.parse(row.reminder_offsets_json) as number[],
    // Added by ALTER TABLE in migration 010, so every loan written before it
    // reads NULL — which is exactly right: nothing was archived before there
    // was a way to archive it.
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createLoan(input: NewLoan): Promise<Loan> {
  const db = await getDatabase();
  const now = Date.now();
  const id = newId();

  await db.runAsync(
    `INSERT INTO loans (id, direction, counterparty, principal, interest_rate, schedule_json,
       linked_wallet_id, next_due_date, next_due_amount, reminder_offsets_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.direction,
      input.counterparty,
      input.principal,
      input.interestRate ?? null,
      input.schedule && input.schedule.length > 0 ? JSON.stringify(input.schedule) : null,
      input.linkedWalletId ?? null,
      input.nextDueDate ?? null,
      input.nextDueAmount ?? null,
      JSON.stringify(normalizeOffsets(input.reminderOffsets ?? DEFAULT_LOAN_REMINDER_OFFSETS)),
      now,
      now,
    ],
  );

  const created = await getLoan(id);
  if (created === null) throw new LoanNotFoundError(id);
  return created;
}

export async function getLoan(id: string): Promise<Loan | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<LoanRow>("SELECT * FROM loans WHERE id = ?", [id]);
  return row ? rowToLoan(row) : null;
}

/**
 * Loans, oldest first, optionally filtered by direction.
 *
 * `includeSettled` defaults to TRUE. The spec's states table keeps a settled
 * loan visible ("Loan moves to a settled list; history retained"), so hiding it
 * by default would lose the history the same sentence promises to keep.
 * Settled means balance ≤ 0, computed the same way `outstandingBalance` does.
 */
export async function listLoans(opts?: {
  direction?: LoanDirection;
  includeSettled?: boolean;
  includeArchived?: boolean;
}): Promise<Loan[]> {
  const db = await getDatabase();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  // ARCHIVED LOANS ARE HIDDEN UNLESS ASKED FOR — the default `listBills`
  // already takes, and a DIFFERENT idea from `includeSettled` right below.
  // Settled means the balance reached zero, which the spec keeps visible in
  // its own list; archived means the user retired the loan on purpose.
  if (opts?.includeArchived !== true) {
    clauses.push("loans.archived_at IS NULL");
  }

  if (opts?.direction !== undefined) {
    clauses.push("loans.direction = ?");
    params.push(opts.direction);
  }

  if (opts?.includeSettled === false) {
    // Mirrors `outstandingBalance`: principal, less every matched payment's
    // ledger amount, plus every signed adjustment.
    clauses.push(`(
      loans.principal
      - COALESCE((
          SELECT SUM(transactions.amount) FROM loan_payments
            JOIN transactions ON transactions.id = loan_payments.transaction_id
           WHERE loan_payments.loan_id = loans.id
        ), 0)
      + COALESCE((
          SELECT SUM(amount) FROM loan_adjustments WHERE loan_adjustments.loan_id = loans.id
        ), 0)
    ) > 0`);
  }

  const rows = await db.getAllAsync<LoanRow>(
    `SELECT loans.* FROM loans${clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY loans.created_at`,
    params,
  );
  return rows.map(rowToLoan);
}

export async function updateLoan(id: string, patch: Partial<NewLoan>): Promise<Loan> {
  const current = await getLoan(id);
  if (current === null) throw new LoanNotFoundError(id);

  // `!== undefined` throughout, so an explicit `null` CLEARS a field — a user
  // who moves a free-form loan off a due date has to be able to say so, and
  // with `??` clearing and not-mentioning would be the same request.
  const merged = {
    direction: patch.direction ?? current.direction,
    counterparty: patch.counterparty ?? current.counterparty,
    principal: patch.principal ?? current.principal,
    interestRate: patch.interestRate !== undefined ? patch.interestRate : current.interestRate,
    schedule: patch.schedule !== undefined ? patch.schedule : current.schedule,
    linkedWalletId:
      patch.linkedWalletId !== undefined ? patch.linkedWalletId : current.linkedWalletId,
    nextDueDate: patch.nextDueDate !== undefined ? patch.nextDueDate : current.nextDueDate,
    nextDueAmount: patch.nextDueAmount !== undefined ? patch.nextDueAmount : current.nextDueAmount,
    // `??`, not `!== undefined`: an explicit `[]` means "turn reminders off"
    // and must stick, exactly as `updateBill` treats its own reminderOffsets —
    // only an omitted patch (`undefined`) falls back to what the loan already
    // had.
    reminderOffsets: normalizeOffsets(patch.reminderOffsets ?? current.reminderOffsets),
  };

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE loans
        SET direction = ?, counterparty = ?, principal = ?, interest_rate = ?, schedule_json = ?,
            linked_wallet_id = ?, next_due_date = ?, next_due_amount = ?, reminder_offsets_json = ?,
            updated_at = ?
      WHERE id = ?`,
    [
      merged.direction,
      merged.counterparty,
      merged.principal,
      merged.interestRate,
      merged.schedule && merged.schedule.length > 0 ? JSON.stringify(merged.schedule) : null,
      merged.linkedWalletId,
      merged.nextDueDate,
      merged.nextDueAmount,
      JSON.stringify(merged.reminderOffsets),
      Date.now(),
      id,
    ],
  );

  const updated = await getLoan(id);
  if (updated === null) throw new LoanNotFoundError(id);
  return updated;
}

/**
 * Retires a loan by setting `archived_at`. IT NEVER DELETES.
 *
 * Owner's report on Plan -> Loans: "unarchivable, softdelete data, no hard
 * delete". Same rule and the same mechanism `archiveBill` already applies to
 * Bills, and for a stronger reason here: `loan_payments` rows point at real
 * ledger Transactions, and a deleted loan would strand its own payment history
 * with nothing to attribute it to.
 *
 * IDEMPOTENT AND SILENT, like `archiveWallet` and `archiveBill` — an unknown or
 * already-archived id is a no-op rather than an error, so a stray double tap
 * cannot produce a crash for a state that already holds.
 */
export async function archiveLoan(id: string): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.runAsync(
    "UPDATE loans SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
    [now, now, id],
  );
}

/**
 * Live loans only — archived ones do not count.
 *
 * WHAT THIS FEEDS: `canCreateLoan` (lib/entitlements.ts) caps the free tier.
 * Counting archived loans would let a user hit that cap with loans they have
 * already retired and give them no way back under it, since nothing is ever
 * deleted.
 */
export async function countLoans(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM loans WHERE archived_at IS NULL",
  );
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Matches a ledger transaction to a loan (spec rules 1-4, 7).
 *
 * The transaction is the payment — there is no separate amount to record. That
 * link is also what keeps a repayment out of the income detector (income rule 1
 * / loans rule 17), through `income_repo.listLoanPaymentTransactionIds`.
 */
export async function recordPayment(input: {
  loanId: string;
  transactionId: string;
}): Promise<LoanPayment> {
  const db = await getDatabase();

  const loan = await db.getFirstAsync<{ id: string }>("SELECT id FROM loans WHERE id = ?", [
    input.loanId,
  ]);
  if (!loan) throw new LoanNotFoundError(input.loanId);

  // Checked before the insert so the caller gets a typed error naming the
  // transaction, rather than "UNIQUE constraint failed: loan_payments.transaction_id".
  const claimed = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM loan_payments WHERE transaction_id = ?",
    [input.transactionId],
  );
  if (claimed) throw new PaymentAlreadyMatchedError(input.transactionId);

  const now = Date.now();
  const id = newId();
  await db.runAsync(
    `INSERT INTO loan_payments (id, loan_id, transaction_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, input.loanId, input.transactionId, now, now],
  );

  return {
    id,
    loanId: input.loanId,
    transactionId: input.transactionId,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A loan's matched payments, oldest first BY WHEN THE MONEY MOVED.
 *
 * Ordered on the transaction's `occurred_at`, not on when the match was
 * recorded: a payment confirmed today can be for a transaction from last month,
 * and a history in confirmation order is unreadable as a repayment record.
 */
export async function listPayments(loanId: string): Promise<LoanPayment[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    loan_id: string;
    transaction_id: string;
    created_at: number;
    updated_at: number;
  }>(
    `SELECT loan_payments.* FROM loan_payments
       JOIN transactions ON transactions.id = loan_payments.transaction_id
      WHERE loan_payments.loan_id = ?
      ORDER BY transactions.occurred_at, loan_payments.created_at`,
    [loanId],
  );

  return rows.map((row) => ({
    id: row.id,
    loanId: row.loan_id,
    transactionId: row.transaction_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Un-matches a payment. Idempotent.
 *
 * NEVER DELETES THE TRANSACTION — the money moved, whatever the matcher thought
 * it was for. This releases the transaction to be matched somewhere else, which
 * is the whole recovery path for a wrong suggestion the user confirmed.
 */
export async function deletePayment(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM loan_payments WHERE id = ?", [id]);
}

// ---------------------------------------------------------------------------
// Balance adjustments — spec rule 13
// ---------------------------------------------------------------------------

/**
 * Records money the app cannot see: accrued interest or fees on a free-form
 * loan, a lender-side correction, a penalty, or a payment made entirely outside
 * tracked money.
 *
 * THE NOTE IS REQUIRED, and a blank one is rejected here rather than by the
 * schema so the error can say why. An adjustment has no ledger entry behind it,
 * so the note is the only record of why a balance moved — without it the user
 * finds an unexplained number months later and cannot tell whether it was a fee
 * or a mistake.
 */
export async function recordAdjustment(input: {
  loanId: string;
  amount: Centavos;
  occurredAt: number;
  note: string;
}): Promise<LoanAdjustment> {
  if (input.note.trim() === "") throw new AdjustmentNoteRequiredError();

  const db = await getDatabase();
  const loan = await db.getFirstAsync<{ id: string }>("SELECT id FROM loans WHERE id = ?", [
    input.loanId,
  ]);
  if (!loan) throw new LoanNotFoundError(input.loanId);

  const now = Date.now();
  const id = newId();
  await db.runAsync(
    `INSERT INTO loan_adjustments (id, loan_id, amount, occurred_at, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.loanId, input.amount, input.occurredAt, input.note.trim(), now, now],
  );

  return {
    id,
    loanId: input.loanId,
    amount: input.amount,
    occurredAt: input.occurredAt,
    note: input.note.trim(),
    createdAt: now,
    updatedAt: now,
  };
}

/** A loan's adjustments, oldest first. */
export async function listAdjustments(loanId: string): Promise<LoanAdjustment[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    loan_id: string;
    amount: number;
    occurred_at: number;
    note: string;
    created_at: number;
    updated_at: number;
  }>("SELECT * FROM loan_adjustments WHERE loan_id = ? ORDER BY occurred_at, created_at", [
    loanId,
  ]);

  return rows.map((row) => ({
    id: row.id,
    loanId: row.loan_id,
    amount: row.amount,
    occurredAt: row.occurred_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

/** Removes an adjustment. Idempotent. */
export async function deleteAdjustment(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM loan_adjustments WHERE id = ?", [id]);
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

/**
 * What is still owed — spec rule 2: principal, less the matched payments, plus
 * any balance adjustments.
 *
 * FLOORED AT ZERO (plan rule 5). A negative balance renders as the lender owing
 * the user money, which is a different loan.
 */
export async function outstandingBalance(loanId: string): Promise<Centavos> {
  const db = await getDatabase();

  const loan = await db.getFirstAsync<{ principal: number }>(
    "SELECT principal FROM loans WHERE id = ?",
    [loanId],
  );
  if (!loan) throw new LoanNotFoundError(loanId);

  const paid = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(transactions.amount), 0) AS total FROM loan_payments
       JOIN transactions ON transactions.id = loan_payments.transaction_id
      WHERE loan_payments.loan_id = ?`,
    [loanId],
  );
  const adjusted = await db.getFirstAsync<{ total: number }>(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM loan_adjustments WHERE loan_id = ?",
    [loanId],
  );

  return Math.max(0, loan.principal - (paid?.total ?? 0) + (adjusted?.total ?? 0));
}
