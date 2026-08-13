// hooks/queries/use_transaction.ts — m1c plan Task 3.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { getTransaction } from "@/lib/db/repos/transactions_repo";

/** One transaction by id, or `null` — the transaction detail route's read. */
export function useTransaction(id: string) {
  return useQuery({
    queryKey: queryKeys.transactions.detail(id),
    queryFn: () => getTransaction(id),
  });
}
