// hooks/mutations/use_dismiss_pattern.ts — M3 Part 2 Task 6, plan rule 3.
//
// Fix round 2: dismissal also writes a suppressing UserRule (Reports rule 18,
// its Data-touched table, and domain §3.10 invariant 2 all name it), which is
// a second aggregate's write alongside the pattern's own `dismissed_at` — so
// this now goes through `lib/recurring/recurring_service.ts`'s `dismissPattern`
// rather than the repository directly, same shape as `use_promote_to_bill.ts`.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { dismissPattern } from "@/lib/recurring/recurring_service";

import { invalidateKeys } from "./invalidate_keys";

export function useDismissPattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patternId: string): Promise<void> => dismissPattern(patternId, systemClock.now()),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.recurring.all]),
  });
}
