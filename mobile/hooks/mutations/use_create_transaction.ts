// hooks/mutations/use_create_transaction.ts — m1c plan Task 3.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { raiseLoanMatchAfterCommit } from "@/lib/loans/loan_match_queue";
import type { NewTransaction, Transaction } from "@/types/domain";

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
 *   - `wallets.lists()` — the rows there carry the same balance that just
 *     moved. The plan's rule text names only the detail key; without the list
 *     too, the Wallets tab would keep showing the pre-transaction balance for
 *     up to the client's five-minute staleTime, which is the exact silent
 *     disagreement between a total and its ledger that this app may never
 *     produce. It is the PREFIX, not `list(false)`: m1c Task 4 keyed the list
 *     by the "Show archived" toggle, and a user looking at the archived view
 *     is owed the same refresh as one looking at the default view.
 *   - `reviewQueue.all` — committing is how a queue item stops being open, so
 *     the tab badge has to re-count. WIDENED from `count()` to the family root
 *     when the loan matcher was wired in below: a commit can now ADD an item as
 *     well as close one, and a user who adds a repayment by hand and then opens
 *     Review would otherwise find a badge with nothing under it.
 *
 * Nothing else. Categories, settings and the rest cannot be changed by
 * committing a transaction, and a keyless `invalidateQueries()` would refetch
 * all of them on every incoming notification.
 */

/**
 * The manual half of loans spec rule 8 step 1 — "after a Transaction commits to
 * the ledger, the matcher scores it against open loans".
 *
 * THE LEDGER HAS TWO DOORS AND THE RULE SAYS "a Transaction", NOT "a
 * notification". `lib/ingest/pipeline.ts` carries the same call for captures;
 * this is the other door — Transactions tab -> add, and anything else that goes
 * through this hook. Wiring only the pipeline would mean a cash repayment the
 * user typed in themselves is the one payment the app never offers to match,
 * which is the exact case the loan-detail screen was already worst at.
 *
 * IN THE `mutationFn`, NOT `onSuccess`. `reviewQueue.count()` is invalidated
 * below and the tab badge reads it; raising the card after that invalidation
 * would refetch a count taken before the card existed, leaving the badge one
 * short until its own 30-second poll caught up.
 *
 * NOT `useCorrectWalletBalance` / `useReconcileCash`, which insert through the
 * repository directly: both write a reconciliation adjustment against a wallet
 * the user is staring at, not a payment to anybody, and offering to book one as
 * a loan repayment would be the app inventing a counterparty.
 *
 * `raiseLoanMatchAfterCommit` cannot throw — see its own note. A matcher fault
 * must not turn a committed transaction into a failed mutation, because the
 * user's next move is to type it in again.
 */
async function commitAndScore(input: NewTransaction): Promise<Transaction> {
  const transaction = await insertTransaction(input);
  await raiseLoanMatchAfterCommit(transaction);
  return transaction;
}

export function useCreateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewTransaction) => commitAndScore(input),
    onSuccess: (transaction) =>
      invalidateKeys(queryClient, [
        queryKeys.transactions.all,
        queryKeys.wallets.detail(transaction.walletId),
        queryKeys.wallets.lists(),
        queryKeys.reviewQueue.all,
      ]),
  });
}
