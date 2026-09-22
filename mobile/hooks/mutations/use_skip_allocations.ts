// hooks/mutations/use_skip_allocations.ts: GAP-056.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { skipAllocations } from "@/lib/goals/goals_service";
import type { IsoDate } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Skips payday contributions: from the allocation sheet, or from a goal's
 * pending card.
 *
 * SAFE-TO-SPEND IS NAMED, NOT LEFT TO THE CASCADE. lib/query_client.ts
 * refreshes it when a goals query is invalidated, but only a query that is
 * cached, and the payday sheet can open before the Plan tab ever loaded one.
 * The whole point of a skip is that the headline number rises the same day.
 */
export function useSkipAllocations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (skipped: ReadonlyArray<{ goalId: string; paydayDate: IsoDate }>): Promise<void> =>
      skipAllocations(skipped, systemClock.now()),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.goals.all, queryKeys.safeToSpend.all]),
  });
}
