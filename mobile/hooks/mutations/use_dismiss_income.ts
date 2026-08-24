// hooks/mutations/use_dismiss_income.ts — m2-part2 Task 13.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { dismissDetectedIncome } from "@/lib/income/income_service";

import { invalidateKeys } from "./invalidate_keys";

/**
 * The user said "not right" (income flow 2, "Dismiss").
 *
 * Records the SIGNATURE of what was turned down, not a flag, so a genuinely
 * different suggestion later — a raise, a new employer — can still ask. Nothing
 * about the applied income changes, so the limits family is deliberately NOT
 * invalidated here.
 */
export function useDismissIncome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (): Promise<void> => dismissDetectedIncome(systemClock.now()),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.income.all]),
  });
}
