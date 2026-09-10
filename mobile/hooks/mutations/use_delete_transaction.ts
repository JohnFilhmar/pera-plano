// hooks/mutations/use_delete_transaction.ts — GAP-108. The ledger half of
// docs/04-features/08-review-queue.md rule 9.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { deleteTransactionAndLinks } from "@/lib/transactions/delete_transaction_service";
import type { Transaction } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Removes a committed Transaction and gives its Wallet the money back.
 *
 * A REAL DELETE, NOT AN ARCHIVE, which is the opposite call from `useDeleteGoal`
 * and `useArchiveLimit` next door — and the difference is what the row IS. A
 * goal or a limit is a lens the user built over money that stays real, so
 * retiring one must never destroy what it explains. A wrongly confirmed
 * transaction explains nothing: it is a movement that did not happen, and every
 * total that includes it is wrong for as long as it is there. There is nothing
 * to preserve and no compensating row to write — `docs` is explicit that a
 * negative twin would double the ledger and corrupt every total.
 *
 * THE KEY SET, and why each is here (invalidate_keys.ts rule 2):
 *   - `transactions.all` — every ledger list, the detail this was deleted from,
 *     and the deletion plan nested under it.
 *   - `wallets.detail(walletId)` and `wallets.lists()` — the one balance that
 *     moved, and the rows that quote it. Same pair, same reasoning, as
 *     `useCreateTransaction`: this is that write run backwards.
 *   - `reviewQueue.all` — the delete can close an open loan-match card and can
 *     write a resolved capture marker, so the tab badge has to re-count.
 *   - `loans.all` and `bills.all` — UNCONDITIONAL, though most deletes release
 *     neither. The service decides what to release from state this hook does
 *     not read, and re-deriving that here would be the same rule in two places,
 *     with a loan balance left quoting a payment that no longer exists when the
 *     copies drift. The blanket-invalidation cost the rule exists to prevent is
 *     a per-notification one; a delete is a rare, deliberate tap.
 *
 * Safe-to-Spend needs no entry: `installSafeToSpendCascade` (lib/query_client.ts)
 * follows `transactions.all` on its own.
 */
export function useDeleteTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<Transaction> => deleteTransactionAndLinks(id),
    onSuccess: (transaction) =>
      invalidateKeys(queryClient, [
        queryKeys.transactions.all,
        queryKeys.wallets.detail(transaction.walletId),
        queryKeys.wallets.lists(),
        queryKeys.reviewQueue.all,
        queryKeys.loans.all,
        queryKeys.bills.all,
      ]),
  });
}
