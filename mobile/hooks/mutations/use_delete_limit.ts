// hooks/mutations/use_delete_limit.ts — m2 Task 8.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { deleteLimit } from "@/lib/db/repos/limits_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Deletes a Limit.
 *
 * DELETING A LIMIT NEVER TOUCHES TRANSACTIONS (m2 Global Constraint 11). A
 * limit is a view over the ledger — removing the view removes no money, and the
 * spend it was counting is still in the user's history.
 *
 * The limit's per-period alert state goes with it, because it lives in the same
 * row (migration 004). There is no orphan to clean up.
 */
export function useDeleteLimit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<void> => deleteLimit(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.limits.all]),
  });
}
