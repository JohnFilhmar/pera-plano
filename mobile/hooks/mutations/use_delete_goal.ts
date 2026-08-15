// hooks/mutations/use_delete_goal.ts — m2b Task 4.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { deleteGoal } from "@/lib/db/repos/goals_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Deletes a Goal.
 *
 * THE WALLET AND ITS MONEY SURVIVE (goals_repo rule 3): the money is real, the
 * goal is only a lens over it.
 *
 * Wallets are invalidated too, because deleting the goal FREES its savings
 * wallet — `linked_wallet_id` is UNIQUE, so until this write lands no other
 * goal may bind that account. The create form has to start offering it again
 * immediately, or the user cannot reuse the wallet they just released.
 */
export function useDeleteGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<void> => deleteGoal(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.goals.all, queryKeys.wallets.all]),
  });
}
