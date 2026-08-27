// hooks/mutations/use_review_action.ts — the Review Queue's triage writes,
// behind React Query (m1c plan Task 10; Task 3's hook conventions).
//
// ONE MUTATION, NOT SIX. Every triage action answers the same question — "what
// should happen to this card?" — and the screen presses exactly one of them per
// card. A hook per action would give the queue six independent `isPending`
// flags, and the one thing the screen has to be able to do is disable the pair
// of buttons on the card currently being written; six flags make that a join
// nobody maintains.
//
// THE INVALIDATION IS PER-KIND, not a blanket refresh (Task 3 rule 2). A
// dismissal writes nothing but a `resolved_at`, so refreshing the ledger and
// every wallet balance for it would refetch the whole app to render exactly the
// same rows — visible jank on a mid-range phone, in the middle of a rhythm the
// user is trying to keep.
//
// `retry` is inherited as 0 from the client (foundation Task 16) and must never
// be overridden here: these mutations commit money, and a retried write
// double-posts it.
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/constants/query_keys";
import { resolve } from "@/lib/db/repos/review_queue_repo";
import { confirmLoanMatch } from "@/lib/loans/loan_match_queue";
import {
  confirmAsTransfer,
  confirmItem,
  confirmOneSidedTransfer,
  correctItem,
  ignoreProvider,
  linkAsTransfer,
  mergeDuplicate,
  type CorrectionPatch,
} from "@/lib/review/resolve_actions";
import type { Centavos } from "@/types/domain";

import { invalidateKeys } from "./invalidate_keys";

/**
 * What the user just decided, in their words rather than the database's.
 *
 * `dismiss` covers "Not money", "Not a transfer" and the discard half of "Same
 * transaction": all three close a card without writing anything else, because
 * the record in question was never committed. It is the ONE triage outcome whose
 * whole job is that nothing happens to the ledger.
 */
export type ReviewAction =
  | { kind: "confirm"; itemId: string }
  /**
   * The user picked which loan a committed transaction pays
   * (docs/04-features/06-loans.md rules 8-9). CARRIES THE `loanId` rather than
   * deriving it, because the whole point of the card is that the app must not
   * choose: with two or more plausible loans the screen supplies no primary at
   * all, and this action can only originate from a button the user pressed on
   * one named loan.
   *
   * NOT `confirm`. That one commits a payload into the ledger; this one attaches
   * a row that is ALREADY in the ledger to a loan. Folding them together is how
   * one purchase ends up recorded twice.
   */
  | { kind: "confirm-loan-match"; itemId: string; loanId: string }
  | { kind: "correct"; itemId: string; patch: CorrectionPatch }
  | { kind: "dismiss"; itemId: string }
  | { kind: "confirm-transfer"; itemId: string }
  /**
   * The user named the wallet the other half of a transfer moved to or from.
   * CARRIES the wallet and the fee, because both come from controls on the
   * card — nothing here may be re-derived, or the app would be choosing where
   * the user's money went.
   */
  | {
      kind: "confirm-one-sided-transfer";
      itemId: string;
      counterpartWalletId: string;
      feeAmount: Centavos;
    }
  | { kind: "ignore-provider"; itemId: string; packageName: string }
  | { kind: "link-transfer"; itemId: string; outTransactionId: string; inTransactionId: string }
  | { kind: "merge"; itemId: string; keepTransactionId: string; dropTransactionId: string };

async function run(action: ReviewAction): Promise<void> {
  switch (action.kind) {
    case "confirm":
      await confirmItem(action.itemId);
      return;
    case "confirm-loan-match":
      // `confirmLoanMatch` wraps `recordPayment` and `resolve` in one unit of
      // work — the direction invariant (`PaymentDirectionMismatchError`) and
      // the one-transaction-one-loan invariant both live in that repository
      // call, and nothing here may reach past it.
      await confirmLoanMatch(action.itemId, action.loanId);
      return;
    case "correct":
      await correctItem(action.itemId, action.patch);
      return;
    case "dismiss":
      // Straight to the repository: there is no ledger consequence to make
      // atomic with it, and `resolve` is already idempotent on a double tap.
      await resolve(action.itemId, "dismissed");
      return;
    case "confirm-transfer":
      await confirmAsTransfer(action.itemId);
      return;
    case "confirm-one-sided-transfer":
      await confirmOneSidedTransfer(
        action.itemId,
        action.counterpartWalletId,
        action.feeAmount,
        Date.now(),
      );
      return;
    case "ignore-provider":
      await ignoreProvider(action.itemId, action.packageName);
      return;
    case "link-transfer":
      await linkAsTransfer(action.itemId, action.outTransactionId, action.inTransactionId);
      return;
    case "merge":
      await mergeDuplicate(action.itemId, action.keepTransactionId, action.dropTransactionId);
      return;
  }
}

/** The narrowest key set each outcome can actually change. */
function keysFor(action: ReviewAction) {
  const queue = [queryKeys.reviewQueue.all];
  switch (action.kind) {
    case "dismiss":
      return queue;
    case "confirm-loan-match":
      // The LOANS keys, not the ledger's. No Transaction was created, edited or
      // deleted — the row was already there and its columns are untouched — so
      // `transactions.all` and `wallets.all` would refetch every list and every
      // balance to render the identical numbers. What DID change is every loan
      // figure derived from `loan_payments`: the outstanding balance, the next
      // due, the payment history, and both candidate lists (`loans.candidates`
      // is nested under `loans.detail`, so the family root drops them too — a
      // confirmed candidate must stop being offered).
      return [...queue, queryKeys.loans.all];
    case "ignore-provider":
      return [...queue, queryKeys.userRules.all];
    case "merge":
    case "link-transfer":
      // Both move rows in and out of totals; neither creates a rule.
      return [...queue, queryKeys.transactions.all, queryKeys.wallets.all];
    default:
      return [
        ...queue,
        queryKeys.transactions.all,
        queryKeys.wallets.all,
        queryKeys.userRules.all,
      ];
  }
}

export function useReviewAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: ReviewAction) => run(action),
    onSuccess: (_result, action) => invalidateKeys(queryClient, keysFor(action)),
  });
}
