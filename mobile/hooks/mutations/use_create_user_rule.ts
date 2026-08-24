// hooks/mutations/use_create_user_rule.ts — m1c plan Task 3's shape, Task 7's
// caller.
//
// The write behind "Always categorize <merchant> as <category>". It is a
// SEPARATE mutation from the category edit itself, and that separation is the
// feature: the checkbox decides whether this one fires at all, and a user who
// unchecks it has said something specific about every future row from that
// merchant.
//
// THE PLAN'S `UserRule` SHAPE IS STALE. m1c Task 7 rule 6 says "a `UserRule` of
// kind `merchant_category`"; no such kind exists anywhere in this codebase. The
// shipped model (types/domain.ts, established by m1b Task 8) is a matcher/action
// pair — `{ merchantPattern }` plus `{ kind: "set-category", categoryId }` — and
// `merchantPattern` is matched as a case-insensitive SUBSTRING by
// lib/ingest/categorizer.ts, never as a regex.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { createUserRule, type NewUserRule } from "@/lib/db/repos/user_rules_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Records a correction so the pipeline stops making it again.
 *
 * Invalidates `userRules.all` and NOTHING ELSE — deliberately not the
 * transactions family. A rule is replayed by the Categorizer against FUTURE
 * captures (spec §8); it does not retroactively rewrite committed rows, so no
 * ledger figure on screen changes when one is created. Invalidating the ledger
 * here would refetch every visible list to render exactly the same rows, and
 * would quietly imply a retroactive edit the app does not perform.
 */
export function useCreateUserRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewUserRule) => createUserRule(input),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.userRules.all]),
  });
}
