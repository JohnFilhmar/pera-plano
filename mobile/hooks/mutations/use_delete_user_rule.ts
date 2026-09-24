// hooks/mutations/use_delete_user_rule.ts — GAP-128, review-queue rule 16.
//
// CALLED DELETE, AND IT REALLY DELETES, which is the opposite of the plan
// entities. `use_archive_limit.ts`'s header explains why a Limit is archived
// rather than destroyed: it is a view over the ledger and retiring the view must
// not erase what it explained. A UserRule is not a view over anything. It is an
// instruction for future categorizations, it appears in no history, and nothing
// reads it to explain a past transaction — so there is nothing for an archived
// copy to preserve, and rule 16 asks for deletion by name.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { deleteUserRule } from "@/lib/db/repos/user_rules_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Removes a UserRule for good.
 *
 * TRANSACTIONS IT ALREADY CHANGED ARE LEFT EXACTLY AS THEY ARE — review-queue
 * rule 16, verbatim: "Deleting a rule stops future replays but never reverts
 * transactions it already changed." A category the user has since seen and
 * accepted is their ledger now, and silently rewriting a month of history
 * because a rule was tidied up would be a worse surprise than the miscategory
 * the deletion is fixing. Reverting is the Review Queue's job, per transaction,
 * where the user can see what changes.
 */
export function useDeleteUserRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string): Promise<void> => deleteUserRule(id),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.userRules.all]),
  });
}
