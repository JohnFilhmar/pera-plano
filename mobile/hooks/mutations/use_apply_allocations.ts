// hooks/mutations/use_apply_allocations.ts — m2b Task 4.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { applyAllocations } from "@/lib/goals/goals_service";
import type { AllocationProposal } from "@/lib/goals/goals_service";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Records the payday moves the user confirmed in the allocation sheet.
 *
 * INVALIDATES FOUR FAMILIES, and each one is load-bearing. Applying writes two
 * transactions and a transfer link, which moves two wallet balances — so goals
 * (progress IS a wallet balance), wallets, transactions and limits all now hold
 * stale answers. Limits especially: the legs are transfer-linked and therefore
 * excluded from spend, and a Plan tab still showing the pre-transfer total
 * would be quietly wrong about how much room the user has left.
 */
export function useApplyAllocations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (proposals: AllocationProposal[]): Promise<string[]> =>
      applyAllocations(proposals, systemClock.now()),
    onSuccess: () =>
      invalidateKeys(queryClient, [
        queryKeys.goals.all,
        queryKeys.wallets.all,
        queryKeys.transactions.all,
        queryKeys.limits.all,
      ]),
  });
}
