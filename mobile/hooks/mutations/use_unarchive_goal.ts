// hooks/mutations/use_unarchive_goal.ts — the other half of use_delete_goal.ts.
//
// Owner's device report: "no way to see and unarchive archived goals and the
// same for other planned tabs". Goals were the last Plan entity that hard-
// deleted, so unlike bills, limits, loans and wallets there was not even a row
// left to bring back until migration 016.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { unarchiveGoal } from "@/lib/db/repos/goals_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Restores a deleted Goal.
 *
 * THIS ONE CAN FAIL, unlike the other restores. Deleting a goal frees its
 * savings account, so the user may have started a new goal on that wallet since
 * — and only one live goal may hold a wallet. `unarchiveGoal` raises
 * `WalletAlreadyHasGoalError` rather than letting migration 016's partial
 * unique index reject the write as a raw constraint error, so the screen has
 * something it can turn into a sentence.
 *
 * Wallets are invalidated alongside goals for the mirror of the reason deleting
 * invalidates them: restoring RE-CLAIMS the savings account, and the create
 * form reads that same list to decide what it may still offer.
 */
export function useUnarchiveGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<void> => unarchiveGoal(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.goals.all, queryKeys.wallets.all]),
  });
}
