// hooks/mutations/use_update_transaction.ts — m1c plan Task 3.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { updateTransaction, type TransactionPatch } from "@/lib/db/repos/transactions_repo";

import { invalidateKeys } from "./invalidate_keys";

export type UpdateTransactionVariables = {
  id: string;
  patch: TransactionPatch;
};

/**
 * Edits a committed transaction — the detail screen's category and note edits,
 * and the Review Queue's "Correct" action. The repository settles the wallet
 * balances the edit moves; this hook only says what went stale.
 *
 * The wallet half of the key set depends on ONE thing: whether the edit moved
 * the transaction to a different wallet. If it did, two balances changed and
 * the ORIGIN wallet's id is not on the row the repository hands back, so the
 * wallets family root is the narrowest key that is still sufficient. If it did
 * not, exactly one wallet is affected and it is named directly.
 */
export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateTransactionVariables) => updateTransaction(id, patch),
    onSuccess: (transaction, { patch }) =>
      invalidateKeys(queryClient, [
        queryKeys.transactions.all,
        ...(patch.walletId === undefined
          ? [queryKeys.wallets.list(), queryKeys.wallets.detail(transaction.walletId)]
          : [queryKeys.wallets.all]),
      ]),
  });
}
