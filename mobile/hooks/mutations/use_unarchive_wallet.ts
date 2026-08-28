// hooks/mutations/use_unarchive_wallet.ts — the other half of
// use_archive_wallet.ts.
//
// Owner's device report: "no way to see and unarchive archived goals and the
// same for other planned tabs". Archiving was reachable from every plan detail
// screen and restoring was reachable from nowhere, so retiring the wrong row
// was final in practice even though the repository never deleted anything.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { unarchiveWallet } from "@/lib/db/repos/wallets_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Brings a Wallet. This one CAN fail: archiving frees a wallet's name for reuse, so a live wallet may have taken it in the meantime, and `unarchiveWallet` throws `DuplicateNameError` rather than creating two live wallets with one name back out of the archive.
 *
 * Invalidates the same family root the archive mutation does, and for the same
 * reason: restoring puts the row back into every derived read at once — the
 * list, the detail, and anything computed from it.
 */
export function useUnarchiveWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<void> => unarchiveWallet(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.wallets.all]),
  });
}
