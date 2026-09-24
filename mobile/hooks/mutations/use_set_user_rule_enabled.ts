// hooks/mutations/use_set_user_rule_enabled.ts — GAP-128, review-queue rule 16.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { setUserRuleEnabled } from "@/lib/db/repos/user_rules_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Silences a UserRule, or lets it fire again.
 *
 * NOTHING ALREADY COMMITTED CHANGES, in either direction. `categorizer.ts`
 * reads `isEnabled` on the next categorization, so this affects what happens to
 * the next matching notification and never revisits a transaction the rule has
 * already touched. That is the same guarantee rule 16 states for deletion, and
 * it is why disabling is safe to offer with no confirmation: it is reversible
 * and it rewrites no history.
 */
export function useSetUserRuleEnabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }): Promise<void> =>
      setUserRuleEnabled(id, isEnabled),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.userRules.all]),
  });
}
