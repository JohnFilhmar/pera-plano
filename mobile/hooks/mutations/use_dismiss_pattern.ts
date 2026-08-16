// hooks/mutations/use_dismiss_pattern.ts — M3 Part 2 Task 6, plan rule 3.
//
// Not in the brief's own file list, but the Subscriptions screen's "dismiss
// removes the card" needs a mutation to call, and no other hook does this
// write. Same shape as use_acknowledge_pattern.ts next door — a straight
// repository write, no service involvement needed.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { dismissPattern } from "@/lib/db/repos/recurring_patterns_repo";

import { invalidateKeys } from "./invalidate_keys";

export function useDismissPattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patternId: string): Promise<void> => dismissPattern(patternId),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.recurring.all]),
  });
}
