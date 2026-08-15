// hooks/mutations/use_confirm_payment_match.ts — m2b Task 8, rule 5.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { confirmPaymentMatch } from "@/lib/loans/loans_service";
import type { LoanPayment } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type ConfirmPaymentMatchVariables = { loanId: string; transactionId: string };

/**
 * Records the match the user confirmed.
 *
 * INVALIDATES TRANSACTIONS TOO, not just loans. The match does not change the
 * transaction row, but it changes what the transaction MEANS: it is now
 * excluded from income cadence detection (loans rule 17), and any screen
 * showing income or a payment suggestion for it is holding a stale answer.
 */
export function useConfirmPaymentMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ loanId, transactionId }: ConfirmPaymentMatchVariables): Promise<LoanPayment> =>
      confirmPaymentMatch(loanId, transactionId),
    onSuccess: () =>
      invalidateKeys(queryClient, [
        queryKeys.loans.all,
        queryKeys.transactions.all,
        queryKeys.income.all,
      ]),
  });
}
