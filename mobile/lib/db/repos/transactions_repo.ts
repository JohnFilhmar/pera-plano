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

/** The wallet's balance as it stands right now, or 0 when the id has no row. */
async function currentBalance(
  db: Awaited<ReturnType<typeof getDatabase>>,
  walletId: string,
): Promise<Centavos> {
  const row = await db.getFirstAsync<{ balance: number }>(
    "SELECT balance FROM wallets WHERE id = ?",
    [walletId],
  );
  return row?.balance ?? 0;
}

/**
 * Commits a Transaction and settles its Wallet's balance in the same SQL
 * transaction. Callers must not re-apply the delta.
 *
 * TWO PATHS, AND WHICH ONE RUNS IS DECIDED BY `balanceAfter`:
 *
 *   - NO REPORTED BALANCE (the common case — most notifications omit one, manual
 *     entries have none, cash never reports): the balance MOVES by the signed
 *     effect, `in` adding and `out` subtracting. Unchanged behaviour.
 *
 *   - A REPORTED BALANCE: the balance is SET to it, not moved by the amount.
 *     docs/04-features/02-wallets.md §balance handling rule 1 — "reported wins
 *     because it is the provider's own statement of truth". This is the whole
 *     point: a computed balance is the signed sum of what the app managed to
 *     parse, so one missed notification puts it permanently out of step with the
 *     bank, silently. A snap re-anchors it to the provider's own figure every
 *     time one arrives. Rule 12: the snap ALWAYS proceeds — drift never blocks
 *     the commit, it only raises the attention state (see `getBalanceDrift`).
 *
 * The pre-snap computed figure is captured first and stored on the row, because
 * the snap destroys it and rule 3's drift explainer needs both numbers.
 *
 * The read, the insert and the balance write share ONE SQL transaction. A snap
 * applied outside it would survive a rejected insert — a wallet claiming a
 * balance with nothing in the ledger to explain it.
 *
 * NOT IMPLEMENTED HERE: spec rule 9's second half, "out-of-order arrivals snap
 * only if the notification timestamp is newer than the current snapshot's". A
 * late-arriving older notification therefore re-anchors the wallet to its own
 * (stale) figure. The data to fix it now exists — `balance_after` alongside
 * `occurred_at` — but suppressing a snap is a routing decision that belongs
 * with the reconciliation work, not with persisting the value.
 */
export async function insertTransaction(tx: NewTransaction): Promise<Transaction> {
  const db = await getDatabase();
  const now = Date.now();
  const id = newId();
  const balanceAfter = tx.balanceAfter ?? null;

  let record: Transaction | null = null;

  await db.withTransactionAsync(async () => {
    // Read inside the transaction, so nothing can move the balance between the
    // figure we record as "computed" and the snap that replaces it.
    const before = balanceAfter === null ? null : await currentBalance(db, tx.walletId);

    const committed: Transaction = {
      id,
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
      balanceAfter,
      computedBalance: null,
      createdAt: now,
      updatedAt: now,
    };
    committed.computedBalance = before === null ? null : before + signedEffect(committed);

    const row = transactionToRow(committed);
    await db.runAsync(
      `INSERT INTO transactions (
         id, wallet_id, category_id, amount, direction, occurred_at, merchant,
         counterparty, reference_no, source, confidence, raw_notification_id,
         transfer_link_id, note, created_at, updated_at, balance_after, computed_balance
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.balance_after,
        row.computed_balance,
      ],
    );

    if (balanceAfter === null) {
      await db.runAsync("UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE id = ?", [
        signedEffect(committed),
        now,
        committed.walletId,
      ]);
    } else {
      // SET, not `balance + ?`. Compared against `balanceAfter === null` rather
      // than truthiness on purpose: a reported ₱0.00 is a drained wallet, and
      // `if (balanceAfter)` would quietly fall through to the increment for it.
      await db.runAsync("UPDATE wallets SET balance = ?, updated_at = ? WHERE id = ?", [
        balanceAfter,
        now,
        committed.walletId,
      ]);
    }

    record = committed;
  });

  // Non-null by construction: withTransactionAsync rethrows anything the body
  // threw, so reaching here means the assignment above ran.
  return record as unknown as Transaction;
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
 *
 * `balanceAfter` and `computedBalance` are excluded for the same reason as the
 * first three, and belong with them: the first is the PROVIDER's statement about
 * a moment that has already passed, and the second is what the app believed at
 * that same moment. Neither is a fact about the transaction the user is
 * correcting, and an editable balance-after would let a wallet be set to any
 * number at all through the edit form — the exact back door `updateWallet`
 * refuses to open by keeping `balance` unpatchable.
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
 *
 * ALSO NOT HANDLED HERE, AND THIS ONE IS A KNOWN LIMITATION: the balance ANCHOR
 * is not re-derived. Spec rule 2 defines the computed balance as "last anchor +
 * signed sum since", and a Transaction carrying a `balanceAfter` IS an anchor —
 * it SET the wallet's balance rather than moving it. Reverse-then-apply keeps
 * the arithmetic self-consistent after an edit (the balance still equals the
 * anchor plus the ledger's own signed sum), but editing a transaction that had
 * snapped leaves the anchor itself untouched, so `balanceAfter` and
 * `computedBalance` on that row go on describing the moment it was committed
 * rather than the moment as edited. Re-deriving from the last anchor is
 * reconciliation work (m1c Task 3b brief, "explicitly out of scope"), not edit
 * work; until it lands, a corrected snap row's stored drift is history, not a
 * live figure.
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
