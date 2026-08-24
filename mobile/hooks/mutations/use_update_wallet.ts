// hooks/mutations/use_update_wallet.ts — m1c plan Task 3.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { updateWallet } from "@/lib/db/repos/wallets_repo";
import type { Wallet } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type UpdateWalletVariables = {
  id: string;
  patch: Partial<Pick<Wallet, "name" | "type">>;
};

/**
 * Renames or re-types a wallet.
 *
 * Invalidates the list (its row shows the name) and THIS wallet's detail —
 * not `wallets.all`, which would also drop every other wallet's cached detail
 * for an edit that cannot have touched them.
 */
export function useUpdateWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateWalletVariables) => updateWallet(id, patch),
    onSuccess: (wallet) =>
      invalidateKeys(queryClient, [
        queryKeys.wallets.lists(),
        queryKeys.wallets.detail(wallet.id),
      ]),
  });
}
