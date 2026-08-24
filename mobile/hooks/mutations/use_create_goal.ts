// hooks/mutations/use_create_goal.ts — m2b Task 4.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { createGoal } from "@/lib/db/repos/goals_repo";
import type { NewGoal } from "@/lib/db/repos/goals_repo";
import type { Goal } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Creates a Goal.
 *
 * NO ENTITLEMENT CHECK HERE — `canCreateGoal` is a call-site gate (m2 Global
 * Constraint 10) and belongs on the screen, which is the only place with an
 * upgrade sheet to open. A repository-level refusal surfaces as a thrown
 * mutation with no way forward.
 *
 * Invalidates WALLETS as well as goals: a goal binds a savings wallet
 * (invariant I10), so the wallet picker on any other screen must stop offering
 * it the moment this succeeds.
 */
export function useCreateGoal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewGoal): Promise<Goal> => createGoal(input),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.goals.all, queryKeys.wallets.all]),
  });
}
