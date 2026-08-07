// lib/db/repos/transactions_repo.ts — the only SQL surface for the ledger
// (interface contract §3). Windows are [from, to): `from` inclusive, `to` exclusive.
import { getDatabase } from "@/lib/db/database";
import { rowToTransaction, transactionToRow, type TransactionRow } from "@/lib/db/mappers";
import { historyWindowDays } from "@/lib/entitlements";
import { newId } from "@/lib/ids";
import type { Centavos, NewTransaction, Transaction, TxFilter } from "@/types/domain";

const DAY_MS = 24 * 60 * 60 * 1000;

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
      record.direction === "in" ? record.amount : -record.amount,
      now,
      record.walletId,
    ]);
  });

  return record;
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
