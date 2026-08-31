// hooks/mutations/use_reconcile_cash.ts — m1c plan Task 5 rule 5.
//
// STRUCK FROM TASK 3 AND DEFERRED HERE, on purpose: Task 3 had no definition of
// what reconciliation writes, and a hook that commits money is not something to
// guess at ahead of the rule. `lib/wallets/reconcile.ts` is that rule; this is
// the write.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { getWallet, WalletNotFoundError } from "@/lib/db/repos/wallets_repo";
import {
  cashAdjustment,
  RECONCILE_CATEGORY_ID,
  RECONCILE_NOTE,
} from "@/lib/wallets/reconcile";
import type { Centavos, EpochMs, Transaction } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type ReconcileCashVariables = {
  walletId: string;
  /** What the user says is actually in their pocket, in centavos. */
  physicalBalance: Centavos;
  /** Defaults to now. Present so a test can pin the clock. */
  occurredAt?: EpochMs;
};

/**
 * Reconciles a wallet's recorded balance to the figure the user just typed, by
 * committing ONE adjustment transaction for the DIFFERENCE. Resolves to that
 * transaction, or to `null` when the two already agreed and nothing was written.
 *
 * IT READS THE RECORDED BALANCE ITSELF rather than taking it as a variable, and
 * that is the one place this hook is thicker than the rest of the directory.
 * The sheet rendered a figure at some point in the past; between that render and
 * the tap, an incoming notification can commit against the same wallet. Taking
 * the rendered number would compute the delta against a balance that no longer
 * exists and silently write the wrong amount — the failure mode with no symptom.
 * The read costs one query and removes the whole class.
 *
 * IT NEVER EDITS PAST TRANSACTIONS. There is no `updateTransaction` here and
 * there must not be: the ledger is a history, and rewriting yesterday's rows to
 * make today's figure come out right is how a money app stops being something a
 * user can check. The wallet still lands exactly on the typed figure, because
 * `insertTransaction` moves the balance by the adjustment's signed effect —
 * which IS the difference — and that is spec rule 4's "resets the computed
 * balance anchor to the entered amount".
 *
 * NO `balanceAfter` IS SET. That field is the PROVIDER's own reported figure,
 * and cash has no provider. Setting it would also populate `computedBalance`,
 * which would make `getBalanceDrift` start returning `{ drift: 0 }` for a cash
 * wallet — a badge claiming the bank and the ledger agree about a wallet no bank
 * has ever reported on. That function returns `null` for cash today, and the two
 * states must stay distinguishable.
 *
 * The type is NOT checked here. Rule 6 ("only cash wallets offer it") is a UI
 * rule and both the detail screen and the sheet enforce it; the write itself is
 * the same write the drift explainer's "record the gap as an adjustment" will
 * need for notification wallets when that lands.
 */
export function useReconcileCash() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      walletId,
      physicalBalance,
      occurredAt,
    }: ReconcileCashVariables): Promise<Transaction | null> => {
      const wallet = await getWallet(walletId);
      if (!wallet) throw new WalletNotFoundError(walletId);

      const adjustment = cashAdjustment(wallet.balance, physicalBalance);
      if (adjustment === null) return null;

      return insertTransaction({
        walletId,
        categoryId: RECONCILE_CATEGORY_ID,
        amount: adjustment.amount,
        direction: adjustment.direction,
        occurredAt: occurredAt ?? Date.now(),
        source: "manual",
        confidence: 1,
        note: RECONCILE_NOTE,
        // 017_transaction_adjustments — the same marker
        // `useCorrectWalletBalance` sets, and it belongs here for the same
        // reason: counting the physical cash in a wallet and finding ₱200 less
        // than the ledger expected is a correction, not ₱200 of shopping. The
        // owner's report named the non-cash sheet, but this hook writes the
        // identical kind of row and had the identical defect.
        isAdjustment: true,
      });
    },
    // The same key set `use_create_transaction` uses, and for the same reasons —
    // this IS a committed transaction. Invalidated even when nothing was
    // written: "we checked and it already agreed" is worth confirming against
    // fresh figures, and it costs one refetch of data the user is looking at.
    onSuccess: (_transaction, { walletId }) =>
      invalidateKeys(queryClient, [
        queryKeys.transactions.all,
        queryKeys.wallets.detail(walletId),
        queryKeys.wallets.lists(),
        queryKeys.reviewQueue.count(),
      ]),
  });
}
