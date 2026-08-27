// hooks/queries/use_review_kind_counts.ts — how many open items of each kind,
// for the Review Queue's filter chips.
//
// NO `refetchInterval`. `use_review_count.ts` holds the app's ONE poller (Rule
// 4) because the tab badge has to move while nobody is looking at it; this read
// backs chips on a screen the user is already on, where every change to the
// numbers comes from a triage action that invalidates `reviewQueue.all` on
// success. A second 30-second timer would wake the database for a screen that
// already knows exactly when its own data changed.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { countOpenByKind } from "@/lib/db/repos/review_queue_repo";

/** Open-item counts keyed by kind — every kind present, zeroes included. */
export function useReviewKindCounts() {
  return useQuery({
    queryKey: queryKeys.reviewQueue.kindCounts(),
    queryFn: () => countOpenByKind(),
  });
}
