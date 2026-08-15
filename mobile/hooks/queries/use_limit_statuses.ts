// hooks/queries/use_limit_statuses.ts — m2 Task 8.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { getMonthlyEquivalentIncome } from "@/lib/income/income_service";
import { getLimitStatuses } from "@/lib/limits/limit_service";

/**
 * Every limit resolved against the current period — spend, effective limit,
 * days left and UX state.
 *
 * The clock is read HERE rather than passed in, because this is the composition
 * edge: `limit_service` is clock-injected all the way down precisely so that
 * only this layer touches real time (m2 Global Constraint 6). It is
 * deliberately not part of the query key — see `queryKeys.limits.statuses`.
 */
export function useLimitStatuses() {
  return useQuery({
    queryKey: queryKeys.limits.statuses(),
    queryFn: async () =>
      getLimitStatuses({
        now: systemClock.now(),
        monthlyIncome: await getMonthlyEquivalentIncome(),
      }),
  });
}
