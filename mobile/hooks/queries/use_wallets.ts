// hooks/queries/use_wallets.ts — m1c plan Task 3.
//
// House shape for every hook in this directory (Rule 1): one key from
// constants/query_keys.ts, one repository call, nothing else. No SQL, no
// filtering, no derived totals — a component that needs money grouped or summed
// does it in the component, where it is visible, not hidden inside a hook that
// looks like a cache read.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listWallets } from "@/lib/db/repos/wallets_repo";

/**
 * Every active wallet, oldest first. Archived wallets are excluded — they are
 * what `listWallets({ includeArchived: true })` is for, and exposing that flag
 * here would need a key that varies with it (the way
 * `queryKeys.transactions.list(filter)` does) or the toggled and untoggled
 * lists would silently share one cache entry. The m1c Wallets tab owns that
 * toggle; it can widen this hook and its key together when it builds it.
 */
export function useWallets() {
  return useQuery({
    queryKey: queryKeys.wallets.list(),
    queryFn: () => listWallets(),
  });
}
