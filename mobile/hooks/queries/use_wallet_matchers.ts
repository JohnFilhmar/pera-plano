// hooks/queries/use_wallet_matchers.ts — m1c plan Task 4, wallets rule 4.
//
// One wallet's notification routes, for the "Catches: GCash" chips on its
// detail screen. Read-only here: `setMatchers` and the picker that writes it
// belong to Task 5, which owns the "one provider+hint pair, one wallet" rule
// and the reassignment warning that goes with it.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listMatchers } from "@/lib/db/repos/wallet_matchers_repo";

/**
 * Keyed under the wallet's own detail key, so anything that invalidates
 * `wallets.detail(id)` refreshes the chips beside the balance too.
 *
 * The repository's optional filter is REQUIRED here: `listMatchers()` with no
 * argument returns every matcher on the device — the whole-set read the ingest
 * Normalizer needs — and a detail screen that rendered those would tell the
 * user this wallet catches another wallet's provider.
 */
export function useWalletMatchers(walletId: string) {
  return useQuery({
    queryKey: queryKeys.wallets.matchers(walletId),
    queryFn: () => listMatchers(walletId),
  });
}
