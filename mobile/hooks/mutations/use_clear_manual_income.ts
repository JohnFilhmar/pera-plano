// hooks/mutations/use_clear_manual_income.ts — m2-part2 Task 13.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { clearManualIncome } from "@/lib/income/income_service";
import type { IncomeSummary } from "@/lib/income/income_service";

import { invalidateKeys } from "./invalidate_keys";

/**
 * "Switch to automatic" (income rule 15). Adopts the current confirmed
 * detection; with none, income returns to Unknown and percent-of-income Limits
 * pause — which is why this invalidates the limits family as well.
 */
export function useClearManualIncome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (): Promise<IncomeSummary> => clearManualIncome(systemClock.now()),
    onSuccess: () =>
      invalidateKeys(queryClient, [queryKeys.income.all, queryKeys.limits.all]),
  });
}
