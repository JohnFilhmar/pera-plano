// hooks/queries/use_review_queue_page.ts — the Review Queue, one page at a
// time, with an optional kind filter.
//
// WHY THIS EXISTS ALONGSIDE `use_review_queue.ts`. That hook reads `listOpen()`,
// which materializes EVERY open item in one array and mounts a `ReviewCard` for
// each — a component that renders a full parse breakdown, a wallet picker and a
// per-kind body. At the spec's own backlog threshold (>25 items) that is already
// more card than anyone triages in one sitting; at the 500 captures `startIngest`
// can drain in a single pass it is a screen that takes seconds to appear and
// scrolls past the point of usefulness. The unpaged hook stays because it is the
// contract-shaped read (`listOpen` is pinned by interface-contract §3) and other
// callers may still want the whole set; the SCREEN uses this one.
//
// THE FILTER IS PART OF THE QUERY, NOT A `.filter()` ON THE RESULT. Narrowing
// after the page was cut would return short pages — 25 rows read, three of the
// selected kind shown — and an empty first page for any kind that happens not to
// appear in the oldest 25, which reads to the user as "nothing of this type" for
// a queue full of them.
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import {
  listOpenPage,
  REVIEW_PAGE_SIZE,
  type ReviewCursor,
  type ReviewPage,
} from "@/lib/db/repos/review_queue_repo";
import type { ReviewKind } from "@/types/domain";

/**
 * Sorted and de-duplicated, or `null` for "all kinds".
 *
 * The React Query key hashes structurally, so `["a", "b"]` and `["b", "a"]`
 * would be two cache entries for one identical query — two page-1 reads, two
 * scroll positions, and two chances to show a stale copy of the same list.
 */
export function normalizeKinds(kinds: readonly ReviewKind[] | undefined): ReviewKind[] | null {
  if (kinds === undefined || kinds.length === 0) return null;
  return [...new Set(kinds)].sort();
}

/**
 * Open review items, oldest first, in pages of `REVIEW_PAGE_SIZE`.
 *
 * The FIFO order still comes from the repository and must not be re-sorted
 * across pages here: page 2 begins where page 1 ended, so concatenating them in
 * arrival order IS the queue order. (The screen re-sorts the flattened result
 * anyway — see `sortOldestFirst` — for the same defensive reason it always did.)
 */
export function useReviewQueuePage(kinds?: readonly ReviewKind[]) {
  const selected = normalizeKinds(kinds);

  return useInfiniteQuery({
    queryKey: queryKeys.reviewQueue.page(selected),
    queryFn: ({ pageParam }: { pageParam: ReviewCursor | null }) =>
      listOpenPage({
        kinds: selected ?? undefined,
        after: pageParam,
        limit: REVIEW_PAGE_SIZE,
      }),
    initialPageParam: null as ReviewCursor | null,
    // EVERY FILTER IS ITS OWN CACHE ENTRY, so without this each chip press
    // drops the screen to `data === undefined` — which the queue renders as its
    // full-screen loading skeleton. Tapping a chip would blank the list, show
    // five grey bars, and repaint: the visual signature of data being lost, on
    // a screen whose entire job is to be believed about what is waiting.
    // Holding the previous filter's cards until the new page lands makes the
    // swap look like what it is, a narrowing.
    placeholderData: keepPreviousData,
    // `null` from the repo means "that was the last page", so this returns
    // `undefined` and React Query reports `hasNextPage: false`. Returning the
    // cursor unconditionally would leave a "Show more" button that fetches an
    // empty page forever.
    getNextPageParam: (last: ReviewPage) => last.nextCursor ?? undefined,
  });
}
