// hooks/mutations/use_skip_bill_cycle.ts — m2c Task 5.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { cancelCycleReminders } from "@/lib/bills/bill_reminders";
import { skipCycle } from "@/lib/db/repos/bills_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * The spec's "Skip this cycle": a promo month, an advance payment, a landlord
 * waiving rent. Resolves the cycle with no payment, removes it from
 * Safe-to-Spend, and — like paying — silences its remaining reminders, since
 * nothing is owed for it.
 */
export function useSkipBillCycle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ billId, dueDate }: { billId: string; dueDate: string }) => {
      const cycle = await skipCycle({ billId, dueDate });
      try {
        await cancelCycleReminders(billId, dueDate);
      } catch (error) {
        console.warn("bill reminders could not be cancelled", error);
      }
      return cycle;
    },
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.bills.all]),
  });
}
