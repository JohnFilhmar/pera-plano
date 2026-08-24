// hooks/mutations/use_unlink_transfer.ts — m1c plan Task 3.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { unlinkTransfer } from "@/lib/db/repos/transfer_links_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Breaks a transfer pairing: both legs revert to countable and the link is
 * marked dissolved (never deleted). Takes the LINK id, not a leg id.
 *
 * Same key set and same reasoning as `useLinkTransfer` — both legs' rows change
 * appearance and re-enter spend totals, but no wallet balance moves.
 */
export function useUnlinkTransfer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unlinkTransfer(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.transactions.all]),
  });
}
