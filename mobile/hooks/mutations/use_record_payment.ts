// hooks/mutations/use_record_payment.ts — m2b Task 8.
//
// CANCELS THE LOAN'S QUEUED REMINDERS AFTER RECORDING (m3c Task 8 audit
// fix). `recordManualPayment` advances `nextDueDate`/`nextDueAmount` (loans
// rule 11), which makes every reminder id already queued for the OLD due
// date wrong — it would fire naming an amount that is now paid. Reminders
// are keyed per LOAN, not per cycle (unlike bills), so there is nothing to
// selectively keep: the whole set is stale and `cancelLoanReminders` drops
// all of it. The next app launch's bootstrap reschedule (app/_layout.tsx)
// re-derives fresh ones against the new due date — this hook only has to
// stop the stale ones from firing in the meantime, the same "immediately,
// don't wait for the next reschedule" reasoning `use_record_bill_payment.ts`
// already applies to bills.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
import { cancelLoanReminders } from "@/lib/loans/loan_reminders";
import { recordManualPayment } from "@/lib/loans/loans_service";
import type { Centavos, LoanPayment } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type RecordPaymentVariables = {
  loanId: string;
  amount: Centavos;
  walletId: string;
  /** Defaults to now — the spec's flow lets the user back-date a collector visit. */
  occurredAt?: number;
};

/**
 * The spec's "Record payment" flow: creates the Transaction AND links it, in
 * one unit of work.
 *
 * INVALIDATES WALLETS as well, because this writes a real ledger row and moves
 * a wallet balance — unlike `confirmPaymentMatch`, which links a transaction
 * that already existed and already moved it.
 */
export function useRecordPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordPaymentVariables): Promise<LoanPayment> => {
      const payment = await recordManualPayment({
        loanId: input.loanId,
        amount: input.amount,
        walletId: input.walletId,
        occurredAt: input.occurredAt ?? systemClock.now(),
      });
      // Deliberately AFTER the payment is recorded and deliberately not
      // fatal: a cancellation that fails must not undo a payment the user
      // just made.
      try {
        await cancelLoanReminders(input.loanId);
      } catch (error) {
        console.warn("loan reminders could not be cancelled", error);
      }
      return payment;
    },
    onSuccess: () =>
      invalidateKeys(queryClient, [
        queryKeys.loans.all,
        queryKeys.wallets.all,
        queryKeys.transactions.all,
      ]),
  });
}
