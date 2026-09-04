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
 * their build will not draw.
 *
 * Sharing the `safeToSpend` root is what keeps the curve from lagging the
 * number it sits under, but ONLY because something invalidates that root.
 * Nothing here does: the triggers are `installSafeToSpendCascade`
 * (lib/query_client.ts), which mirrors an invalidation of any source family —
 * transactions, review queue, bills, goals, limits, income — onto this root,
 * plus the Home screen's own `ledger:committed` handler, its focus effect and
 * its pull-to-refresh. Rule 13's ninth trigger, local-midnight rollover, is
 * NOT among them.
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
