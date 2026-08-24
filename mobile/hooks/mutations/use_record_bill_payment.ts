// hooks/mutations/use_record_bill_payment.ts — m2c Task 5.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { cancelCycleReminders } from "@/lib/bills/bill_reminders";
import { confirmBillPaymentMatch, rejectBillPaymentMatch } from "@/lib/bills/bills_service";
import type { BillPayment } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type RecordBillPaymentVariables = {
  billId: string;
  dueDate: string;
  transactionId: string;
};

/**
 * Confirms a match, then CANCELS THAT CYCLE'S REMAINING REMINDERS.
 *
 * Rule 11 says immediately, and this hook is where "immediately" can happen:
 * `bills_service.ts` cannot call `cancelCycleReminders` itself without
 * importing the notification stack it was deliberately split away from. Waiting
 * for the next reschedule is not good enough — that might be tomorrow morning
 * and the reminder might be tonight.
 *
 * INVALIDATES TRANSACTIONS TOO. The match does not change the transaction row,
 * but it changes what it MEANS: it now settles a bill cycle and is excluded
 * from every other match list, so any screen offering it elsewhere is holding a
 * stale answer.
 */
export function useRecordBillPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      billId,
      dueDate,
      transactionId,
    }: RecordBillPaymentVariables): Promise<BillPayment> => {
      const payment = await confirmBillPaymentMatch(billId, dueDate, transactionId);
      // Deliberately AFTER the payment is recorded and deliberately not fatal:
      // a cancellation that fails must not undo a payment the user confirmed.
      try {
        await cancelCycleReminders(billId, dueDate);
      } catch (error) {
        console.warn("bill reminders could not be cancelled", error);
      }
      return payment;
    },
    onSuccess: () =>
      invalidateKeys(queryClient, [queryKeys.bills.all, queryKeys.transactions.all]),
  });
}

/**
 * The spec's "No" branch — excludes the keyword and resets the ladder. Records
 * nothing, which is the point: the cycle stays unpaid.
 */
export function useRejectBillMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ billId, transactionId }: { billId: string; transactionId: string }) =>
      rejectBillPaymentMatch(billId, transactionId),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.bills.all]),
  });
}
