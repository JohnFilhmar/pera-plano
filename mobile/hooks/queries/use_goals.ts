// hooks/queries/use_goals.ts — m2b Task 4.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { listGoalStatuses } from "@/lib/goals/goals_service";
import { getIncomeSummary } from "@/lib/income/income_service";

/**
 * Every goal with its progress and pace.
 *
 * PACE NEEDS INCOME, so this hook is where the two features meet. Goals spec
 * rule 9 divides the shortfall by PAYDAYS remaining, which only the
 * IncomeProfile's cadence can say; rule 10's reference pace P is the goal's own
 * `contributionRule` when it has one. With no income yet, `cadence: null` falls
 * back to a per-month figure rather than refusing to show a pace at all — a
 * monthly number is still actionable, and the alternative is a blank chip.
 *
 * One clock read, shared — two reads can straddle a payday boundary and count
 * a period twice.
 */
export function useGoals() {
  return useQuery({
    queryKey: queryKeys.goals.list(),
    queryFn: async () => {
      const now = systemClock.now();
      const income = await getIncomeSummary(now);
      return listGoalStatuses(now, (goal) => ({
        cadence: income.cadence,
        referencePace:
          goal.contributionRule === null
            ? null
            : goal.contributionRule.kind === "fixed"
              ? goal.contributionRule.amount
              : // A percent rule's peso value depends on the payday, so the
                // best available estimate of P is that percentage of the
                // average pay — which is exactly what `averageAmount` is.
                Math.round(((income.averageAmount ?? 0) * goal.contributionRule.percent) / 100),
      }));
    },
  });
}
