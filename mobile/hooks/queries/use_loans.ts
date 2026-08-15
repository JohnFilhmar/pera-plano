// hooks/queries/use_loans.ts — m2b Task 8.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { listLoanStatuses } from "@/lib/loans/loans_service";

/**
 * Every loan with its balance, next due and overdue state.
 *
 * The clock is read HERE — the composition edge — because `listLoanStatuses`
 * is clock-injected all the way down so that a loan due today and a loan a day
 * overdue are both ordinary fixtures.
 */
export function useLoans() {
  return useQuery({
    queryKey: queryKeys.loans.list(),
    queryFn: () => listLoanStatuses(systemClock.now()),
  });
}
