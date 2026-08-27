// hooks/mutations/use_record_adjustment.ts — loans rule 13.
//
// The counterpart to `use_record_payment.ts`, and deliberately NOT the same
// hook with a flag. A payment moves money the app can see: it writes a ledger
// Transaction, moves a wallet balance and cancels the loan's queued reminders.
// An adjustment is the opposite case by definition — "reality the app cannot
// see" (rule 13): accrued interest on a free-form utang, a lender-side
// correction, a penalty, or a relative paying the collector directly. NO
// TRANSACTION IS CREATED, so no wallet moves and nothing in the ledger changes.
//
// WHICH IS WHY IT INVALIDATES ONLY THE LOANS FAMILY. `useRecordPayment` also
// names wallets and transactions because it genuinely writes to both; naming
// them here would make every adjustment refetch the ledger and every wallet
// balance on screen for a write that provably could not have touched either —
// exactly the keyless-invalidation jank `invalidate_keys.ts` exists to prevent.
//
// AND WHY IT DOES NOT CANCEL REMINDERS. `recordManualPayment` advances
// `nextDueDate`/`nextDueAmount` (rule 11), which is what makes every reminder
// already queued against the old due date wrong. `recordAdjustment` writes one
// `loan_adjustments` row and touches neither field, so the queued reminders
// still name the date and the amount the user set — cancelling them would
// silently switch off a loan's reminders as a side effect of recording a fee.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { recordAdjustment } from "@/lib/db/repos/loans_repo";
import type { LoanAdjustment } from "@/lib/db/repos/loans_repo";
import type { Centavos } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

export type RecordAdjustmentVariables = {
  loanId: string;
  /**
   * SIGNED, and the sign is the whole meaning: positive increases what is owed
   * (a penalty, accrued interest), negative reduces it (a payment made entirely
   * outside tracked money, a lender-side correction downwards).
   *
   * The UI never asks the user to type a minus — `balance_adjustment_sheet.tsx`
   * takes a plain amount plus an explicit "adds / reduces" choice and applies
   * the sign itself, because a mistyped sign here is a balance that silently
   * moves the wrong way by twice the amount.
   */
  amount: Centavos;
  occurredAt: number;
  /** Required by rule 13. Rejected as blank by the repository — see below. */
  note: string;
};

/**
 * Records a balance adjustment.
 *
 * THE BLANK-NOTE REFUSAL STAYS IN THE REPOSITORY. `recordAdjustment` throws
 * `AdjustmentNoteRequiredError` on an empty note and this hook deliberately
 * does not pre-empt it: the rule belongs where every caller meets it, not in
 * one of them. What the UI owes on top of that is a friendly message BEFORE the
 * call rather than a thrown error class reaching the user, which is why the
 * sheet checks the note itself and this hook stays a thin pass-through.
 */
export function useRecordAdjustment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RecordAdjustmentVariables): Promise<LoanAdjustment> =>
      recordAdjustment(input),
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.loans.all]),
  });
}
