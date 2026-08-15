// hooks/queries/use_bills.ts — m2c Task 5.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listBillStatuses } from "@/lib/bills/bills_service";
import { systemClock } from "@/lib/clock";

/**
 * How far ahead the list looks. Rule 1's header totals the next 30 days, and
 * the list itself shows a little further so the next cycle of a monthly bill is
 * always visible rather than appearing the day the current one is paid.
 */
export const BILL_HORIZON_DAYS = 45;

/**
 * Every bill cycle worth showing, with its state and current estimate.
 *
 * The clock is read HERE — the composition edge — because `listBillStatuses` is
 * clock-injected all the way down, so a cycle due today and one a day overdue
 * are both ordinary fixtures.
 */
export function useBills() {
  return useQuery({
    queryKey: queryKeys.bills.list(),
    queryFn: () => listBillStatuses(systemClock.now(), BILL_HORIZON_DAYS),
  });
}
