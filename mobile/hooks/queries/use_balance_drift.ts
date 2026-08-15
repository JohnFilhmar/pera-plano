// hooks/queries/use_balance_drift.ts — m1c plan Task 4, wallets rule 3.
//
// The two balances a wallet has — the provider's reported figure and the
// ledger's computed one — and the gap between them.
//
// `null` IS NOT A ZERO DRIFT, at every layer including this one. It means the
// wallet has never received a reported balance at all (cash wallets, brand-new
// wallets, providers that omit it), so there is nothing to agree or disagree
// about. Callers must keep the two apart; `components/wallets/balance_mismatch_badge.tsx`
// is where that distinction turns into "no badge" rather than "everything
// agrees".
import { useQueries, useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { getBalanceDrift } from "@/lib/db/repos/wallets_repo";
import type { Centavos } from "@/types/domain";

export type BalanceDrift = {
  reported: Centavos;
  computed: Centavos;
  drift: Centavos;
  /**
   * The transaction these figures were read off — the newest one carrying a
   * reported balance, which IS the identity of this drift (migration 003).
   */
  reportingTransactionId: string;
  /**
   * The drift the user has already seen and accepted, or `null` for none.
   *
   * COMPARED, NOT TESTED FOR TRUTHINESS. Equal to `reportingTransactionId`
   * means the user has seen this one, so the badge stays quiet; anything else —
   * including a dismissal of an OLDER report — means this disagreement is new
   * and says so. A boolean in this slot would silence every later drift as
   * well, which is the failure the id shape exists to prevent.
   */
  dismissedTransactionId: string | null;
};

/** One wallet's drift — the detail screen's read. */
export function useBalanceDrift(walletId: string) {
  return useQuery({
    queryKey: queryKeys.wallets.drift(walletId),
    queryFn: () => getBalanceDrift(walletId),
  });
}

/**
 * The same read for a whole list, as `{ [walletId]: drift | null }`.
 *
 * ONE QUERY PER WALLET, not one query for the list. Each entry keeps its own
 * cache slot under that wallet's detail key, so a transaction committed against
 * one wallet refreshes exactly that wallet's badge — the invalidation the
 * mutations already do. A single list-shaped query would either refetch every
 * wallet's drift on every commit or go stale on all of them.
 *
 * A still-loading entry reports `null` (no badge) rather than `undefined`.
 * Never render a disagreement you have not confirmed: a warning that flashes on
 * and off during a refetch is worse than one that appears a frame late.
 */
export function useBalanceDrifts(walletIds: readonly string[]): Record<string, BalanceDrift | null> {
  return useQueries({
    queries: walletIds.map((walletId) => ({
      queryKey: queryKeys.wallets.drift(walletId),
      queryFn: () => getBalanceDrift(walletId),
    })),
    combine: (results) =>
      Object.fromEntries(walletIds.map((walletId, index) => [walletId, results[index]?.data ?? null])),
  });
}
