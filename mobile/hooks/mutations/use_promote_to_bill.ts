// hooks/mutations/use_promote_to_bill.ts — M3 Part 2 Task 6, plan rule 2.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { promotePatternToBill } from "@/lib/recurring/recurring_service";
import type { Bill } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * "Make this a bill". Invalidates BOTH families: the pattern's own
 * `acknowledged`/`bill_id` changed (bills rules 28-29), and a new Bill now
 * exists for the Bills list to show.
 */
export function usePromoteToBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patternId: string): Promise<Bill> =>
      promotePatternToBill(patternId, systemClock.now()),
    onSuccess: () =>
      invalidateKeys(queryClient, [queryKeys.recurring.all, queryKeys.bills.all]),
  });
}
