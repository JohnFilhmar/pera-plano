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
import type { NewWallet, Wallet } from "@/types/domain";

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
