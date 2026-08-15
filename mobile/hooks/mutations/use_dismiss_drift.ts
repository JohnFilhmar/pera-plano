// hooks/mutations/use_dismiss_drift.ts — migration 003, wallets rule 3's second offer.
//
// Rule 3 lets the user "record the gap as an adjustment Transaction ..., or dismiss (accept
// the snap silently)". `use_reconcile_cash` is the first offer; this is the second, and it
// only became writable when 003 gave the schema somewhere to remember WHICH drift was seen.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { dismissBalanceDrift } from "@/lib/db/repos/wallets_repo";

import { invalidateKeys } from "./invalidate_keys";

export type DismissDriftVariables = {
  walletId: string;
  /**
   * The reporting transaction the user was actually looking at —
   * `BalanceDrift.reportingTransactionId` from the badge that is on screen.
   */
  transactionId: string;
};

/**
 * Marks the drift the user is looking at as seen, so the badge goes quiet for it — and only
 * for it. A newer reporting transaction has a different id, so its drift shows again with no
 * clearing step anywhere (see lib/db/migrations/003_drift_dismissal.sql).
 *
 * IT TAKES THE TRANSACTION ID FROM THE CALLER RATHER THAN RE-READING IT, which is the exact
 * opposite of what `use_reconcile_cash` does — deliberately, and for the same underlying
 * reason. Reconciliation must act on the CURRENT balance, because a stale one computes the
 * wrong adjustment. A dismissal must act on the drift the user SAW, because that is what they
 * accepted. If a notification commits between the render and the tap, re-reading here would
 * silence a disagreement the user was never shown; taking the rendered id instead stores the
 * older one, the newest reporting transaction no longer matches it, and the badge stays up.
 * Both rules are the same rule: never act on a figure the user did not look at.
 *
 * INVALIDATES THE WALLET'S OWN DETAIL KEY, not the drift key alone. The write lands on the
 * `wallets` row, so every cached copy of that row is stale — and `queryKeys.wallets.drift(id)`
 * nests UNDER `detail(id)` (see constants/query_keys.ts), so one invalidation reaches the
 * detail screen's badge and, through the same per-wallet key `useBalanceDrifts` shares, the
 * Wallets-tab row's badge as well.
 */
export function useDismissDrift() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ walletId, transactionId }: DismissDriftVariables): Promise<void> =>
      dismissBalanceDrift(walletId, transactionId),
    onSuccess: (_result, { walletId }) =>
      invalidateKeys(queryClient, [
        queryKeys.wallets.detail(walletId),
        queryKeys.wallets.lists(),
      ]),
  });
}
