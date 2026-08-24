// hooks/queries/use_daily_spend.ts — mobile-ui-revamp Part 2 Task 1.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { toDateIso } from "@/lib/dates";
import { dailySpend } from "@/lib/db/repos/transactions_repo";

/**
 * The Home hero's seven-bar strip: daily outflow totals for the last `days`
 * days, oldest first, ending today.
 *
 * THE CLOCK IS READ HERE, the composition edge — the same split
 * use_report.ts and use_safe_to_spend.ts draw over their own services:
 * `dailySpend` takes `endingOn` as a plain parameter and never touches the
 * wall clock itself (lib/clock.ts's seam).
 */
export function useDailySpend(days: number) {
  return useQuery({
    queryKey: queryKeys.transactions.dailySpend(days),
    queryFn: () => dailySpend({ days, endingOn: toDateIso(new Date(systemClock.now())) }),
  });
}
