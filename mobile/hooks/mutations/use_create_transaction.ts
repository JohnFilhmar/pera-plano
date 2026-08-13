// hooks/mutations/use_create_transaction.ts — m1c plan Task 3.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import type { NewTransaction } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Commits a transaction — manual cash entry today, a confirmed Review Queue
 * item tomorrow. The repository moves the wallet balance in the same SQL
 * transaction, so this hook never adjusts a balance itself.
 *
 * THE KEY SET, and why each one is here (Rule 2):
 *   - `transactions.all` — every ledger list, whatever filter it was keyed
 *     with, plus the new row's own detail. The list keys are parameterized by
 *     filter, so the family root is the narrowest key that reaches all of them.
 *   - `wallets.detail(walletId)` — the ONE wallet whose balance moved. Not
 *     `wallets.all`: no other wallet's detail can have changed.
 *   - `wallets.list()` — its rows carry the same balance that just moved. The
 *     plan's rule text names only the detail key; without the list too, the
 *     Wallets tab would keep showing the pre-transaction balance for up to the
 *     client's five-minute staleTime, which is the exact silent disagreement
 *     between a total and its ledger that this app may never produce.
 *   - `reviewQueue.count()` — committing is how a queue item stops being open,
 *     so the tab badge has to re-count.
 *
 * Nothing else. Categories, settings and the rest cannot be changed by
 * committing a transaction, and a keyless `invalidateQueries()` would refetch
 * all of them on every incoming notification.
 */
export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewTransaction) => insertTransaction(input),
    onSuccess: (transaction) =>
      invalidateKeys(queryClient, [
        queryKeys.transactions.all,
        queryKeys.wallets.detail(transaction.walletId),
        queryKeys.wallets.list(),
        queryKeys.reviewQueue.count(),
      ]),
  });
}
