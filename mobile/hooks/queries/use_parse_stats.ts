// hooks/queries/use_parse_stats.ts — m3b Task 7.
//
// THE CLOCK IS READ HERE, the composition edge — `lib/diagnostics/
// parse_stats_repo.ts`'s `getParseStats` takes `sinceMs` as a plain parameter
// and never touches the clock itself, the same split
// `hooks/queries/use_report.ts` draws over `lib/reports/reports_service.ts`.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { getParseStats } from "@/lib/diagnostics/parse_stats_repo";

/** Flow G's own window (docs/04-features/11-settings-privacy.md: "over a rolling 30-day window"). */
export const PARSE_STATS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Per-provider parsed/failed counts over the last 30 days. */
export function useParseStats() {
  return useQuery({
    queryKey: queryKeys.parseStats.stats(),
    queryFn: () => getParseStats(systemClock.now() - PARSE_STATS_WINDOW_MS),
  });
}
