// hooks/mutations/use_create_wallet.ts — m1c plan Task 3.
//
// House shape for every mutation in this directory: one repository call, then
// a NAMED key set to invalidate (Rule 2). `retry` is never set here — the
// client's `mutations.retry: 0` (lib/query_client.ts) is the whole policy, and
// raising it anywhere would let a failed write replay and double-post money.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import type { NewWallet } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Creates a wallet. Throws `DuplicateNameError` when the name collides with a
 * live wallet — surfaced to the caller through `error`, not swallowed, because
 * the wallet form has to tell the user which name it refused.
 *
 * Invalidates the wallet list only: a brand-new wallet has no detail entry to
 * refresh, holds no transactions, and changes nothing in the ledger.
 */
export function useCreateWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewWallet) => createWallet(input),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.wallets.lists()]),
  });
}
