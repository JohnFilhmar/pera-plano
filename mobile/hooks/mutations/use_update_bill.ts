// hooks/mutations/use_update_bill.ts — owner's device report: a bill "should
// also be modifable".
//
// `updateBill` has existed in lib/db/repos/bills_repo.ts since m2c, with the
// clearing semantics for `autoMatchRule` carefully worked out — and no screen
// ever called it. A user who mistyped an amount or picked the wrong due rule
// had to archive the bill and build a new one, losing its payment history and
// with it the estimator's inputs.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { updateBill } from "@/lib/db/repos/bills_repo";
import type { NewBill } from "@/lib/db/repos/bills_repo";
import type { Bill } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type UpdateBillVariables = { id: string; patch: Partial<NewBill> };

/**
 * Edits a Bill.
 *
 * THE EDIT DOES NOT RESOLVE ANY CYCLE. `updateBill` writes the bill row only;
 * open cycles keep their own state (paid, skipped, overdue counts) in
 * `bill_cycles`, which is what spec rule 25's "two cycles open at once,
 * resolved independently" requires. Changing the amount of a bill therefore
 * re-estimates FUTURE cycles without silently rewriting one the user already
 * settled.
 *
 * Invalidates the family root: a due-rule change moves every projected date, so
 * the list, the detail and the derived cycles all go at once.
 */
export function useUpdateBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: UpdateBillVariables): Promise<Bill> => updateBill(id, patch),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.bills.all]),
  });
}
