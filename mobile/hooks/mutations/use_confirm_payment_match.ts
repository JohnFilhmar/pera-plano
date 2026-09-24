// hooks/mutations/use_confirm_payment_match.ts — m2b Task 8, rule 5.
//
// CANCELS THE LOAN'S QUEUED REMINDERS AFTER CONFIRMING (m3c Task 8 audit
// fix) — see `use_record_payment.ts`'s header for the full reasoning. A
// matched payment advances the due the same way a manually recorded one
// does, so it needs the same immediate cancellation of the now-stale
// per-loan reminder ids.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { cancelLoanReminders } from "@/lib/loans/loan_reminders";
import { recordPaymentAndCloseCards } from "@/lib/loans/loan_match_queue";
import type { LoanPayment } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type ConfirmPaymentMatchVariables = { loanId: string; transactionId: string };

/**
 * Records the match the user confirmed.
 *
 * INVALIDATES TRANSACTIONS TOO, not just loans. The match does not change the
 * transaction row, but it changes what the transaction MEANS: it is now
 * excluded from income cadence detection (loans rule 17), and any screen
 * showing income or a payment suggestion for it is holding a stale answer.
 *
 * ALSO INVALIDATES THE REVIEW QUEUE, because this write can now CLOSE a card.
 * Without it the queue badge and the queue screen keep showing an item the
 * database has already resolved, and the user taps a card that is gone.
 */
export function useConfirmPaymentMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      loanId,
      transactionId,
    }: ConfirmPaymentMatchVariables): Promise<LoanPayment> => {
      const payment = await recordPaymentAndCloseCards(loanId, transactionId);
      // Deliberately AFTER the match is recorded and deliberately not fatal:
      // a cancellation that fails must not undo a match the user confirmed.
      try {
        await cancelLoanReminders(loanId);
      } catch (error) {
        console.warn("loan reminders could not be cancelled", error);
      }
      return payment;
    },
    onSuccess: () =>
      invalidateKeys(queryClient, [
        queryKeys.loans.all,
        queryKeys.transactions.all,
        queryKeys.income.all,
        queryKeys.reviewQueue.all,
      ]),
  });
}
