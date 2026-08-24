// hooks/mutations/use_archive_wallet.ts — m1c plan Task 3, WIDENED by Task 5.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { reassignWalletTransactions } from "@/lib/db/repos/transactions_repo";
import { archiveWallet } from "@/lib/db/repos/wallets_repo";

import { invalidateKeys } from "./invalidate_keys";

export type ArchiveWalletVariables = {
  id: string;
  /**
   * Where this wallet's transactions should go. `null` — THE DEFAULT — leaves
   * them attached to the archived wallet, where spec §archive rule 2 says they
   * belong: "its Transactions remain fully visible in history and reports".
   */
  moveTransactionsTo?: string | null;
};

/**
 * Archives a wallet, optionally moving its transactions somewhere still in use
 * first. THE WALLET IS NOT DELETED and neither are its transactions — see
 * `archiveWallet` for why deleting is not on offer at all.
 *
 * TASK 5 WIDENED THE VARIABLES from a bare id to an object. Plan rule 4 makes
 * archiving ask what happens to the wallet's history, and the answer has to
 * travel with the archive call rather than as a second, separate mutation the
 * UI fires alongside it: two independent writes can half-succeed, and the half
 * that succeeds would be the archive — retiring a wallet whose transactions the
 * user asked to move and which are still sitting in it.
 *
 * THE MOVE RUNS FIRST, and that order is not arbitrary. `reassignWalletTransactions`
 * settles both wallets' balances; doing it after the archive would work, but
 * reading a just-archived wallet's rows is the kind of ordering nobody revisits
 * until it breaks. Moving while the wallet is still live keeps every
 * intermediate state one a user could have produced by hand.
 *
 * Invalidates the list (the wallet leaves it), this wallet's detail (still
 * reachable by id, now flagged archived), and — only when a move happened —
 * the destination's detail and the whole ledger, whose rows changed wallets.
 */
export function useArchiveWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, moveTransactionsTo }: ArchiveWalletVariables) => {
      if (moveTransactionsTo) {
        await reassignWalletTransactions(id, moveTransactionsTo);
      }
      await archiveWallet(id);
    },
    onSuccess: (_result, { id, moveTransactionsTo }) =>
      invalidateKeys(queryClient, [
        queryKeys.wallets.lists(),
        queryKeys.wallets.detail(id),
        ...(moveTransactionsTo
          ? [queryKeys.wallets.detail(moveTransactionsTo), queryKeys.transactions.all]
          : []),
      ]),
  });
}
