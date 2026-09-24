// hooks/queries/use_user_rules.ts — GAP-128, review-queue rule 16.
//
// The read side of the rules list, and the first reader of `listUserRules`
// outside the ingest pipeline. Until this existed, every caller of that
// function was pipeline-side (`lib/ingest/pipeline.ts`, `loans_service.ts`,
// `loan_match_queue.ts`, `recurring_service.ts`), which is why a rule the user
// created could never be seen again: rule 16 promised a list and nothing read
// the data behind it.
//
// The query key already existed. `constants/query_keys.ts`'s `userRules` block
// was written with this screen in mind, so every correction that creates a rule
// already invalidates the key this hook subscribes to.
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { listUserRules } from "@/lib/db/repos/user_rules_repo";

/**
 * Every UserRule on the device, newest-intent first, INCLUDING the disabled
 * ones.
 *
 * Disabled rules must be in this list or they could never be turned back on,
 * which `listUserRules`'s own doc says in as many words. The ordering is the
 * repo's evaluation order (priority, then recency, then id), so the rule a
 * reader sees first is the one that would win a conflict.
 */
export function useUserRules() {
  return useQuery({
    queryKey: queryKeys.userRules.list(),
    queryFn: () => listUserRules(),
  });
}
