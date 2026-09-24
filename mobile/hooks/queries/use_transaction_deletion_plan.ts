// hooks/queries/use_transaction_deletion_plan.ts — GAP-108.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { planTransactionDeletion } from "@/lib/transactions/delete_transaction_service";

/**
 * What deleting this Transaction would take with it, and whether it may happen
 * at all.
 *
 * READ WHEN THE SCREEN RENDERS, NOT WHEN THE BUTTON IS PRESSED. A confirmation
 * that has to fetch before it can say what it is about either opens empty and
 * fills in under the user's eyes, or opens after a pause on the tap — and this
 * is the dialog guarding the one irreversible action on the screen. Reading it
 * with the row also lets the button say up front that it cannot run, instead of
 * accepting a tap and then refusing.
 */
export function useTransactionDeletionPlan(id: string) {
  return useQuery({
    queryKey: queryKeys.transactions.deletionPlan(id),
    queryFn: () => planTransactionDeletion(id),
  });
}
