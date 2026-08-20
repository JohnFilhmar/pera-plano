// hooks/mutations/use_archive_bill.ts — closes a gap, not a new capability.
//
// `archiveBill` has existed in lib/db/repos/bills_repo.ts since migration 006,
// with spec rule 27 written against it — and NOTHING IN THE APP EVER CALLED IT.
// The owner's device report ("plan bills unarchivable") is that gap seen from
// the outside: a bill could be created and paid, and never retired.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { archiveBill } from "@/lib/db/repos/bills_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Retires a Bill: no more cycles, reminders or auto-matching (spec rule 27).
 *
 * NOT A DELETE, and the spec is explicit about why: history and linked
 * transactions are untouched, and the bill's own payment history keeps feeding
 * the estimator for anything that still refers to it.
 *
 * Invalidates the family root rather than the list alone — an archived bill
 * leaves the list AND stops producing cycles, and `list()` and `detail()` both
 * nest under `bills.all`. Safe-to-Spend reads bills too, so its own root goes
 * with it; the query-keys file's own note explains why that one is not nested.
 */
export function useArchiveBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<void> => archiveBill(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.bills.all]),
  });
}
