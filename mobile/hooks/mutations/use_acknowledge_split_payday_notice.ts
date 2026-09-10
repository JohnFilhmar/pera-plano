// hooks/mutations/use_acknowledge_split_payday_notice.ts — GAP-117.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { dismissSplitPaydayNotice } from "@/lib/income/income_service";

import { invalidateKeys } from "./invalidate_keys";

/**
 * The user has read the one-time "your income figure changed" notice.
 *
 * Only the income family is invalidated: nothing about the applied income, the
 * profile or any limit changes here, exactly as `useDismissIncome` does not
 * touch the limits family for the same reason. The figures moved on the
 * detection pass that raised this notice, not on the tap that clears it.
 */
export function useAcknowledgeSplitPaydayNotice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (): Promise<void> => dismissSplitPaydayNotice(),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.income.all]),
  });
}
