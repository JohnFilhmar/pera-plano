// hooks/queries/use_report.ts — M3b Task 3.
//
// THE CLOCK IS READ HERE, the composition edge — lib/reports/reports_service.ts
// takes `today` as a plain parameter and never touches Date.now() itself, the
// same split hooks/queries/use_safe_to_spend.ts draws over
// lib/safe_to_spend_service.ts.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { toDateIso } from "@/lib/dates";
import { availableScopes, getReport, type ReportScope } from "@/lib/reports/reports_service";

/**
 * Every scope the current tier may pick from — feeds RangePicker's month
 * list and its `customAllowed` gate. A sibling query to `useReport`, not a
 * dependency of it: the month list depends only on tier and today, never on
 * which scope happens to be open right now.
 */
export function useAvailableScopes() {
  return useQuery({
    queryKey: queryKeys.reports.scopes(),
    queryFn: () => availableScopes(toDateIso(new Date(systemClock.now()))),
  });
}

/**
 * The assembled report for `scope`. Keyed on the scope object itself, the
 * same way `transactions.list(filters)` keys on its filter object — React
 * Query hashes by structural equality, so picking the SAME month twice is a
 * cache hit and a different month or a custom range is a genuine miss.
 */
export function useReport(scope: ReportScope) {
  return useQuery({
    queryKey: queryKeys.reports.report(scope),
    queryFn: () => getReport(scope, toDateIso(new Date(systemClock.now()))),
  });
}
