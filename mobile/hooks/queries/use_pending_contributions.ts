// hooks/queries/use_pending_contributions.ts: GAP-056.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { listPendingContributions } from "@/lib/goals/planned_contributions";

/**
 * The latest payday's planned goal contributions still waiting on the user:
 * the goals spec's "Pending allocation" card state. Empty on the free tier.
 *
 * UNDER THE GOALS ROOT, so every goals invalidation (a recording, a skip, an
 * edited rule) refreshes it with the progress it sits beside.
 */
export function usePendingContributions() {
  return useQuery({
    queryKey: queryKeys.goals.pendingContributions(),
    queryFn: () => listPendingContributions(systemClock.now()),
  });
}
