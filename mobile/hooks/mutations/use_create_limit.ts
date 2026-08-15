// hooks/mutations/use_create_limit.ts — m2 Task 8.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { createLimit } from "@/lib/db/repos/limits_repo";
import type { NewLimit } from "@/types/control";
import type { Limit } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Creates a Limit. Limits spec step 7: "The Limit starts measuring immediately,
 * using spend already recorded in the current period" — which needs no work
 * here, because `getLimitStatuses` resolves the window and sums the ledger on
 * the next read.
 *
 * NO ENTITLEMENT CHECK HERE. `canCreateLimit` is a call-site gate (m2 Global
 * Constraint 10) and lives on the screen, where there is somewhere to send the
 * user when it says no. A repository-level refusal would surface as a thrown
 * mutation with no upgrade path attached.
 *
 * Invalidates the family root: a new limit changes the list AND every derived
 * status, and `statuses()` and `list()` both nest under `limits.all`.
 */
export function useCreateLimit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: NewLimit): Promise<Limit> => createLimit(input),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.limits.all]),
  });
}
