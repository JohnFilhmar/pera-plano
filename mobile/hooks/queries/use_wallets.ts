// hooks/queries/use_wallets.ts — m1c plan Task 3, WIDENED by Task 4.
//
// House shape for every hook in this directory (Rule 1): one key from
// constants/query_keys.ts, one repository call, nothing else. No SQL, no
// filtering, no derived totals — a component that needs money grouped or summed
// does it in the component, where it is visible, not hidden inside a hook that
// looks like a cache read. (Grouping and the credit-excluding total live in
// lib/wallets/summary.ts, as pure functions with their own suite.)
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listWallets } from "@/lib/db/repos/wallets_repo";

export type UseWalletsOptions = {
  /** Append the archived tail (docs/04 §UX states' collapsed "Archived" group). */
  includeArchived?: boolean;
};

/**
 * Every active wallet, oldest first — plus the archived tail when asked.
 *
 * THE FLAG IS PART OF THE KEY, not just an argument to the query function.
 * Task 3 shipped this hook with no options precisely because
 * `queryKeys.wallets.list()` took no parameter: the Wallets tab's "Show
 * archived" toggle and its default view are two different lists, and sharing
 * one cache entry would let whichever resolved first answer for both. The
 * symptom is not an error — it is a toggle that appears to do nothing on a warm
 * cache, or archived rows that stay on screen after being switched off.
 *
 * Task 4 widened the hook and the key together; see `queryKeys.wallets.list`
 * for why the parameter defaults rather than being optional, and
 * `queryKeys.wallets.lists` for the prefix mutations invalidate.
 */
export function useWallets(options: UseWalletsOptions = {}) {
  const includeArchived = options.includeArchived ?? false;
  return useQuery({
    queryKey: queryKeys.wallets.list(includeArchived),
    queryFn: () => listWallets({ includeArchived }),
  });
}
