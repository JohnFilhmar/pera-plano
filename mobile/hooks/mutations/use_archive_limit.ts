// hooks/mutations/use_archive_limit.ts — m2 Task 8, retitled 2026-08-20.
//
// WAS use_delete_limit.ts, AND THE RENAME IS THE POINT. The mutation used to
// call `deleteLimit`, which ran a literal `DELETE FROM limits`. The owner's
// rule across the plan entities is now that retiring something never destroys
// what it explains ("no hard delete"), so this calls `archiveLimit` and the
// hook's name says which it is — a hook still called "delete" while archiving
// is how a later reader ends up reasoning about the wrong operation.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { archiveLimit } from "@/lib/db/repos/limits_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Retires a Limit.
 *
 * ARCHIVING A LIMIT NEVER TOUCHES TRANSACTIONS (m2 Global Constraint 11). A
 * limit is a view over the ledger — retiring the view removes no money, and the
 * spend it was counting is still in the user's history.
 *
 * The limit's per-period alert state stays on the row with it (migration 004
 * put it in a column here precisely so it could not be orphaned), so an
 * archived limit remains fully readable rather than half-erased.
 */
export function useArchiveLimit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<void> => archiveLimit(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.limits.all]),
  });
}
