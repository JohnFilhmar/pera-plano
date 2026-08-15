// hooks/queries/use_bill_candidates.ts — m2c Task 5.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { findBillPaymentCandidates } from "@/lib/bills/bills_service";
import { systemClock } from "@/lib/clock";

/**
 * Transactions that might have paid one cycle.
 *
 * Keyed on the CYCLE, not the bill: rule 25 has two cycles of one bill open at
 * once, and they have different windows and different answers.
 */
export function useBillCandidates(billId: string | undefined, dueDate: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.bills.detail(billId ?? ""), "candidates", dueDate ?? ""],
    queryFn: () => findBillPaymentCandidates(billId!, dueDate!, systemClock.now()),
    enabled: billId !== undefined && dueDate !== undefined,
  });
}
