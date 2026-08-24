// hooks/queries/use_transactions.ts — m1c plan Task 3.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import type { TxFilter } from "@/types/domain";

/**
 * The ledger, reverse-chronological, filtered by the repository.
 *
 * THE FILTER IS PART OF THE KEY, not just an argument to the query function.
 * `queryKeys.transactions.list(filter)` varies with it, so a wallet-filtered
 * screen and an unfiltered one hold two separate cache entries. Keyed on
 * `transactions.list()` alone, whichever query resolved first would answer for
 * both — a filtered screen quietly showing another wallet's money, with every
 * number on it looking perfectly plausible.
 *
 * `filter` must be a stable value (a literal built during render is fine —
 * React Query hashes the key structurally, not by reference).
 */
export function useTransactions(filter: TxFilter = {}) {
  return useQuery({
    queryKey: queryKeys.transactions.list(filter),
    queryFn: () => listTransactions(filter),
  });
}
