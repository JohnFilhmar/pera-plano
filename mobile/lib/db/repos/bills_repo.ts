// lib/db/repos/bills_repo.ts — the only SQL surface for the Bill aggregate
// (interface contract §3; m2c Task 1). Same house shape as loans_repo.ts.
//
// ---------------------------------------------------------------------------
// A CYCLE IS NOT A PAYMENT
// ---------------------------------------------------------------------------
// 001_core's `bill_payments` says exactly one thing: this cycle was paid, by
// this ledger transaction, and `transaction_id` is NOT NULL UNIQUE (invariant
// I12, spec rule 17). That is right for what it is and it is left untouched.
//
// But docs/04-features/07-bills.md needs an OCCURRENCE to be a thing of its
// own — it can be skipped (rule 21), resolved with no ledger entry at all (the
// mark-paid flow's "Paid outside my wallets"), carry an overdue-notification
// count capped at three (rule 22), and sit open alongside a second open cycle
// of the same bill (rule 25). Migration 006 adds `bill_cycles` for that, and a
// cycle points AT a payment when one exists.
//
// AN UNRESOLVED CYCLE HAS NO ROW. Openness is the absence of a row: a bill
// running for four years should not carry fifty rows recording that nothing
// happened, and the due-rule engine (Task 2) is what enumerates which dates
// exist in the first place. The one exception is an overdue count — that has
// to be stored somewhere before the cycle is resolved, so `recordOverdueNotice`
// creates the row early and leaves it unresolved.
//
// ---------------------------------------------------------------------------
// Deviations from the m2c plan's stated interface, and why
// ---------------------------------------------------------------------------
//   `recordBillPayment({ ..., amount, paidAt })` — `bill_payments` has neither
//   column. The amount is READ FROM THE LINKED TRANSACTION, exactly as loan
//   payments are: a denormalized copy drifts, and then the bill history and the
//   ledger disagree about the same peso.
//
//   `NewBill.walletId` / `NewBill.note` — `bills` has no column for either, and
//   the spec never asks a bill to name a wallet (the mark-paid flow picks one
//   at payment time, per payment).
//
//   `DueRule` kinds — the plan writes snake_case kinds and an `every_n_days`
//   variant the spec's own due-rule table does not contain. types/domain.ts is
//   contract-pinned and wins.
//
//   `reminderOffsetsDays` counting positive days before — types/domain.ts pins
//   "negative = before (e.g., [-3, 0])". Stored ascending, which is FIRING
//   order.
import { DEFAULT_BILL_CATEGORY_ID, DEFAULT_REMINDER_OFFSETS } from "@/constants/bills";
import { getDatabase } from "@/lib/db/database";
import { newId } from "@/lib/ids";
import type {
  Bill,
  BillAmountMode,
  BillAutoMatchRule,
  BillCycle,
  BillCycleState,
  BillPayment,
  Centavos,
  DueRule,
  IsoDate,
} from "@/types/domain";


export type NewBill = {
  name: string;
  /** For an estimated bill this is the SEED — spec rule 6's "initial figure". */
  amount: Centavos;
  amountMode: BillAmountMode;
  dueRule: DueRule;
  /** Negative = days before the adjusted due date; `0` = on it. */
  reminderOffsets?: number[];
  autoMatchRule?: BillAutoMatchRule | null;
  categoryId?: string;
};

type BillRow = {
  id: string;
  name: string;
  amount: number;
  amount_mode: string;
  due_rule_json: string;
  reminder_offsets_json: string;
  auto_match_rule_json: string | null;
  category_id: string;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};

type BillPaymentRow = {
  id: string;
  bill_id: string;
  transaction_id: string;
  cycle_due_date: string;
  created_at: number;
  updated_at: number;
};

type BillCycleRow = {
  id: string;
  bill_id: string;
  due_date: string;
  state: string;
  bill_payment_id: string | null;
  overdue_notices_sent: number;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
};

export class BillNotFoundError extends Error {
  constructor(public readonly billId: string) {
    super(`bill not found: ${billId}`);
    this.name = "BillNotFoundError";
  }
}

/** Invariant I12 / spec rule 17: one transaction settles at most one cycle. */
export class TransactionAlreadySettledError extends Error {
  constructor(public readonly transactionId: string) {
    super(`transaction already settles a bill cycle: ${transactionId}`);
    this.name = "TransactionAlreadySettledError";
  }
}

/**
 * A resolved cycle is not silently overwritten. Skipping a cycle that was
 * already paid, or paying one already skipped, is a CORRECTION — the caller
 * has to reopen it first, so the undo is deliberate and visible.
 */
export class CycleAlreadyResolvedError extends Error {
  constructor(
    public readonly billId: string,
    public readonly dueDate: IsoDate,
    public readonly state: BillCycleState,
  ) {
    super(`bill cycle ${billId} ${dueDate} is already ${state}`);
    this.name = "CycleAlreadyResolvedError";
  }
}

/**
 * Ascending (firing order), deduplicated. `[0, -3, -7, -3]` becomes
 * `[-7, -3, 0]`: the seven-day warning fires first and the due-date one last.
 */
function normalizeOffsets(offsets: number[]): number[] {
  return [...new Set(offsets)].sort((a, b) => a - b);
}

function rowToBill(row: BillRow): Bill {
  return {
    id: row.id,
    name: row.name,
    amount: row.amount,
    amountMode: row.amount_mode as BillAmountMode,
    dueRule: JSON.parse(row.due_rule_json) as DueRule,
    reminderOffsets: JSON.parse(row.reminder_offsets_json) as number[],
    autoMatchRule:
      row.auto_match_rule_json === null
        ? null
        : (JSON.parse(row.auto_match_rule_json) as BillAutoMatchRule),
    categoryId: row.category_id,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPayment(row: BillPaymentRow): BillPayment {
  return {
    id: row.id,
    billId: row.bill_id,
    transactionId: row.transaction_id,
    cycleDueDate: row.cycle_due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCycle(row: BillCycleRow): BillCycle {
  return {
    id: row.id,
    billId: row.bill_id,
    dueDate: row.due_date,
    state: row.state as BillCycleState,
    billPaymentId: row.bill_payment_id,
    overdueNoticesSent: row.overdue_notices_sent,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------
export async function createBill(input: NewBill): Promise<Bill> {
  const db = await getDatabase();
  const now = Date.now();
  const id = newId();

  await db.runAsync(
    `INSERT INTO bills (id, name, amount, amount_mode, due_rule_json, reminder_offsets_json,
       auto_match_rule_json, category_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.amount,
      input.amountMode,
      JSON.stringify(input.dueRule),
      JSON.stringify(normalizeOffsets(input.reminderOffsets ?? DEFAULT_REMINDER_OFFSETS)),
      input.autoMatchRule ? JSON.stringify(input.autoMatchRule) : null,
      input.categoryId ?? DEFAULT_BILL_CATEGORY_ID,
      now,
      now,
    ],
  );

  const created = await getBill(id);
  if (created === null) throw new BillNotFoundError(id);
  return created;
}

export async function getBill(id: string): Promise<Bill | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<BillRow>("SELECT * FROM bills WHERE id = ?", [id]);
  return row ? rowToBill(row) : null;
}

/**
 * Bills, oldest first. Archived ones are hidden by default — unlike a settled
 * loan, which the spec keeps in a visible settled list, an archived bill has
 * been switched off on purpose and its only remaining job is feeding the
 * estimator (spec rule 27: history and linked transactions are untouched).
 */
export async function listBills(opts?: { includeArchived?: boolean }): Promise<Bill[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<BillRow>(
    `SELECT * FROM bills${opts?.includeArchived === true ? "" : " WHERE archived_at IS NULL"}
      ORDER BY created_at`,
  );
  return rows.map(rowToBill);
}

export async function updateBill(id: string, patch: Partial<NewBill>): Promise<Bill> {
  const current = await getBill(id);
  if (current === null) throw new BillNotFoundError(id);

  // `!== undefined` for the nullable field, so an explicit `null` CLEARS it: a
  // user who rejects every keyword has to be able to turn matching off, and
  // with `??` merging, clearing and not-mentioning would be the same request.
  const merged = {
    name: patch.name ?? current.name,
    amount: patch.amount ?? current.amount,
    amountMode: patch.amountMode ?? current.amountMode,
    dueRule: patch.dueRule ?? current.dueRule,
    reminderOffsets: normalizeOffsets(patch.reminderOffsets ?? current.reminderOffsets),
    autoMatchRule: patch.autoMatchRule !== undefined ? patch.autoMatchRule : current.autoMatchRule,
    categoryId: patch.categoryId ?? current.categoryId,
  };

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE bills
        SET name = ?, amount = ?, amount_mode = ?, due_rule_json = ?, reminder_offsets_json = ?,
            auto_match_rule_json = ?, category_id = ?, updated_at = ?
      WHERE id = ?`,
    [
      merged.name,
      merged.amount,
      merged.amountMode,
      JSON.stringify(merged.dueRule),
      JSON.stringify(merged.reminderOffsets),
      merged.autoMatchRule ? JSON.stringify(merged.autoMatchRule) : null,
      merged.categoryId,
      Date.now(),
      id,
    ],
  );

  const updated = await getBill(id);
  if (updated === null) throw new BillNotFoundError(id);
  return updated;
}

/**
 * Spec rule 27: stops future cycles, reminders and matching; history and linked
 * transactions are untouched. There is no hard delete here — history feeds the
 * estimator, and rule 27's own "never deletes or alters any ledger Transaction"
 * is easiest to guarantee by not removing the rows that point at them.
 */
export async function archiveBill(id: string): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.runAsync("UPDATE bills SET archived_at = ?, updated_at = ? WHERE id = ?", [
    now,
    now,
    id,
  ]);
}

/**
 * Puts an archived bill back. The exact inverse of `archiveBill`: it clears
 * `archived_at` and nothing else.
 *
 * WHY THIS HAS TO EXIST. Every plan entity could be archived and none could be
 * restored — no repository function, no hook, no screen — so "archive" was a
 * one-way door that the wording ("retire", "stop watching") never claimed to
 * be. A user who archived the wrong row had no way back to it, and because the
 * archive deliberately never deletes, the row sat there unreachable.
 *
 * IDEMPOTENT AND SILENT, matching the archive side: an unknown or
 * already-active id is a no-op rather than an error, since a caller retrying is
 * asking for a state that already holds.
 *
 * `updated_at` moves because the row did change. Nothing else is touched — the
 * history this entity explains was never removed, so there is nothing to
 * rebuild.
 */
export async function unarchiveBill(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE bills SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL",
    [Date.now(), id],
  );
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------
export async function getCycle(billId: string, dueDate: IsoDate): Promise<BillCycle | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<BillCycleRow>(
    "SELECT * FROM bill_cycles WHERE bill_id = ? AND due_date = ?",
    [billId, dueDate],
  );
  return row ? rowToCycle(row) : null;
}

/** Every cycle this bill has a row for, chronological. */
export async function listCycles(billId: string): Promise<BillCycle[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<BillCycleRow>(
    "SELECT * FROM bill_cycles WHERE bill_id = ? ORDER BY due_date",
    [billId],
  );
  return rows.map(rowToCycle);
}

/**
 * Inserts an unresolved placeholder row, or returns the existing one. Only two
 * callers need this: `recordOverdueNotice`, which has a count to store before
 * the cycle is resolved, and the resolvers below.
 */
async function ensureCycleRow(billId: string, dueDate: IsoDate): Promise<BillCycleRow> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<BillCycleRow>(
    "SELECT * FROM bill_cycles WHERE bill_id = ? AND due_date = ?",
    [billId, dueDate],
  );
  if (existing) return existing;

  const now = Date.now();
  const id = newId();
  await db.runAsync(
    `INSERT INTO bill_cycles (id, bill_id, due_date, state, bill_payment_id,
       overdue_notices_sent, resolved_at, created_at, updated_at)
     VALUES (?, ?, ?, 'open', NULL, 0, NULL, ?, ?)`,
    [id, billId, dueDate, now, now],
  );
  const created = await db.getFirstAsync<BillCycleRow>(
    "SELECT * FROM bill_cycles WHERE id = ?",
    [id],
  );
  if (!created) throw new BillNotFoundError(billId);
  return created;
}

/**
 * A row exists for two different reasons — it was RESOLVED, or it is merely
 * carrying an overdue count while still open (spec rule 23: an overdue cycle
 * stays open until the user acts). `'open'` is the second case, and it is a
 * state of its own precisely so no query mistakes it for a skip.
 */
function isResolved(row: BillCycleRow): boolean {
  return row.state !== "open";
}

async function resolveCycle(
  billId: string,
  dueDate: IsoDate,
  state: BillCycleState,
  billPaymentId: string | null,
): Promise<BillCycle> {
  const row = await ensureCycleRow(billId, dueDate);
  if (isResolved(row)) {
    throw new CycleAlreadyResolvedError(billId, dueDate, row.state as BillCycleState);
  }

  const db = await getDatabase();
  const now = Date.now();
  await db.runAsync(
    `UPDATE bill_cycles SET state = ?, bill_payment_id = ?, resolved_at = ?, updated_at = ?
      WHERE id = ?`,
    [state, billPaymentId, now, now, row.id],
  );

  const resolved = await getCycle(billId, dueDate);
  if (resolved === null) throw new BillNotFoundError(billId);
  return resolved;
}

/**
 * The spec's skip flow: "no payment expected, excluded from estimate updates,
 * removed from Safe-to-Spend". A promo month, an advance payment, a landlord
 * waiving rent.
 */
export async function skipCycle(input: {
  billId: string;
  dueDate: IsoDate;
}): Promise<BillCycle> {
  return resolveCycle(input.billId, input.dueDate, "skipped", null);
}

/**
 * The mark-paid flow's "Paid outside my wallets" — someone else paid, or the
 * money never touched a tracked wallet. DISTINCT FROM A SKIP: money was owed
 * and was paid, so this cycle counts as met; it simply has no transaction, and
 * therefore nothing for the estimator to learn from.
 */
export async function resolveCycleExternally(input: {
  billId: string;
  dueDate: IsoDate;
}): Promise<BillCycle> {
  return resolveCycle(input.billId, input.dueDate, "resolved_external", null);
}

/**
 * Bumps and returns this cycle's overdue-notification count (spec rule 22 caps
 * escalation at three). Counted here rather than derived from queued
 * notification ids because the OS forgets those across a reinstall, and the
 * user must not collect three fresh naggings every time they reinstall.
 *
 * Does NOT resolve the cycle — an overdue cycle stays open until the user pays,
 * skips or edits it (rule 23).
 */
export async function recordOverdueNotice(billId: string, dueDate: IsoDate): Promise<number> {
  const row = await ensureCycleRow(billId, dueDate);
  const db = await getDatabase();
  const next = row.overdue_notices_sent + 1;
  await db.runAsync(
    "UPDATE bill_cycles SET overdue_notices_sent = ?, updated_at = ? WHERE id = ?",
    [next, Date.now(), row.id],
  );
  return next;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
/**
 * Links a ledger transaction to a cycle and marks that cycle paid — two writes
 * in one unit of work, because a payment row without its cycle is a bill that
 * still looks unpaid, and a paid cycle without its payment is forbidden by the
 * schema's own CHECK.
 *
 * Recording again for the same due date UPDATES the existing payment (plan rule
 * 1: "paying the same occurrence twice is a correction, not a second payment").
 * The previously linked transaction is released, never deleted — the money
 * moved regardless of what the matcher thought it was for.
 */
export async function recordBillPayment(input: {
  billId: string;
  dueDate: IsoDate;
  transactionId: string;
}): Promise<BillPayment> {
  const db = await getDatabase();

  const claimed = await db.getFirstAsync<{ bill_id: string; cycle_due_date: string }>(
    "SELECT bill_id, cycle_due_date FROM bill_payments WHERE transaction_id = ?",
    [input.transactionId],
  );
  if (
    claimed &&
    !(claimed.bill_id === input.billId && claimed.cycle_due_date === input.dueDate)
  ) {
    throw new TransactionAlreadySettledError(input.transactionId);
  }

  const existing = await db.getFirstAsync<BillPaymentRow>(
    "SELECT * FROM bill_payments WHERE bill_id = ? AND cycle_due_date = ?",
    [input.billId, input.dueDate],
  );
  const now = Date.now();

  if (existing) {
    // A correction. The cycle is already paid and stays paid — only which
    // transaction paid it changes.
    await db.runAsync("UPDATE bill_payments SET transaction_id = ?, updated_at = ? WHERE id = ?", [
      input.transactionId,
      now,
      existing.id,
    ]);
    const updated = await db.getFirstAsync<BillPaymentRow>(
      "SELECT * FROM bill_payments WHERE id = ?",
      [existing.id],
    );
    if (!updated) throw new BillNotFoundError(input.billId);
    return rowToPayment(updated);
  }

  const id = newId();
  await db.runAsync(
    `INSERT INTO bill_payments (id, bill_id, transaction_id, cycle_due_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.billId, input.transactionId, input.dueDate, now, now],
  );
  await resolveCycle(input.billId, input.dueDate, "paid", id);

  const created = await db.getFirstAsync<BillPaymentRow>(
    "SELECT * FROM bill_payments WHERE id = ?",
    [id],
  );
  if (!created) throw new BillNotFoundError(input.billId);
  return rowToPayment(created);
}

/**
 * Ordered by the CYCLE, not by when the match was confirmed. A payment
 * confirmed today can belong to a cycle three months old, and the estimator
 * wants the last three cycles (spec rule 6) — a history in confirmation order
 * is unreadable as a payment record.
 */
export async function listBillPayments(billId: string): Promise<BillPayment[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<BillPaymentRow>(
    "SELECT * FROM bill_payments WHERE bill_id = ? ORDER BY cycle_due_date",
    [billId],
  );
  return rows.map(rowToPayment);
}

/**
 * The payment that already claims this transaction, or `null`.
 *
 * `bill_payments.transaction_id` is `NOT NULL UNIQUE` (001_core.sql), so there
 * is at most one. The sibling of `loans_repo.getPaymentByTransaction`, and it
 * exists for the same reason: a caller that is about to do something to a
 * ledger row has to be able to ASK what already claims it, rather than learning
 * the answer from a foreign-key failure it then has to translate for the user.
 */
export async function getBillPaymentByTransaction(
  transactionId: string,
): Promise<BillPayment | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<BillPaymentRow>(
    "SELECT * FROM bill_payments WHERE transaction_id = ?",
    [transactionId],
  );
  return row ? rowToPayment(row) : null;
}

/**
 * Un-matches a payment and REOPENS its cycle. NEVER deletes the transaction:
 * the money moved, and releasing it to be matched elsewhere is the entire
 * recovery path for a wrong suggestion the user confirmed — including one that
 * matched silently under rule 13's ladder.
 *
 * The cycle row is removed rather than reset, because openness is the absence
 * of a row. An overdue count is lost with it; that is the correct outcome for a
 * cycle the app now believes was never paid — the escalation starts over.
 */
export async function deleteBillPayment(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM bill_cycles WHERE bill_payment_id = ?", [id]);
  await db.runAsync("DELETE FROM bill_payments WHERE id = ?", [id]);
}
