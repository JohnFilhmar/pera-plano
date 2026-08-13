// hooks/mutations/use_archive_wallet.ts — m1c plan Task 3.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { archiveWallet } from "@/lib/db/repos/wallets_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Archives a wallet. THE WALLET IS NOT DELETED and its transactions stay
 * attached to it — see `archiveWallet` for why deleting is not on offer at all.
 *
 * Invalidates the list (the wallet leaves it) and the wallet's own detail (it
 * is still reachable by id, now flagged archived). The ledger is untouched:
 * every transaction still points at the same wallet with the same amount, so
 * nothing under `transactions` can have gone stale.
 */
export function useArchiveWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveWallet(id),
    onSuccess: (_result, id) =>
      invalidateKeys(queryClient, [queryKeys.wallets.list(), queryKeys.wallets.detail(id)]),
  });
}
