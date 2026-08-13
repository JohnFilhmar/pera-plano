// hooks/queries/use_review_queue.ts — m1c plan Task 3.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listOpen } from "@/lib/db/repos/review_queue_repo";

/**
 * Open review items, oldest first. The FIFO order comes from the repository and
 * must not be re-sorted here: it is what stops an item rotting at the bottom of
 * the queue until it silently expires.
 */
export function useReviewQueue() {
  return useQuery({
    queryKey: queryKeys.reviewQueue.open(),
    queryFn: () => listOpen(),
  });
}
