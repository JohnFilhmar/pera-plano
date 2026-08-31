// lib/db/repos/transactions_repo.ts — the only SQL surface for the ledger
// (interface contract §3). Windows are [from, to): `from` inclusive, `to` exclusive.
import { addDaysIso } from "@/lib/dates";
import { getDatabase } from "@/lib/db/database";
import { rowToTransaction, transactionToRow, type TransactionRow } from "@/lib/db/mappers";
import { historyWindowDays } from "@/lib/entitlements";
import { newId } from "@/lib/ids";
import type { Centavos, EpochMs, NewTransaction, Transaction, TxFilter } from "@/types/domain";

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
 * REVERSE-THEN-APPLY: moves a Wallet's balance from what `before` did to what
 * `after` does, as two statements rather than "apply the difference". That one
 * formulation is correct for an amount change, a direction flip and a wallet
 * move at once — when the wallet is unchanged the two statements simply net
 * out on the same row. Shared by `updateTransaction` and `supersedeMintedLeg`
 * so the two paths cannot drift apart on this arithmetic.
 */
async function settleBalance(
  db: Awaited<ReturnType<typeof getDatabase>>,
  before: Pick<Transaction, "walletId" | "direction" | "amount">,
  after: Pick<Transaction, "walletId" | "direction" | "amount">,
  now: number,
): Promise<void> {
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
      isAdjustment: tx.isAdjustment ?? false,
      createdAt: now,
      updatedAt: now,
    };
    committed.computedBalance = before === null ? null : before + signedEffect(committed);

    const row = transactionToRow(committed);
    await db.runAsync(
      `INSERT INTO transactions (
         id, wallet_id, category_id, amount, direction, occurred_at, merchant,
         counterparty, reference_no, source, confidence, raw_notification_id,
         transfer_link_id, note, created_at, updated_at, balance_after, computed_balance,
         is_adjustment
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        row.is_adjustment,
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
    await settleBalance(db, before, after, now);
  });

  return after;
}

/**
 * Replaces a MINTED transfer leg with the provider's own record of it.
 *
 * WHY THIS IS NOT `updateTransaction`. `TransactionPatch` deliberately excludes
 * `source`, `rawNotificationId` and `balanceAfter` so the edit form cannot
 * relabel a row's provenance. Superseding is not an edit — it is one record of a
 * movement being replaced by a better one — so it gets its own door rather than
 * widening that patch type for everybody.
 *
 * THE BALANCE IS SETTLED REVERSE-THEN-APPLY, via the same `settleBalance` helper
 * `updateTransaction` uses: the minted row already moved the wallet balance, and
 * the provider's amount may legitimately differ (the user guessed; the bank
 * knows). The wallet never changes here — a supersede that landed on a different
 * wallet would not be the same movement — so `before.walletId` and
 * `after.walletId` are always equal and the two statements net out to the exact
 * signed difference.
 *
 * `transferLinkId` IS NOT TOUCHED. The link is the same link and the pair is the
 * same pair — the user's confirmation is not re-litigated by the arrival of a
 * receipt.
 *
 * A `balanceAfter` that arrives non-null makes this row an anchor, exactly as it
 * would on insert. Re-deriving the wallet from the last anchor is reconciliation
 * work and stays out of scope here too — the same known limitation
 * `updateTransaction`'s own header documents.
 */
export async function supersedeMintedLeg(
  id: string,
  provider: {
    amount: Centavos;
    occurredAt: EpochMs;
    referenceNo: string | null;
    balanceAfter: Centavos | null;
    rawNotificationId: string;
    counterparty: string | null;
    confidence: number;
  },
): Promise<Transaction> {
  const db = await getDatabase();
  const before = await getTransaction(id);
  if (!before) {
    throw new TransactionNotFoundError(id);
  }

  const now = Date.now();
  const after: Transaction = {
    ...before,
    amount: provider.amount,
    occurredAt: provider.occurredAt,
    referenceNo: provider.referenceNo,
    counterparty: provider.counterparty,
    source: "notification",
    confidence: provider.confidence,
    rawNotificationId: provider.rawNotificationId,
    balanceAfter: provider.balanceAfter,
    updatedAt: now,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE transactions
          SET amount = ?, occurred_at = ?, reference_no = ?, counterparty = ?,
              source = 'notification', confidence = ?, raw_notification_id = ?,
              balance_after = ?, updated_at = ?
        WHERE id = ?`,
      [
        after.amount,
        after.occurredAt,
        after.referenceNo,
        after.counterparty,
        after.confidence,
        after.rawNotificationId,
        after.balanceAfter,
        after.updatedAt,
        id,
      ],
    );
    await settleBalance(db, before, after, now);
  });

  return after;
}

/**
 * Removes a Transaction AND takes its effect back out of its Wallet's balance,
 * in one SQL transaction.
 *
 * THE REVERSAL IS THE POINT, and it is the same argument `updateTransaction`
 * makes above. `insertTransaction` MOVED the wallet balance as part of writing
 * the row, so the balance already carries this transaction's effect. Deleting
 * the row alone would leave the wallet describing a transaction that no longer
 * exists — the silent disagreement between a total and the ledger meant to
 * explain it that this app may never show. Reverse-then-(nothing) is just
 * `updateTransaction`'s reverse-then-apply with the second half removed.
 *
 * THE CALLER THIS EXISTS FOR IS "SAME TRANSACTION". When a duplicate reaches the
 * ledger twice, BOTH rows moved the balance, so the wallet is short by twice one
 * purchase. Deleting one and reversing it is what brings the balance back to the
 * truth — which is the entire reason the user pressed the button.
 *
 * THROWS RATHER THAN NO-OPS on an unknown id, unlike `deleteUserRule` and
 * `unlinkTransfer`. Those remove a claim; this moves money. A caller deleting a
 * row that is not there has lost track of what it is reversing, and answering
 * "fine, done" hides a balance bug behind a success.
 *
 * A row referenced elsewhere CANNOT be deleted, and that is a feature rather
 * than a gap: `transfer_links`, `loan_payments` and `bill_payments` all hold
 * foreign keys onto `transactions` with no ON DELETE action, so the DELETE
 * throws and this whole call rolls back. Discarding a transfer leg would leave a
 * link pointing at nothing and money missing from every total; the caller has to
 * unlink (or unmatch) first and decide that deliberately.
 *
 * `wallets.drift_dismissed_transaction_id` (003) is the ONE reference this
 * function clears instead of refusing, because it is a note about what the user
 * has read rather than a claim about money. See the body.
 *
 * Spec rule 10 — "committed transactions are never deleted by any queue action"
 * — still holds for the queue's own dismissals: a held (uncommitted) twin has no
 * row for this function to touch, and `mergeDuplicate` reaches it only for the
 * ledger-side merge of two ALREADY-committed rows, which spec §"Flow: merge /
 * split / link / unlink" describes as its own user-initiated action.
 */
export async function deleteTransaction(id: string): Promise<void> {
  const db = await getDatabase();
  const existing = await getTransaction(id);
  if (!existing) {
    throw new TransactionNotFoundError(id);
  }

  const now = Date.now();
  await db.withTransactionAsync(async () => {
    // A dismissal naming this row has to go FIRST — 003 put a foreign key on
    // `wallets.drift_dismissed_transaction_id`, so leaving it would block the
    // DELETE and fail a duplicate merge with an error naming neither. Clearing
    // it is also the right answer on its own terms: a dismissal of a
    // transaction that no longer exists acknowledges nothing, so whatever drift
    // governs the wallet afterwards is unacknowledged, which it is.
    await db.runAsync(
      "UPDATE wallets SET drift_dismissed_transaction_id = NULL WHERE drift_dismissed_transaction_id = ?",
      [id],
    );
    await db.runAsync("DELETE FROM transactions WHERE id = ?", [id]);
    await db.runAsync("UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE id = ?", [
      signedEffect(existing),
      now,
      existing.walletId,
    ]);
  });
}

/**
 * Moves every Transaction from one Wallet to another, settling both balances.
 * m1c Task 5's archive flow; docs/04-features/02-wallets.md rules 18 and 19.
 *
 * Archiving asks what should happen to a Wallet's history — keep it attached
 * (the default) or move it somewhere still in use. This is the move, and there
 * is deliberately no delete beside it: invariant 4 forbids orphan Transactions,
 * and `wallets_repo` exports no `deleteWallet` at all.
 *
 * WHY IT IS HERE RATHER THAN A LOOP OVER `updateTransaction` IN A HOOK.
 * `listTransactions` is clamped to the tier's history floor, so a Free-tier
 * caller enumerating rows through it would move the last 90 days and silently
 * leave everything older attached to the archived Wallet. The floor is a
 * VISIBILITY rule (docs/05-monetization.md §3.3) and applying it to ownership
 * would make old transactions vanish from a Wallet that still shows their
 * money. The SQL below is unclamped for that reason, exactly as `getTransaction`
 * is.
 *
 * The balance work is `updateTransaction`'s reverse-then-apply, batched: the
 * source loses the signed effect of every row it is giving up and the target
 * gains it. Rows and balances move in ONE SQL transaction, because a
 * half-finished move splits a Wallet's history across two Wallets with both
 * balances wrong.
 *
 * Every other column is untouched, `raw_notification_id` above all — spec rule
 * 19: invariant 5's "why was this recorded?" transparency has to survive a move,
 * or retiring a Wallet quietly destroys the provenance of its history.
 *
 * NOT HANDLED, AND KNOWN: spec rule 4 of the delete flow — a TransferLink whose
 * two legs would end up in the SAME Wallet should be dissolved and both legs
 * sent to the Review Queue for re-triage. That needs the Review Queue's write
 * path (m1c Task 10) and `unlinkTransfer`, and it is a routing decision rather
 * than a persistence one. Until it lands, moving a Wallet that holds one leg of
 * an internal transfer into the Wallet holding the other leaves a link whose
 * legs share a Wallet. It affects no total (transfer legs are excluded from
 * spend and income by invariant 2) and no balance (both legs still apply), but
 * the link is meaningless and should be re-triaged.
 */
export async function reassignWalletTransactions(
  fromWalletId: string,
  toWalletId: string,
): Promise<void> {
  if (fromWalletId === toWalletId) return;

  const db = await getDatabase();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    // Read inside the transaction: the delta and the rows it describes must be
    // the same set, or the balances settle against a ledger that moved.
    const rows = await db.getAllAsync<{ amount: number; direction: string }>(
      "SELECT amount, direction FROM transactions WHERE wallet_id = ?",
      [fromWalletId],
    );
    if (rows.length === 0) return;

    const delta = rows.reduce(
      (total, row) => total + (row.direction === "in" ? row.amount : -row.amount),
      0,
    );

    await db.runAsync(
      "UPDATE transactions SET wallet_id = ?, updated_at = ? WHERE wallet_id = ?",
      [toWalletId, now, fromWalletId],
    );
    await db.runAsync("UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE id = ?", [
      delta,
      now,
      fromWalletId,
    ]);
    await db.runAsync("UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE id = ?", [
      delta,
      now,
      toWalletId,
    ]);
  });
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
  // OPT-IN, unlike the two spend queries below where exclusion is unconditional.
  // The ledger screens read through here and an adjustment belongs on them —
  // it is a real row that really moved the balance, and hiding it would leave
  // a wallet total the visible history cannot explain. Only callers asking
  // "what does this person actually earn / spend / pay every month" set it.
  if (filter.excludeAdjustments) {
    clauses.push("is_adjustment = 0");
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
 * counts transfer legs (invariant I2) or balance adjustments
 * (017_transaction_adjustments). The window is clamped to the tier's history
 * floor so Free never reports spend it cannot show.
 *
 * THE ADJUSTMENT EXCLUSION IS NOT OPTIONAL HERE, unlike on `listTransactions`.
 * This function has exactly one meaning — "how much money did this person
 * spend" — and a correction that says "the wallet actually holds less than the
 * ledger thought" is the user fixing the app's arithmetic, not a purchase.
 * Every limit and every Safe-to-Spend figure funnels through here, so a caller
 * that could opt out would be a caller that could re-introduce the bug.
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
    "is_adjustment = 0",
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

/**
 * Daily outflow totals for the Home hero's seven-bar strip, oldest first,
 * always exactly `days` long.
 *
 * AGGREGATES IN SQL RATHER THAN IN JS, and that is the entire point of the
 * function. Home already held an unfiltered `useTransactions({})` and could
 * have summed it in memory — but that list grows with the user's history and
 * is re-read on every focus, to draw seven small bars. This returns seven rows
 * on a ledger of seven transactions and seven rows on a ledger of seven
 * thousand.
 *
 * WHAT COUNTS AS SPENDING here is the same rule `sumSpend` uses: outflows only,
 * transfer legs excluded (invariant I2 — moving your own money between your own
 * wallets is not spending, and counting it would double-count every top-up),
 * balance adjustments excluded (017_transaction_adjustments — reconciling a
 * wallet to the figure the user typed is not a purchase). `sumSpend` expresses
 * "not a transfer leg" as `transfer_link_id IS NULL` — this schema has no
 * `is_transfer` column at all (001_core.sql) — so this function matches that
 * expression exactly rather than one that does not exist.
 *
 * THE TWO PREDICATES MUST STAY IDENTICAL. They already drifted once: the bar
 * strip and the limit ring are read side by side on Home, and one of them
 * counting a correction the other ignored is exactly the inconsistency the
 * owner's 2026-08-30 report surfaced.
 *
 * NOT CLAMPED to the tier's history floor. Seven days is inside every window
 * the tier matrix defines, so clamping would be arithmetic with no effect and
 * one more thing to get wrong.
 */
export async function dailySpend(args: { days: number; endingOn: string }): Promise<number[]> {
  const db = await getDatabase();

  // `endingOn` is a local YYYY-MM-DD date, but `occurred_at` is stored as epoch
  // MILLISECONDS (schema: `occurred_at INTEGER NOT NULL`; types/domain.ts's
  // `EpochMs`). SQLite's `date()` reads a bare numeric argument as a Julian day
  // count, not a timestamp — passed directly, a millisecond value resolves to a
  // meaningless fixed date (verified: every row lands on 2000-01-01) rather than
  // throwing, which would silently empty every window instead of erroring. The
  // `unixepoch` modifier expects SECONDS, so the column is divided by 1000
  // first. `'localtime'` then converts each row to the device's day before
  // grouping, so a 23:40 purchase lands on the day the user made it rather than
  // the following UTC one.
  const rows = await db.getAllAsync<{ day: string; total: number }>(
    `SELECT date(occurred_at / 1000, 'unixepoch', 'localtime') AS day,
            COALESCE(SUM(amount), 0) AS total
       FROM transactions
      WHERE direction = 'out'
        AND transfer_link_id IS NULL
        AND is_adjustment = 0
        AND date(occurred_at / 1000, 'unixepoch', 'localtime') > date(?, ?)
        AND date(occurred_at / 1000, 'unixepoch', 'localtime') <= date(?)
      GROUP BY day`,
    [args.endingOn, `-${args.days} days`, args.endingOn],
  );

  const byDay = new Map(rows.map((row) => [row.day, row.total]));

  // `addDaysIso` (lib/dates.ts) rather than a hand-rolled Date/padStart loop —
  // it already does exactly this local-calendar arithmetic and is what every
  // other window in this codebase is built from (lib/bills/due_rules.ts,
  // lib/period.ts).
  const series: number[] = [];
  for (let offset = args.days - 1; offset >= 0; offset -= 1) {
    const day = addDaysIso(args.endingOn, -offset);
    series.push(byDay.get(day) ?? 0);
  }
  return series;
}
