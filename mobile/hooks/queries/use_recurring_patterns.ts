// hooks/queries/use_recurring_patterns.ts — M3 Part 2 Task 6.
//
// House shape (hooks/queries/use_wallets.ts's rule 1): one key, one
// repository call, nothing else. `monthlyLockedIn` is a derived total, so the
// screen computes it from the raw list rather than this hook hiding it.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listPatterns } from "@/lib/db/repos/recurring_patterns_repo";

/**
 * Every live pattern, suggested and locked-in alike. `includeAcknowledged:
 * true` because the Subscriptions screen needs both: the acknowledged,
 * not-bill-linked ones to total in `LockedInHeader`, and the rest to offer
 * "make this a bill" / "dismiss" on. Dismissed patterns never come back from
 * `listPatterns` at all (recurring_patterns_repo.ts).
 */
export function useRecurringPatterns() {
  return useQuery({
    queryKey: queryKeys.recurring.list(),
    queryFn: () => listPatterns({ includeAcknowledged: true }),
  });
}
