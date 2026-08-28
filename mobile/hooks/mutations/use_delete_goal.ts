// hooks/mutations/use_delete_goal.ts — m2b Task 4, re-pointed at the soft
// delete in migration 016.
//
// THE HOOK NAME AND THE BUTTON BOTH STILL SAY DELETE. What changed is only what
// happens underneath: `archiveGoal` stamps `archived_at` instead of removing
// the row, so a goal thrown away by mistake can be restored from Plan → Goals
// with its target, deadline, payday rule and created date intact. Rebuilding
// one by hand restarted the pace the app quotes, because that is measured from
// the created date.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { archiveGoal } from "@/lib/db/repos/goals_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Deletes a Goal.
 *
 * THE WALLET AND ITS MONEY SURVIVE (goals_repo rule 3): the money is real, the
 * goal is only a lens over it.
 *
 * Wallets are invalidated too, because deleting the goal FREES its savings
 * wallet — one live goal per wallet, enforced by migration 016's partial unique
 * index, so until this write lands no other goal may bind that account. The
 * create form has to start offering it again immediately, or the user cannot
 * reuse the wallet they just released.
 */
export function useDeleteGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<void> => archiveGoal(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.goals.all, queryKeys.wallets.all]),
  });
}
