// hooks/mutations/use_create_bill.ts — m2c Task 5.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import type { BillFormValues } from "@/components/bills/bill_form";
import { createBill } from "@/lib/db/repos/bills_repo";
import type { Bill } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * INVALIDATES SAFE-TO-SPEND'S INPUT TOO, once M3 adds it: a new bill changes
 * what is spendable the moment it exists (spec rule 9), not the next time the
 * home screen happens to refetch.
 */
export function useCreateBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: BillFormValues): Promise<Bill> =>
      createBill({
        name: values.name,
        amount: values.amount,
        amountMode: values.amountMode,
        dueRule: values.dueRule,
        reminderOffsets: values.reminderOffsets,
        // Seeded from the name the user typed — the spec's create flow proposes
        // merchant keywords, and the bill's own name is the honest first guess.
        autoMatchRule: { merchantPattern: values.name, dateWindowDays: 7 },
      }),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.bills.all]),
  });
}
