// hooks/queries/use_support_reports.ts — the outbox as the report screen sees
// it.
//
// THE ONLY QUERY IN THIS APP WITH A PUSH SOURCE. Every other family here is
// refreshed by a mutation the user just made; this one changes on its own,
// because `lib/support/outbox_runner.ts` sends in the background on a timer.
// The effect below turns `support:outbox_changed` into an invalidation, which
// is what makes a report visibly move from "Waiting to send" to "Sent" while
// the user is looking at it rather than only after they leave and come back.
//
// AN EFFECT, NOT A `refetchInterval`. Polling would re-read SQLite every few
// seconds for a list that is empty on almost every device on almost every day.
// The event fires only when a row actually moved.
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { onAppEvent } from "@/lib/events/app_events";
import { listUnsentSupportReports } from "@/lib/support/support_reports_repo";

/**
 * Problem reports still waiting to send, plus any the server refused — newest
 * first. Delivered reports are deliberately absent: see
 * `queryKeys.supportReports.unsent`.
 */
export function useUnsentSupportReports() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return onAppEvent("support:outbox_changed", () => {
      // Fire-and-forget: `onAppEvent` awaits its handlers (lib/events/
      // app_events.ts), and making a background flush wait on a refetch would
      // put React Query's network/cache work inside the emit that the runner
      // is holding open.
      void queryClient.invalidateQueries({ queryKey: queryKeys.supportReports.all });
    });
  }, [queryClient]);

  return useQuery({
    queryKey: queryKeys.supportReports.unsent(),
    queryFn: () => listUnsentSupportReports(),
  });
}
