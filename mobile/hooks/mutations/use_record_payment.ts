// hooks/mutations/use_record_payment.ts — m2b Task 8.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { systemClock } from "@/lib/clock";
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
    mutationFn: (input: RecordPaymentVariables): Promise<LoanPayment> =>
      recordManualPayment({
        loanId: input.loanId,
        amount: input.amount,
        walletId: input.walletId,
        occurredAt: input.occurredAt ?? systemClock.now(),
      }),
    onSuccess: () =>
      invalidateKeys(queryClient, [
        queryKeys.loans.all,
        queryKeys.wallets.all,
        queryKeys.transactions.all,
      ]),
  });
}
