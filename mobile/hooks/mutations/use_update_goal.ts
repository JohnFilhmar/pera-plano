// hooks/mutations/use_update_goal.ts — owner's device report: "unable to edit
// goals".
//
// The same hole `use_update_bill.ts` was written to close, in the one place it
// was still open. `updateGoal` has existed in lib/db/repos/goals_repo.ts since
// m2b, with the clearing semantics for `targetDate` and `contributionRule`
// deliberately worked out — and no screen ever called it. A goal detail screen
// offered exactly one action, "Delete goal", so a mistyped target or a date
// that slipped meant deleting the goal and building it again.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { updateGoal } from "@/lib/db/repos/goals_repo";
import type { NewGoal } from "@/lib/db/repos/goals_repo";
import type { Goal } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type UpdateGoalVariables = { id: string; patch: Partial<NewGoal> };

/**
 * Edits a Goal.
 *
 * THE MONEY IS NEVER TOUCHED, exactly as with delete (goals_repo rule 3):
 * progress IS the linked account's balance, so changing the target or the
 * deadline re-frames the same pesos rather than moving any.
 *
 * Wallets are invalidated alongside goals because the linked account can be
 * changed here. `linked_wallet_id` is UNIQUE, so a re-link both frees the old
 * wallet and claims a new one — and the create form reads that same list to
 * decide what it may offer.
 */
export function useUpdateGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: UpdateGoalVariables): Promise<Goal> => updateGoal(id, patch),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.goals.all, queryKeys.wallets.all]),
  });
}
