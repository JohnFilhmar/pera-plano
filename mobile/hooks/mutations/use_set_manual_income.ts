// hooks/mutations/use_set_manual_income.ts — m2-part2 Task 13.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { setManualIncome } from "@/lib/income/income_service";
import type { IncomeSummary } from "@/lib/income/income_service";
import type { Centavos, IncomeCadence } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type SetManualIncomeVariables = {
  cadence: IncomeCadence;
  averageAmount: Centavos;
  sourceWalletIds: string[];
};

/**
 * The user typed their income. Income rule 14: this sets `isManualOverride`,
 * and from then on "detection keeps running silently but changes nothing".
 *
 * INVALIDATES LIMITS TOO, not just income. `setManualIncome` re-snapshots every
 * percent-of-income limit's base (limits rule 11's immediate-recompute
 * exception), so a Plan tab left mounted behind this screen would otherwise go
 * on drawing progress bars against the base it had before the user declared
 * their pay.
 */
export function useSetManualIncome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SetManualIncomeVariables): Promise<IncomeSummary> =>
      setManualIncome(input, systemClock.now()),
    onSuccess: () =>
      invalidateKeys(queryClient, [queryKeys.income.all, queryKeys.limits.all]),
  });
}
