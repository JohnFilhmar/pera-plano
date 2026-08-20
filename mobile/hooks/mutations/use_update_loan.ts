// hooks/mutations/use_update_loan.ts — owner's device report: a loan "should
// also be modifable".
//
// Same shape of gap as bills: `updateLoan` has existed in
// lib/db/repos/loans_repo.ts since m2b and nothing in the app called it.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { updateLoan } from "@/lib/db/repos/loans_repo";
import type { NewLoan } from "@/lib/db/repos/loans_repo";
import type { Loan } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type UpdateLoanVariables = { id: string; patch: Partial<NewLoan> };

/**
 * Edits a Loan.
 *
 * IT NEVER TOUCHES RECORDED PAYMENTS. `loan_payments` and `loan_adjustments`
 * are separate tables keyed on the loan id, so correcting a counterparty's name
 * or a wrong principal leaves every matched Transaction exactly where it is —
 * which is what makes an edit safe to offer at all rather than forcing the
 * archive-and-recreate that loses the history.
 *
 * A BALANCE CORRECTION IS NOT AN EDIT. `recordAdjustment` exists for that and
 * requires a note (loans rule 13); editing `principal` here restates what was
 * borrowed, which is a different claim from "the balance moved for a reason".
 */
export function useUpdateLoan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: UpdateLoanVariables): Promise<Loan> => updateLoan(id, patch),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.loans.all]),
  });
}
