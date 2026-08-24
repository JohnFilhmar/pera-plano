// hooks/mutations/use_update_limit.ts — m2 Task 8.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { updateLimit } from "@/lib/db/repos/limits_repo";
import { getMonthlyEquivalentIncome } from "@/lib/income/income_service";
import { refreshLimitBase } from "@/lib/limits/limit_service";
import type { NewLimit } from "@/types/control";
import type { Limit } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type UpdateLimitVariables = { id: string; patch: Partial<NewLimit> };

/**
 * Edits a Limit and RE-SNAPSHOTS ITS BASE IN THE SAME MUTATION.
 *
 * Limits rule 11: the peso base is fixed for the period, "with one exception: a
 * manual edit to the IncomeProfile or to the Limit recomputes the base
 * immediately". Without the second call an edited limit keeps measuring against
 * the figure it was created with until the next period boundary — the user
 * raises their cap, the progress bar does not move, and nothing says why.
 *
 * The two writes are NOT wrapped in a transaction. `refreshLimitBase` reads the
 * limit back before writing, so a failure between them leaves the row edited
 * and the base stale — recoverable by the next edit or period roll, and far
 * less damaging than a rolled-back edit the user believes they made.
 *
 * `fired` survives the refresh (see `refreshLimitBase`): rule 20 says raising a
 * limit updates the display but must never re-arm a threshold already alerted.
 */
export function useUpdateLimit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, patch }: UpdateLimitVariables): Promise<Limit> => {
      const limit = await updateLimit(id, patch);
      const now = systemClock.now();
      await refreshLimitBase(id, now, await getMonthlyEquivalentIncome(now));
      return limit;
    },
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.limits.all]),
  });
}
