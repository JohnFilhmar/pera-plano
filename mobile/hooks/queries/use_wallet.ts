// hooks/queries/use_wallet.ts — m1c plan Task 3.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { getWallet } from "@/lib/db/repos/wallets_repo";

/**
 * One wallet by id, or `null` when it has no row — the wallet detail route's
 * read. An ARCHIVED wallet still resolves here: it is gone from the list, not
 * from the app, and its detail screen has to keep working for the transactions
 * still attached to it.
 */
export function useWallet(id: string) {
  return useQuery({
    queryKey: queryKeys.wallets.detail(id),
    queryFn: () => getWallet(id),
  });
}
