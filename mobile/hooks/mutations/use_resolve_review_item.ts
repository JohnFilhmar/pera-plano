// hooks/mutations/use_resolve_review_item.ts — m1c plan Task 3.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { resolve } from "@/lib/db/repos/review_queue_repo";
import type { ReviewResolution } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type ResolveReviewItemVariables = {
  id: string;
  resolution: ReviewResolution;
};

/**
 * Marks a review item closed. Idempotent in the repository, so a double-tap in
 * the triage list cannot overwrite the original `resolved_at`.
 *
 * RESOLVING COMMITS NOTHING BY ITSELF — the transaction, the transfer link or
 * the user rule that a triage action produces is written by its own call, and
 * queue items are never transactions (invariant I13). So this invalidates the
 * review-queue family (the open list shrinks, the badge count drops) and
 * deliberately leaves the ledger keys alone.
 */
export function useResolveReviewItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, resolution }: ResolveReviewItemVariables) => resolve(id, resolution),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.reviewQueue.all]),
  });
}
