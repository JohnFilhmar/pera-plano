// hooks/queries/use_income_summary.ts — m2-part2 Task 13.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { getIncomeSummary } from "@/lib/income/income_service";

/**
 * The user's income as every screen sees it — manual values when they set them,
 * detection's belief otherwise (income rule 14).
 *
 * READS, NEVER REFRESHES. `refreshIncomeDetection` writes detection state and
 * belongs to bootstrap and the ledger-commit subscriber (Task 14); running it
 * from a render would let opening a screen change what the app believes about
 * the user's pay, and two concurrent renders would both write it. The same
 * split `getLimitStatuses` keeps from `recomputeLimits`.
 */
export function useIncomeSummary() {
  return useQuery({
    queryKey: queryKeys.income.summary(),
    queryFn: () => getIncomeSummary(systemClock.now()),
  });
}
