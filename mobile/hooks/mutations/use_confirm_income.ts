// hooks/mutations/use_confirm_income.ts — m2-part2 Task 13.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { confirmDetectedIncome } from "@/lib/income/income_service";
import type { IncomeSummary } from "@/lib/income/income_service";

import { invalidateKeys } from "./invalidate_keys";

/**
 * The user accepted the detected income (income flow 2, "Confirm").
 *
 * This is NOT an override: `isManualOverride` stays false and automatic updates
 * continue, because agreeing with what the app found is a different act from
 * typing a figure over it.
 */
export function useConfirmIncome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (): Promise<IncomeSummary> => confirmDetectedIncome(systemClock.now()),
    onSuccess: () =>
      invalidateKeys(queryClient, [queryKeys.income.all, queryKeys.limits.all]),
  });
}
