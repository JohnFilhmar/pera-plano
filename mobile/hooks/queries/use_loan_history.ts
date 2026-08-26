// hooks/queries/use_loan_history.ts — loans rules 7 and 13.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listLoanHistory } from "@/lib/loans/loans_service";

/**
 * This loan's payments and balance adjustments, newest first.
 *
 * NO CLOCK. Unlike `useLoans` and `usePaymentCandidates`, nothing here is
 * relative to now — a history is a record of instants that already happened, so
 * there is no `now` to inject and no reason for this query to go stale on the
 * passage of time alone.
 *
 * `loanId` IS OPTIONAL AND THE QUERY IS DISABLED WITHOUT IT, matching
 * `usePaymentCandidates`'s shape: the detail route reads its id from
 * `useLocalSearchParams`, which is `undefined` for a frame on a deep link, and
 * a query that ran anyway would cache an empty history under the key `""` and
 * then answer with it.
 */
export function useLoanHistory(loanId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.loans.history(loanId ?? ""),
    enabled: loanId !== undefined && loanId !== "",
    queryFn: () => listLoanHistory(loanId as string),
  });
}
