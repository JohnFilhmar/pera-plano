// hooks/queries/use_raw_captures.ts — the Privacy centre's "What PeraPlano
// captured" list (m3b Task 6 rule 3).
//
// A SIBLING of hooks/queries/use_raw_capture.ts, not a replacement — that
// file answers "what did we capture for THIS Transaction"; this answers
// "what has this device captured, period". Both read raw_notifications
// through lib/db/repos/raw_notifications_repo.ts, never a component
// importing the repository directly (global constraint: components never
// import lib/db/repos/**).
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listRawCaptures } from "@/lib/db/repos/raw_notifications_repo";

/**
 * Every unexpired capture, newest-captured first.
 *
 * `Date.now()` IS READ HERE, AT THE EDGE — not inside `listRawCaptures`
 * itself, which takes `now` as a parameter precisely so it can be pinned in
 * a test. This hook is the "edge" that supplies the live clock, the same
 * place `lib/bootstrap.ts`'s `runRetention(Date.now())` and every mutation
 * hook that timestamps a write (e.g. hooks/mutations/use_reconcile_cash.ts)
 * read it — pure/testable functions take `now` explicitly, and only the
 * outermost caller actually asks the system clock.
 */
export function useRawCaptures() {
  return useQuery({
    queryKey: queryKeys.rawCaptures.list(),
    queryFn: () => listRawCaptures(Date.now()),
  });
}
