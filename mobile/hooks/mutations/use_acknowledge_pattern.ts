// hooks/mutations/use_acknowledge_pattern.ts — M3 Part 2 Task 6.
//
// A straight repository write, no business logic to route through a service —
// same call as hooks/mutations/use_dismiss_drift.ts makes for wallets.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { acknowledgePattern } from "@/lib/db/repos/recurring_patterns_repo";

import { invalidateKeys } from "./invalidate_keys";

/** "This is a real recurring commitment" — rolls the pattern into the locked-in total. */
export function useAcknowledgePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patternId: string): Promise<void> => acknowledgePattern(patternId),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.recurring.all]),
  });
}
