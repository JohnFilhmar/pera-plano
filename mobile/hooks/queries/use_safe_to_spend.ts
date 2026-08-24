// hooks/queries/use_safe_to_spend.ts — M3 Part 2 Task 4.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { toDateIso } from "@/lib/dates";
import { getSafeToSpend } from "@/lib/safe_to_spend_service";

/**
 * The home screen's headline number.
 *
 * The clock is read HERE — the composition edge — because everything beneath
 * is clock-injected so that the spec's worked example is a fixture. The date
 * and the instant come from ONE read: two would let the calendar day and the
 * period window disagree across midnight, which is exactly when a user is most
 * likely to be looking at a fresh number.
 */
export function useSafeToSpend() {
  return useQuery({
    queryKey: queryKeys.safeToSpend.today(),
    queryFn: () => {
      const now = systemClock.now();
      return getSafeToSpend(toDateIso(new Date(now)), now);
    },
  });
}
