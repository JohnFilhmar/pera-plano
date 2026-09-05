// hooks/mutations/use_reject_payment_candidates.ts — task-3, D2.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { rejectCandidates } from "@/lib/db/repos/loans_repo";

/**
 * "None of these" (019_loan_match_rejections).
 *
 * INVALIDATES THE LOANS FAMILY, not just the candidate list, because the loan
 * detail screen's own button reads the suggestion COUNT ("3 possible
 * payments"). Dropping the list without dropping the count would close the
 * sheet and leave the number that opened it unchanged, which is the defect this
 * hook exists to fix wearing a different face.
 */
export function useRejectPaymentCandidates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ loanId, transactionIds }: { loanId: string; transactionIds: string[] }) =>
      rejectCandidates(loanId, transactionIds),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.loans.all }),
  });
}
