// hooks/mutations/use_mute_limit.ts — m2 Task 8.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { getMonthlyEquivalentIncome } from "@/lib/income/income_service";
import { muteLimitForPeriod } from "@/lib/limits/limit_service";

import { invalidateKeys } from "./invalidate_keys";

/**
 * "Mute for this period" (limits rule 25). Suppresses this Limit's
 * NOTIFICATIONS until the next period boundary; the visual states stay live and
 * thresholds keep being recorded, so a muted limit still shows its progress bar
 * moving and still participates in Safe-to-Spend (rule 30).
 *
 * Passes the monthly-equivalent income because muting may have to CREATE the
 * period's alert state, and a percent-of-income limit's base cannot be derived
 * without it — see `muteLimitForPeriod`, where guessing it writes a ₱20.00 base
 * that then silently stands in for the real one all month.
 *
 * There is no un-mute: rule 25 scopes the mute to the period, and the boundary
 * clears it. A toggle would need a second piece of state meaning "muted, then
 * deliberately un-muted", which nothing in the spec asks for.
 */
export function useMuteLimit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> =>
      muteLimitForPeriod(id, systemClock.now(), await getMonthlyEquivalentIncome()),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.limits.all]),
  });
}
