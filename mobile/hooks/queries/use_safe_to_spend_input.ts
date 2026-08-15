// hooks/queries/use_safe_to_spend_input.ts — M3 Part 2 Task 4, rule 4.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { toDateIso } from "@/lib/dates";
import { buildSafeToSpendInput } from "@/lib/safe_to_spend_service";

/**
 * The assembled INPUT, which the projection needs and the hero does not.
 *
 * A second query rather than widening `useSafeToSpend`'s return: the projection
 * is Plus-only, and a free user should not pay the assembly cost of a curve
 * their build will not draw. Sharing the `safeToSpend` root means both are
 * invalidated by the same nine triggers, so the curve can never lag the number
 * it sits under.
 */
export function useSafeToSpendInput() {
  return useQuery({
    queryKey: [...queryKeys.safeToSpend.all, "input"] as const,
    queryFn: () => {
      const now = systemClock.now();
      return buildSafeToSpendInput(toDateIso(new Date(now)), now);
    },
  });
}
