// lib/db/repos/wallets_repo.ts — the only SQL surface for the Wallet aggregate
// (interface contract §3). Screens and hooks call these functions, never SQL.
//
// This is the first repository in the project; it sets the house shape every
// later repo copies: thin functions over getDatabase(), rowToX mappers from
// lib/db/mappers.ts, domain types from types/domain.ts, no entitlement checks
// here (those live at the UI/service layer — see lib/entitlements.ts).
import { getDatabase } from "@/lib/db/database";
import { rowToWallet, type WalletRow } from "@/lib/db/mappers";
import { newId } from "@/lib/ids";
import type { Centavos, NewWallet, Wallet } from "@/types/domain";

/**
 * Thrown by `createWallet` when `name` collides with a non-archived Wallet
 * (Wallet invariant 1). Carries the offending name so callers can branch on
 * the failure mode instead of pattern-matching `error.message`.
 */
export class DuplicateNameError extends Error {
  constructor(public readonly walletName: string) {
    super(`wallet name already in use: ${walletName}`);
    this.name = "DuplicateNameError";
  }
}

/**
 * Thrown by `updateWallet` when `id` has no row — the same shape
 * categories_repo.ts uses for `CategoryNotFoundError`. `archiveWallet` does
 * NOT throw this: archiving is idempotent by design (see its own doc).
 */
export class WalletNotFoundError extends Error {
  constructor(public readonly walletId: string) {
    super(`wallet not found: ${walletId}`);
    this.name = "WalletNotFoundError";
  }
}

/**
 * Creates a Wallet with `openingBalance` (default ₱0.00) as its balance anchor.
 * Throws `DuplicateNameError` when the name collides with a non-archived
 * Wallet (Wallet invariant 1). The comparison is case-insensitive — wallet
 * names are free-typed, not chosen from an enum, so "GCash" and "gcash" are
 * the same collision a real user will trip over.
 */
export async function createWallet(input: NewWallet): Promise<Wallet> {
  const db = await getDatabase();
  const clash = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM wallets WHERE name = ? COLLATE NOCASE AND is_archived = 0",
    [input.name],
  );
  if (clash) {
    throw new DuplicateNameError(input.name);
  }

  const now = Date.now();
  const wallet: Wallet = {
    id: newId(),
    name: input.name,
    type: input.type,
    balance: input.openingBalance ?? 0,
    currency: "PHP",
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  await db.runAsync(
    `INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      wallet.id,
      wallet.name,
      wallet.type,
      wallet.balance,
      wallet.currency,
      wallet.createdAt,
      wallet.updatedAt,
    ],
  );
  return wallet;
}

/** Returns `null` (never throws, never `undefined`) when `id` has no row. */
export async function getWallet(id: string): Promise<Wallet | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<WalletRow>("SELECT * FROM wallets WHERE id = ?", [id]);
  return row ? rowToWallet(row) : null;
}

/**
 * Active wallets first (oldest first), archived wallets collapsed below them
 * (docs/06 §3.3). Pass `includeArchived: true` to also get the archived tail.
 *
 * Archiving, not deleting, is the supported way to retire a Wallet: the schema's
 * `NO ACTION` foreign key on transactions.wallet_id blocks a DELETE outright
 * (invariant I4), so nothing in this repo issues one. There is deliberately no
 * `deleteWallet` export here.
 */
export async function listWallets(opts?: { includeArchived?: boolean }): Promise<Wallet[]> {
  const db = await getDatabase();
  const sql = opts?.includeArchived
    ? "SELECT * FROM wallets ORDER BY is_archived ASC, created_at ASC"
    : "SELECT * FROM wallets WHERE is_archived = 0 ORDER BY created_at ASC";
  const rows = await db.getAllAsync<WalletRow>(sql);
  return rows.map(rowToWallet);
}

/**
 * Edits a Wallet's own fields — the write path behind the wallet edit form
 * (m1c Task 5). Throws `WalletNotFoundError` when `id` has no row, and
 * `DuplicateNameError` when the new name collides case-insensitively with a
 * DIFFERENT non-archived Wallet (Wallet invariant 1 applies to the UPDATE path
 * exactly as it does to the INSERT one; enforcing it only in `createWallet`
 * would leave renaming as an unguarded back door into two live wallets sharing
 * a name — the thing the matcher rules key on). The row being renamed is
 * excluded from that check, so re-casing a wallet's own name, or saving the
 * form without touching the name, is always allowed.
 *
 * `balance` IS NOT PATCHABLE, and neither is `currency` or `isArchived`. The
 * balance is the ledger's running total, moved only by `insertTransaction` /
 * `updateTransaction` as part of committing the transaction that explains the
 * move. A wallet-edit form that could set it directly would let a user write a
 * number no transaction accounts for — which is precisely why adjusting a cash
 * balance has to go through an adjustment transaction instead (m1c Task 5's
 * cash reconciliation). Archiving has its own function below.
 */
export async function updateWallet(
  id: string,
  patch: Partial<Pick<Wallet, "name" | "type">>,
): Promise<Wallet> {
  const db = await getDatabase();
  const existing = await getWallet(id);
  if (!existing) {
    throw new WalletNotFoundError(id);
  }

  const name = patch.name ?? existing.name;
  if (patch.name !== undefined) {
    const clash = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM wallets WHERE name = ? COLLATE NOCASE AND is_archived = 0 AND id != ?",
      [name, id],
    );
    if (clash) {
      throw new DuplicateNameError(name);
    }
  }

  const updated: Wallet = {
    ...existing,
    name,
    type: patch.type ?? existing.type,
    updatedAt: Date.now(),
  };

  await db.runAsync("UPDATE wallets SET name = ?, type = ?, updated_at = ? WHERE id = ?", [
    updated.name,
    updated.type,
    updated.updatedAt,
    id,
  ]);
  return updated;
}

/**
 * Retires a Wallet by setting `is_archived`. IT NEVER DELETES.
 *
 * A Wallet with Transactions behind it cannot be removed without orphaning
 * them: the schema's `NO ACTION` foreign key on `transactions.wallet_id` blocks
 * the DELETE outright (invariant I4), and a delete-and-recreate would destroy
 * the ledger that explains every balance the app has ever shown. Archiving is
 * the whole retirement story — the wallet drops out of `listWallets()`, stays
 * readable by id and under `includeArchived`, keeps its transactions attached,
 * frees its name for reuse, and the ingest Normalizer already refuses to
 * resolve a capture into an archived wallet.
 *
 * Idempotent, like `review_queue_repo.resolve` and `unlinkTransfer`: archiving
 * an unknown or already-archived id is a silent no-op, never an error, so a
 * double-tap in the wallet detail screen cannot fail.
 */
export async function archiveWallet(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE wallets SET is_archived = 1, updated_at = ? WHERE id = ? AND is_archived = 0",
    [Date.now(), id],
  );
}

/**
 * The two balances a Wallet has, and the gap between them.
 *
 * `reported` is the provider's own figure from the last balance-carrying
 * Transaction committed against this Wallet — the one that actually SET the
 * Wallet's `balance` (docs/04-features/02-wallets.md §balance handling rule 1).
 * `computed` is what the balance would have been without that snap. `drift` is
 * `reported - computed`: POSITIVE means the bank holds more than the ledger
 * accounts for (income the app never saw), NEGATIVE means it holds less (spend
 * the app never saw). Compare its magnitude against the ruleset's
 * `balanceDriftToleranceCentavos` to decide whether the attention state fires
 * (rule 3) — the tolerance lives in ruleset data because the spec lists its
 * value as an open question (§14 item 1) to be tuned during M1.
 *
 * `null` — NOT a zero drift — when the Wallet has never received a reported
 * balance at all: cash Wallets, brand-new Wallets, providers that omit it, and
 * unknown ids. A zero would render a badge saying the bank and the ledger agree
 * on a Wallet the app has never had a bank figure for, which is a claim it has
 * no basis for making. A Wallet whose figures genuinely match returns
 * `drift: 0`, and those two states must stay distinguishable.
 *
 * WHY COMMIT ORDER RATHER THAN `occurred_at`. This describes the CURRENT
 * balance, and the current balance is whatever the last snap to run set it to.
 * Rule 12 makes the snap unconditional, and rule 9's out-of-order suppression is
 * not implemented (see `insertTransaction`), so a late-arriving older
 * notification does re-anchor the Wallet — and the explainer must describe the
 * figure the Wallet actually holds, not a newer one that no longer governs it.
 *
 * Both figures are read off the transaction row rather than recomputed: the snap
 * overwrote the computed balance the instant it happened, and re-deriving it
 * would need the anchor walk that is reconciliation work.
 */
export async function getBalanceDrift(
  walletId: string,
): Promise<{ reported: Centavos; computed: Centavos; drift: Centavos } | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ balance_after: number; computed_balance: number }>(
    `SELECT balance_after, computed_balance
       FROM transactions
      WHERE wallet_id = ? AND balance_after IS NOT NULL
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1`,
    [walletId],
  );
  if (row === null) return null;

  // `computed_balance` is written as a pair with `balance_after`, so this
  // coalesce only catches a row backfilled by hand; treating it as equal to the
  // reported figure reports no drift rather than inventing one out of a null.
  const reported = row.balance_after;
  const computed = row.computed_balance ?? reported;
  return { reported, computed, drift: reported - computed };
}
