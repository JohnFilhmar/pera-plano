// hooks/queries/use_payment_candidates.ts — m2b Task 8, rule 5.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { findPaymentCandidates } from "@/lib/loans/loans_service";

/**
 * Transactions that might be payments on this loan — a READ that proposes and
 * writes nothing (spec rule 9).
 *
 * Keyed under the loan's own detail key so confirming a match, which
 * invalidates the loans family, also drops this list: a confirmed candidate
 * must stop being offered, and invariant I12 means it can never be accepted
 * twice anyway.
 */
/** How many unclaimed transactions the "Show every transaction" fallback lists. */
const BROWSE_LIMIT = 50;

export function usePaymentCandidates(loanId: string | undefined, includeBelowFloor = false) {
  return useQuery({
    queryKey: queryKeys.loans.candidates(loanId ?? "", includeBelowFloor),
    enabled: loanId !== undefined && loanId !== "",
    queryFn: () =>
      findPaymentCandidates(
        loanId as string,
        systemClock.now(),
        // The browse-everything list is a search, not a suggestion: capping it
        // at five would hide the very transaction the user opened it to find.
        includeBelowFloor ? BROWSE_LIMIT : undefined,
        includeBelowFloor,
      ),
  });
}
