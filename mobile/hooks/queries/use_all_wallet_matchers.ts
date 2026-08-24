// hooks/queries/use_all_wallet_matchers.ts — m1c plan Task 5, rule 2.
//
// Every matcher on the device, so the picker can say WHOSE pair it is about to
// take. `useWalletMatchers(walletId)` answers "what does this wallet catch?";
// this answers "who already catches this?", which is a different question and
// deliberately a different cache entry.
//
// It is a whole-table read on purpose. The alternative — querying
// `findWalletForPackage` once per provider row the user touches — turns a
// warning that must appear the instant a chip is tapped into a chain of async
// round trips, and a warning that arrives after the tap is a warning the user
// has already tapped past.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listMatchers } from "@/lib/db/repos/wallet_matchers_repo";

export function useAllWalletMatchers() {
  return useQuery({
    queryKey: queryKeys.wallets.allMatchers(),
    queryFn: () => listMatchers(),
  });
}
