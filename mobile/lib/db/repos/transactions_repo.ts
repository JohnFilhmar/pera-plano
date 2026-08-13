// lib/db/repos/transactions_repo.ts — the only SQL surface for the ledger
// (interface contract §3). Windows are [from, to): `from` inclusive, `to` exclusive.
import { getDatabase } from "@/lib/db/database";
import { rowToTransaction, transactionToRow, type TransactionRow } from "@/lib/db/mappers";
import { historyWindowDays } from "@/lib/entitlements";
import { newId } from "@/lib/ids";
import type { Centavos, NewTransaction, Transaction, TxFilter } from "@/types/domain";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Thrown by `updateTransaction` when `id` has no row — same shape as
 * wallets_repo's `WalletNotFoundError` and categories_repo's
 * `CategoryNotFoundError`.
 */
export class TransactionNotFoundError extends Error {
  constructor(public readonly transactionId: string) {
    super(`transaction not found: ${transactionId}`);
    this.name = "TransactionNotFoundError";
  }
}

/** What a Transaction does to its Wallet's balance: `in` adds, `out` subtracts. */
function signedEffect(tx: Pick<Transaction, "direction" | "amount">): Centavos {
  return tx.direction === "in" ? tx.amount : -tx.amount;
}

/**
 * Earliest `occurred_at` the current tier may see, or null when unlimited.
 * A VISIBILITY floor only — nothing is deleted and wallet balances are
 * unaffected (docs/05-monetization.md §2/§3.3).
 */
function historyFloor(): number | null {
  const days = historyWindowDays();
  return days === null ? null : Date.now() - days * DAY_MS;
}

/**
 * Commits a Transaction and moves its Wallet's balance in the same SQL
 * transaction (`in` adds, `out` subtracts). Callers must not re-apply the delta.
 */
export async function insertTransaction(tx: NewTransaction): Promise<Transaction> {
  const db = await getDatabase();
  const now = Date.now();
  const record: Transaction = {
    id: newId(),
    walletId: tx.walletId,
    categoryId: tx.categoryId,
    amount: tx.amount,
    direction: tx.direction,
    occurredAt: tx.occurredAt,
    merchant: tx.merchant ?? null,
    counterparty: tx.counterparty ?? null,
    referenceNo: tx.referenceNo ?? null,
    source: tx.source,
    confidence: tx.confidence,
    rawNotificationId: tx.rawNotificationId ?? null,
    transferLinkId: tx.transferLinkId ?? null,
    note: tx.note ?? null,
    createdAt: now,
    updatedAt: now,
  };
  const row = transactionToRow(record);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO transactions (
         id, wallet_id, category_id, amount, direction, occurred_at, merchant,
         counterparty, reference_no, source, confidence, raw_notification_id,
         transfer_link_id, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.wallet_id,
        row.category_id,
        row.amount,
        row.direction,
        row.occurred_at,
        row.merchant,
        row.counterparty,
        row.reference_no,
        row.source,
        row.confidence,
        row.raw_notification_id,
        row.transfer_link_id,
        row.note,
        row.created_at,
        row.updated_at,
      ],
    );
    await db.runAsync("UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE id = ?", [
      signedEffect(record),
      now,
      record.walletId,
    ]);
  });

  return record;
}

/**
 * One Transaction by id, or `null` — the transaction detail screen's read.
 *
 * Deliberately NOT clamped to the tier's history floor the way
 * `listTransactions` and `sumSpend` are: those answer "what is in this window",
 * where a Free-tier floor is the answer; this answers "what is this row", where
 * hiding a row the caller already holds the id of would turn a working detail
 * route into a blank screen. The floor is a listing rule, not a retention or
 * access rule (docs/05-monetization.md §3.3).
 */
export async function getTransaction(id: string): Promise<Transaction | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<TransactionRow>("SELECT * FROM transactions WHERE id = ?", [
    id,
  ]);
  return row ? rowToTransaction(row) : null;
}

/**
 * The fields a user correction may rewrite. Deliberately excludes `source`,
 * `confidence` and `rawNotificationId` — those are the PROVENANCE that lets the
 * app answer "why was this recorded?", and a correction changes the facts, not
 * the story of where they came from. `transferLinkId` is excluded too: the link
 * row and the stamp on both legs are one atomic pair owned by
 * transfer_links_repo, and a second writer here would let a stamped leg exist
 * with no link row — money silently gone from every total.
 */
export type TransactionPatch = Partial<
  Pick<
    Transaction,
    | "walletId"
    | "categoryId"
    | "amount"
    | "direction"
    | "occurredAt"
    | "merchant"
    | "counterparty"
    | "referenceNo"
    | "note"
  >
>;

/**
 * Edits a committed Transaction AND settles the wallet balances it moves, in
 * one SQL transaction.
 *
 * WHY THE BALANCE WORK IS NOT OPTIONAL. `insertTransaction` moved the wallet
 * balance as part of committing the row, so the balance already carries this
 * transaction's effect. Writing the row alone on an edit would leave the
 * balance describing a transaction that no longer exists — a wallet total that
 * silently disagrees with the ledger that is supposed to explain it. The
 * settlement is expressed as REVERSE-THEN-APPLY (subtract the old effect from
 * the old wallet, add the new effect to the new one) rather than "apply the
 * difference", because that one formulation is correct for all four cases at
 * once: amount change, direction flip, wallet move, and any combination. When
 * the wallet is unchanged the two statements simply net out on the same row.
 *
 * An omitted key leaves its column alone; an explicit `null` clears a nullable
 * one. Throws `TransactionNotFoundError` when `id` has no row. A rejected write
 * (e.g. the schema's `CHECK (amount > 0)`) rolls the balance moves back with
 * it — that is what the shared `withTransactionAsync` buys.
 *
 * NOT handled here: a transfer leg's `feeAmount`. Editing a linked leg's amount
 * leaves the TransferLink's stored fee stale. That fee is informational only in
 * MVP (nothing adds it to a spend total — see transfer_links_repo's header), so
 * recomputing it would mean this repo reaching across into another aggregate
 * for a number nothing reads.
 */
export async function updateTransaction(
  id: string,
  patch: TransactionPatch,
): Promise<Transaction> {
  const db = await getDatabase();
  const before = await getTransaction(id);
  if (!before) {
    throw new TransactionNotFoundError(id);
  }

  const now = Date.now();
  const after: Transaction = {
    ...before,
    walletId: patch.walletId ?? before.walletId,
    categoryId: patch.categoryId ?? before.categoryId,
    amount: patch.amount ?? before.amount,
    direction: patch.direction ?? before.direction,
    occurredAt: patch.occurredAt ?? before.occurredAt,
    merchant: patch.merchant !== undefined ? patch.merchant : before.merchant,
    counterparty: patch.counterparty !== undefined ? patch.counterparty : before.counterparty,
    referenceNo: patch.referenceNo !== undefined ? patch.referenceNo : before.referenceNo,
    note: patch.note !== undefined ? patch.note : before.note,
    updatedAt: now,
  };
  const row = transactionToRow(after);

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE transactions
         SET wallet_id = ?, category_id = ?, amount = ?, direction = ?, occurred_at = ?,
             merchant = ?, counterparty = ?, reference_no = ?, note = ?, updated_at = ?
       WHERE id = ?`,
      [
        row.wallet_id,
        row.category_id,
        row.amount,
        row.direction,
        row.occurred_at,
        row.merchant,
        row.counterparty,
        row.reference_no,
        row.note,
        row.updated_at,
        id,
      ],
    );
    await db.runAsync("UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE id = ?", [
      signedEffect(before),
      now,
      before.walletId,
    ]);
    await db.runAsync("UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE id = ?", [
      signedEffect(after),
      now,
      after.walletId,
    ]);
  });

  return after;
}

/** Reverse-chronological ledger read, clamped to the tier's history window. */
export async function listTransactions(filter: TxFilter): Promise<Transaction[]> {
  const db = await getDatabase();
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const floor = historyFloor();
  const from =
    floor === null ? filter.from : Math.max(filter.from ?? Number.NEGATIVE_INFINITY, floor);
  if (from !== undefined && Number.isFinite(from)) {
    clauses.push("occurred_at >= ?");
    params.push(from);
  }
  if (filter.to !== undefined) {
    clauses.push("occurred_at < ?");
    params.push(filter.to);
  }
  if (filter.walletId) {
    clauses.push("wallet_id = ?");
    params.push(filter.walletId);
  }
  if (filter.categoryId) {
    clauses.push("category_id = ?");
    params.push(filter.categoryId);
  }
  if (filter.direction) {
    clauses.push("direction = ?");
    params.push(filter.direction);
  }
  if (filter.excludeTransferLinked) {
    clauses.push("transfer_link_id IS NULL");
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.getAllAsync<TransactionRow>(
    `SELECT * FROM transactions ${where} ORDER BY occurred_at DESC, created_at DESC`,
    params,
  );
  return rows.map(rowToTransaction);
}

/**
 * Total money spent in [from, to). Counts `direction = 'out'` only and never
 * counts transfer legs (invariant I2). The window is clamped to the tier's
 * history floor so Free never reports spend it cannot show.
 */
export async function sumSpend(args: {
  from: number;
  to: number;
  categoryIds?: string[];
  walletIds?: string[];
}): Promise<Centavos> {
  if (args.categoryIds?.length === 0 || args.walletIds?.length === 0) return 0;

  const db = await getDatabase();
  const floor = historyFloor();
  const from = floor === null ? args.from : Math.max(args.from, floor);

  const clauses = [
    "direction = 'out'",
    "transfer_link_id IS NULL",
    "occurred_at >= ?",
    "occurred_at < ?",
  ];
  const params: (string | number)[] = [from, args.to];

  if (args.categoryIds) {
    clauses.push(`category_id IN (${args.categoryIds.map(() => "?").join(", ")})`);
    params.push(...args.categoryIds);
  }
  if (args.walletIds) {
    clauses.push(`wallet_id IN (${args.walletIds.map(() => "?").join(", ")})`);
    params.push(...args.walletIds);
  }

  const row = await db.getFirstAsync<{ total: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE ${clauses.join(" AND ")}`,
    params,
  );
  return row?.total ?? 0;
}
