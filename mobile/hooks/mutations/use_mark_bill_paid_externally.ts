// hooks/mutations/use_mark_bill_paid_externally.ts — GAP-085.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { cancelCycleReminders } from "@/lib/bills/bill_reminders";
import { resolveCycleExternally } from "@/lib/db/repos/bills_repo";

import { invalidateKeys } from "./invalidate_keys";

/**
 * The spec's mark-paid option "Paid outside my wallets": someone else paid, or
 * the money moved somewhere the app cannot see — a Bayad Center, cash to the
 * landlord, a relative's card.
 *
 * NOT A SKIP, THOUGH BOTH RESOLVE THE CYCLE WITH NO PAYMENT. A skip means "no
 * payment was expected" (a promo month, a waived month); this means the money
 * was owed and was paid. The two are the same arithmetic and a different fact,
 * and the fact is what the bill's history is for — `due_chip.tsx` says "Settled
 * elsewhere" for one and "Skipped" for the other.
 *
 * NO TRANSACTION IS WRITTEN, and none can be: migration 006's CHECK forbids a
 * `bill_payment_id` on any state but `paid`, and `bill_payments` has no amount
 * column of its own — every figure the estimator averages comes off a real
 * ledger transaction. Inventing one to represent cash would double-count
 * against every limit, every total and Safe-to-Spend's committed spend, so this
 * cycle leaves the bills term contributing nothing to the estimate. That is the
 * spec's own division: rule 6 averages MATCHED payments, and this cycle has
 * none.
 *
 * CANCELS THE CYCLE'S REMINDERS, and rule 11 is explicit about which cycles:
 * "a cycle that is marked paid (MATCHED OR MANUAL) cancels that cycle's
 * remaining reminders immediately". Immediately, because the next reschedule
 * might be tomorrow and the reminder might be tonight. The cancel is caught the
 * same way the skip's is — the cycle is already resolved in the database by
 * then, so a failed OS call must not surface as a failed mark-paid, and
 * `scheduleBillReminders` drops the stale ids on its next run anyway.
 *
 * ONLY `bills.all` IS INVALIDATED. Safe-to-Spend is reached through the cascade
 * `lib/query_client.ts` installed under GAP-058 — naming it here as well is the
 * duplication that change deliberately removed.
 */
export function useMarkBillPaidExternally() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ billId, dueDate }: { billId: string; dueDate: string }) => {
      const cycle = await resolveCycleExternally({ billId, dueDate });
      try {
        await cancelCycleReminders(billId, dueDate);
      } catch (error) {
        console.warn("bill reminders could not be cancelled", error);
      }
      return cycle;
    },
    onSuccess: () => invalidateKeys(queryClient, [queryKeys.bills.all]),
  });
}
