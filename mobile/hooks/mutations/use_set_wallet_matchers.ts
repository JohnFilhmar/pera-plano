// hooks/mutations/use_set_wallet_matchers.ts — m1c plan Task 5, rules 1 and 2.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { setMatchers } from "@/lib/db/repos/wallet_matchers_repo";
import type { NewWalletMatcher } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type SetWalletMatchersVariables = {
  walletId: string;
  matchers: NewWalletMatcher[];
};

/**
 * Replaces one wallet's matcher set, moving any pair it claims off whichever
 * wallet held it (see `setMatchers` for why the move is not optional).
 *
 * INVALIDATES `wallets.all`, WHICH IS WIDER THAN THIS DIRECTORY'S HABIT, AND
 * DELIBERATELY SO. Every other mutation here names the narrowest sufficient
 * keys, and normally that would be this wallet's `matchers(id)` plus the
 * device-wide `allMatchers()`. But a save can MOVE a pair, and the wallet it
 * moves from is not in the variables — the repository works it out from the
 * rows. Naming only the saving wallet would leave the losing wallet's detail
 * screen still showing "Catches: GCash" for a provider it no longer catches:
 * a screen quietly disagreeing with the pipeline about where money lands, which
 * is exactly the class of silent disagreement this app may never produce.
 *
 * `wallets.all` is `["wallets"]`, the prefix of every wallet key, so it reaches
 * both wallets' details, both matcher reads and the list. It does NOT reach
 * transactions, categories or the ruleset — a matcher change cannot have
 * touched those, and a keyless `invalidateQueries()` would refetch all of them.
 */
export function useSetWalletMatchers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ walletId, matchers }: SetWalletMatchersVariables) =>
      setMatchers(walletId, matchers),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.wallets.all]),
  });
}
