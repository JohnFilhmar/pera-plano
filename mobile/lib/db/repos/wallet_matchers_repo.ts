// lib/db/repos/wallet_matchers_repo.ts — the read side of `wallet_matchers`,
// the table that says which Wallet a given app's notifications belong to.
//
// WHY IT EXISTS HERE AND NOW. `normalizeEvent` (spec §5, plan Task 5) decides
// which Wallet a parsed notification lands in, and getting that wrong is the
// quietest failure in the pipeline: the transaction looks completely normal and
// two balances are silently off. The stage is therefore pure — it takes the
// matcher rows as an argument and does no I/O — which left the rows themselves
// unowned until an orchestrator existed to load them. This is that owner.
//
// READ-ONLY, DELIBERATELY. The write side (`setMatchers`, and the
// `findWalletForPackage` convenience the picker wants) belongs to the wallets
// UI plan (m1c Task 5), which owns the "one pair, one wallet" rule and the
// reassignment warning that goes with it. Inventing those here would put that
// rule in two places; `listMatchers` is pinned by that same plan and is all the
// pipeline needs.
//
// Same house shape as wallets_repo.ts: thin functions over getDatabase(),
// domain types from types/domain.ts, no entitlement checks.
import { getDatabase } from "@/lib/db/database";
import type { WalletMatcher } from "@/types/domain";

type WalletMatcherRow = {
  id: string;
  wallet_id: string;
  package_name: string;
  hint: string | null;
  created_at: number;
  updated_at: number;
};

function rowToWalletMatcher(row: WalletMatcherRow): WalletMatcher {
  return {
    id: row.id,
    walletId: row.wallet_id,
    packageName: row.package_name,
    hint: row.hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Every matcher, or just one wallet's.
 *
 * The pipeline calls this with NO argument, once per capture, and hands the
 * whole set to the Normalizer — which needs all of them, not the ones for some
 * wallet it has not chosen yet. The optional filter is for the wallet detail
 * screen (m1c).
 *
 * Ordered by `created_at`, then `id`, so the array is stable across calls. The
 * Normalizer's resolution does not depend on order — it collects distinct
 * targets and refuses anything ambiguous — but a repository that returns rows
 * in whatever order SQLite feels like makes every test downstream of it flaky
 * for reasons that look like a bug in the stage.
 *
 * Rows are returned exactly as stored, including a matcher pointing at an
 * archived or deleted wallet. That is not laziness: the Normalizer treats such
 * a row as "I know where this belongs and I cannot put it there" and routes to
 * the Review Queue, which is the only path that repairs the stale row. Filtering
 * them out here would silently downgrade that into a wallet-fallback guess.
 */
export async function listMatchers(walletId?: string): Promise<WalletMatcher[]> {
  const db = await getDatabase();
  const rows =
    walletId === undefined
      ? await db.getAllAsync<WalletMatcherRow>(
          "SELECT * FROM wallet_matchers ORDER BY created_at ASC, id ASC",
        )
      : await db.getAllAsync<WalletMatcherRow>(
          "SELECT * FROM wallet_matchers WHERE wallet_id = ? ORDER BY created_at ASC, id ASC",
          [walletId],
        );
  return rows.map(rowToWalletMatcher);
}
