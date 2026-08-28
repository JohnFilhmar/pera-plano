// hooks/mutations/use_unarchive_bill.ts — the other half of
// use_archive_bill.ts.
//
// Owner's device report: "no way to see and unarchive archived goals and the
// same for other planned tabs". Archiving was reachable from every plan detail
// screen and restoring was reachable from nowhere, so retiring the wrong row
// was final in practice even though the repository never deleted anything.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { unarchiveBill } from "@/lib/db/repos/bills_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Brings a Bill: it produces cycles, reminders and auto-matches again back out of the archive.
 *
 * Invalidates the same family root the archive mutation does, and for the same
 * reason: restoring puts the row back into every derived read at once — the
 * list, the detail, and anything computed from it.
 */
export function useUnarchiveBill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<void> => unarchiveBill(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.bills.all]),
  });
}
