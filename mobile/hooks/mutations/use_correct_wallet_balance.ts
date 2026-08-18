// hooks/mutations/use_correct_wallet_balance.ts — device-testing fix
// (2026-08-18, Task 4). A non-cash wallet has no way to say "I already have
// ₱3,000 in this" after creation — only cash gets `use_reconcile_cash.ts`,
// and that stays cash-only on purpose (see components/wallets/
// cash_reconcile_sheet.tsx's own header: a bank wallet re-anchors itself from
// the provider's reported balance-after, and a typed adjustment there would
// fight the next snap and lose).
//
// SAME SHAPE AS use_reconcile_cash.ts, NOT THE SAME HOOK. Reusing it verbatim
// would leave a GCash correction's ledger row reading "Cash reconciliation" —
// a note that would be false on a wallet that has never held cash. This hook
// writes the identical KIND of entry (one transaction, for the DIFFERENCE, no
// `balanceAfter`) under its own honest label instead, and reuses
// `cashAdjustment` — the arithmetic itself — rather than re-deriving it, so
// the two paths can never disagree about what the difference is.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { getWallet, WalletNotFoundError } from "@/lib/db/repos/wallets_repo";
import { cashAdjustment } from "@/lib/wallets/reconcile";
import type { Centavos, EpochMs, Transaction } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * Task 4 rule 3's required label — a starting balance or a manual
 * correction, never a claim that a provider confirmed it. Read in the ledger
 * exactly the way `RECONCILE_NOTE` is for cash.
 */
export const BALANCE_CORRECTION_NOTE = "Starting balance / manual correction";

export type CorrectWalletBalanceVariables = {
  walletId: string;
  /** What the user says the wallet actually holds right now, in centavos. */
  statedBalance: Centavos;
  /** Defaults to now. Present so a test can pin the clock. */
  occurredAt?: EpochMs;
};

/**
 * Corrects a wallet's recorded balance to the figure the user just typed, by
 * committing ONE adjustment transaction for the DIFFERENCE — never a patch on
 * `wallets.balance` itself (wallet_form.tsx:11-13: balance is the ledger's
 * running total, moved only by the transaction that explains the move).
 * Resolves to that transaction, or to `null` when the two figures already
 * agreed and nothing was written.
 *
 * NO `balanceAfter` IS SET, for the same reason cash reconciliation never
 * sets it: that field means "a provider reported this," and nothing reported
 * this — the user typed it. Setting it would make `getBalanceDrift` treat a
 * guess as a bank-confirmed anchor, which is exactly the confusion Task 4
 * rule 3 asks the caller to disclose rather than paper over: the NEXT
 * notification that DOES carry a reported balance still wins, because it
 * sets the anchor this write deliberately does not touch.
 *
 * IT READS THE RECORDED BALANCE ITSELF, for the identical reason
 * `useReconcileCash` does: a notification can commit between this sheet's
 * last render and the tap, and computing the delta against a stale figure
 * would silently write the wrong amount.
 *
 * NOT TYPE-CHECKED HERE. Rule 3 ("non-cash only, cash keeps its own sheet") is
 * a UI rule enforced by the caller (`BalanceCorrectionSheet` renders nothing
 * for `type: "cash"`) — the write itself has no opinion about wallet type,
 * the same division `useReconcileCash` draws.
 */
export function useCorrectWalletBalance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      walletId,
      statedBalance,
      occurredAt,
    }: CorrectWalletBalanceVariables): Promise<Transaction | null> => {
      const wallet = await getWallet(walletId);
      if (!wallet) throw new WalletNotFoundError(walletId);

      const adjustment = cashAdjustment(wallet.balance, statedBalance);
      if (adjustment === null) return null;

      return insertTransaction({
        walletId,
        categoryId: UNCATEGORIZED_ID,
        amount: adjustment.amount,
        direction: adjustment.direction,
        occurredAt: occurredAt ?? Date.now(),
        source: "manual",
        confidence: 1,
        note: BALANCE_CORRECTION_NOTE,
      });
    },
    onSuccess: (_transaction, { walletId }) =>
      invalidateKeys(queryClient, [
        queryKeys.transactions.all,
        queryKeys.wallets.detail(walletId),
        queryKeys.wallets.lists(),
        queryKeys.reviewQueue.count(),
      ]),
  });
}
