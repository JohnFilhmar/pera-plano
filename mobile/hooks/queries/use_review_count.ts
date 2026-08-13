// hooks/queries/use_review_count.ts — m1c plan Task 3.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { countOpen } from "@/lib/db/repos/review_queue_repo";

/**
 * How often the tab badge re-counts. THIS IS THE ONLY POLLING INTERVAL IN THE
 * APP (Rule 4). The badge has to move on its own because the thing that fills
 * the queue — an incoming notification hitting the ingest pipeline — happens
 * without any user interaction to hang a refetch off. Nothing else does, and
 * every extra poller wakes the database behind a lock screen, on battery, for a
 * screen nobody is looking at.
 */
export const REVIEW_COUNT_POLL_MS = 30 * 1000;

/** The open-item count behind the Transactions tab badge. */
export function useReviewCount() {
  return useQuery({
    queryKey: queryKeys.reviewQueue.count(),
    queryFn: () => countOpen(),
    refetchInterval: REVIEW_COUNT_POLL_MS,
  });
}
