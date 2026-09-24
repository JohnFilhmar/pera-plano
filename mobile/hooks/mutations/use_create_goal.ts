// hooks/mutations/use_create_goal.ts — m2b Task 4.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { createGoal } from "@/lib/db/repos/goals_repo";
import type { NewGoal } from "@/lib/db/repos/goals_repo";
import { emitAppEvent } from "@/lib/events/app_events";
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
    onSuccess: (goal) => {
      // A goal created on a wallet that already sits past a milestone announces
      // the level it starts at, and the milestone pass's own wake-ups are a
      // launch and a ledger commit, neither of which this is. Announced through
      // the bus rather than by calling the pass, so this hook never imports the
      // notification transport; see `goals:changed`.
      void emitAppEvent("goals:changed", { goalId: goal.id });
      invalidateKeys(queryClient, [queryKeys.goals.all, queryKeys.wallets.all]);
    },
  });
}
