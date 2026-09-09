// lib/transactions/delete_transaction_service.ts — removing a committed row
// from the ledger, which docs/04-features/08-review-queue.md rule 9 has always
// promised and nothing could do (GAP-108).
//
// WHY THE PROMISE MATTERS. Rule 10 forbids the Review Queue from ever deleting
// a committed Transaction, and rule 9 is what makes that liveable: "committed
// results remain editable in the ledger indefinitely afterward". A mis-tapped
// Confirm on a scrolling queue is one gesture; without a delete on the ledger
// side it is also permanent, and every total, limit, report and Safe-to-Spend
// figure carries the wrong row for good.
//
// WHY IT IS A SERVICE AND NOT A WIDER `deleteTransaction`. The repository
// primitive stays exactly as it is — it removes one row and reverses its
// balance effect, and it THROWS when anything still references that row. That
// refusal is load-bearing for `mergeDuplicate`, which must never discard a
// transfer leg or a matched repayment while pretending it merged a duplicate.
// What this module adds is the layer above it: it asks what holds the row,
// releases the claims that a delete genuinely voids, refuses the one that the
// user has to break themselves, and never lets a foreign-key error out.
//
// THE FOUR REFERENCES, AND THE DECISION FOR EACH (all `NOT NULL` or nullable
// foreign keys onto `transactions(id)` with no ON DELETE action, under
// `PRAGMA foreign_keys = ON`):
//
//   `loan_payments.transaction_id` — RELEASED. The payment row is a claim that
//   THIS transaction paid down a loan. If the transaction never happened, the
//   claim is false, and `deletePayment` exists precisely to withdraw it. The
//   loan's outstanding balance is derived by summing the linked transactions
//   (`loans_repo.outstandingBalance`), so releasing the claim is the whole
//   reversal — there is no stored figure left disagreeing with it.
//
//   `bill_payments.transaction_id` — RELEASED, and `deleteBillPayment` reopens
//   the cycle with it. Same argument: a cycle marked paid by a transaction that
//   is gone is a bill the app believes was settled by nothing.
//
//   `transfer_links.out_transaction_id` / `.in_transaction_id` — REFUSED while
//   the pairing is ACTIVE, released once it is dissolved. Deleting a live leg
//   changes a SECOND ledger row's arithmetic: the counterpart would have to be
//   unpaired and would re-enter spend or income on its own. That is a decision
//   about a transaction the user is not looking at, so it is taken deliberately
//   with the "Not a transfer" action already on this screen, not folded into a
//   confirmation about a different row. Once unlinked, the dissolved link row
//   still holds the foreign key (`unlinkTransfer` dissolves, never deletes), so
//   the delete clears it — see `deleteDissolvedLink` for why that is the one
//   case where the evidence may go.
//
//   `wallets.drift_dismissed_transaction_id` — nothing to do here. The
//   repository primitive already NULLs it inside its own SQL transaction, and
//   its header says why: a dismissal is a note about what the user has read,
//   not a claim about money.
//
// AND THE FIFTH THING, WHICH IS NOT A FOREIGN KEY AT ALL. A Transaction built
// from a captured notification leaves that capture pointing at nothing the
// moment its row goes, and `startIngest`'s recovery sweep re-commits any
// capture nothing points at. Deleting a notification-sourced row without a
// marker therefore undoes itself at the next launch. `markCaptureAnswered` is
// the fix, and it must run AFTER the delete — see its own header.
//
// NOT A REPOSITORY: it holds no SQL, exactly like lib/review/resolve_actions.ts.
import { deleteBillPayment, getBill, getBillPaymentByTransaction } from "@/lib/db/repos/bills_repo";
import { deletePayment, getLoan, getPaymentByTransaction } from "@/lib/db/repos/loans_repo";
import {
  deleteTransaction,
  getTransaction,
  TransactionNotFoundError,
} from "@/lib/db/repos/transactions_repo";
import {
  deleteDissolvedLink,
  listLinksForTransaction,
} from "@/lib/db/repos/transfer_links_repo";
import { getWallet } from "@/lib/db/repos/wallets_repo";
import { withUnitOfWork } from "@/lib/db/unit_of_work";
import { formatDate } from "@/lib/datetime";
import { parseDateIso } from "@/lib/dates";
import { closeLoanMatchesFor } from "@/lib/loans/loan_match_queue";
import { markCaptureAnswered } from "@/lib/review/capture_marker";
import type { Transaction, TransferLink } from "@/types/domain";

/**
 * What a delete of one Transaction would do, in sentences the user reads.
 *
 * COPY, NOT A DISCRIMINATED UNION OF LINK KINDS. The screen's only job with
 * this is to put it in a confirmation, and a union would push the wording into
 * a component where it could not be tested against a real database — which is
 * the only place the wording can be checked to actually name the link that
 * exists. `null` for `refusal` means the delete may proceed.
 */
export type TransactionDeletionPlan = {
  /** Why the delete cannot happen, naming the link that blocks it. */
  readonly refusal: string | null;
  /** Everything else the delete takes with it, for the confirmation to name. */
  readonly alsoRemoves: readonly string[];
};

/**
 * Thrown when `deleteTransactionAndLinks` is asked to remove a row something
 * still holds.
 *
 * CARRIES THE SENTENCE, not a code the caller has to translate. This is the
 * error that would otherwise reach the user as "FOREIGN KEY constraint failed",
 * and the whole point of the type is that whatever renders it has a message
 * naming the link in hand without knowing anything about the schema.
 */
export class TransactionDeleteRefusedError extends Error {
  constructor(
    public readonly transactionId: string,
    public readonly refusal: string,
  ) {
    super(refusal);
    this.name = "TransactionDeleteRefusedError";
  }
}

/** The link the user has to break themselves, or `null`. */
function activeLinkFor(transaction: Transaction, links: readonly TransferLink[]): TransferLink | null {
  // BOTH CONDITIONS, and they are the same fact seen from two tables: linking
  // stamps the leg and writes an active row, unlinking clears the stamp and
  // dissolves the row. Reading only the stamp would miss an active row whose
  // legs were never stamped, and that state is not merely theoretical to a
  // delete — it is exactly the shape that would sail past the guard and then
  // fail on the foreign key with nothing to tell the user.
  return (
    links.find((link) => link.status === "active" || link.id === transaction.transferLinkId) ?? null
  );
}

async function refusalFor(
  transaction: Transaction,
  links: readonly TransferLink[],
): Promise<string | null> {
  const link = activeLinkFor(transaction, links);
  if (link === null) return null;

  const counterpartId =
    link.outTransactionId === transaction.id ? link.inTransactionId : link.outTransactionId;
  const counterpart = await getTransaction(counterpartId);
  const wallet = counterpart === null ? null : await getWallet(counterpart.walletId);

  // The wallet NAMES the link the way the user thinks about it — "a transfer
  // with GCash" — rather than by a link id they have never seen. A counterpart
  // that cannot be resolved still gets a sentence: it is the same refusal, just
  // without the name, and saying nothing would be the raw error all over again.
  return wallet === null
    ? 'This is one leg of a transfer. Tap "Not a transfer" above first, then delete it.'
    : `This is one leg of a transfer with ${wallet.name}. Tap "Not a transfer" above first, then delete it.`;
}

/**
 * Reads what holds this Transaction and turns it into the confirmation's copy.
 *
 * AN UNKNOWN ID IS AN EMPTY PLAN, NOT A THROW, unlike the repository primitive.
 * This is a READ that a screen keeps in a query cache, and the id it is keyed
 * on stops existing the moment the delete it describes succeeds — a throw there
 * would turn a successful delete into a retrying, failing query on the screen
 * that is already on its way out.
 */
export async function planTransactionDeletion(
  transactionId: string,
): Promise<TransactionDeletionPlan> {
  const transaction = await getTransaction(transactionId);
  if (transaction === null) return { refusal: null, alsoRemoves: [] };

  const refusal = await refusalFor(transaction, await listLinksForTransaction(transactionId));
  if (refusal !== null) return { refusal, alsoRemoves: [] };

  const alsoRemoves: string[] = [];

  const loanPayment = await getPaymentByTransaction(transactionId);
  if (loanPayment !== null) {
    const loan = await getLoan(loanPayment.loanId);
    alsoRemoves.push(
      loan === null
        ? "The loan payment it records is removed, and that loan's balance goes back up."
        : `The payment it records on your loan with ${loan.counterparty} is removed, and that loan's balance goes back up.`,
    );
  }

  const billPayment = await getBillPaymentByTransaction(transactionId);
  if (billPayment !== null) {
    const bill = await getBill(billPayment.billId);
    const due = formatDate(parseDateIso(billPayment.cycleDueDate).getTime());
    alsoRemoves.push(
      bill === null
        ? `The bill due ${due} goes back to unpaid.`
        : `${bill.name}'s bill due ${due} goes back to unpaid.`,
    );
  }

  // A DISSOLVED transfer link is deliberately not mentioned. The user already
  // broke that pairing and watched both legs re-enter their totals; the row
  // that survives it is bookkeeping they have never seen and cannot act on, so
  // naming it in a confirmation would only make the delete look riskier than it
  // is.
  return { refusal: null, alsoRemoves };
}

/**
 * Removes a Transaction, releasing what a delete genuinely voids and refusing
 * what it does not. Returns the row as it was, so a caller knows which wallet's
 * balance moved.
 *
 * ONE UNIT OF WORK over every write, because each half is destructive on its
 * own. A released loan payment beside a surviving transaction is a repayment
 * the user has to match again; a deleted transaction beside a surviving
 * `bill_payments` row cannot happen at all (the foreign key stops it), which is
 * exactly why the releases come first and why they must roll back with it.
 *
 * IT RE-CHECKS THE REFUSAL RATHER THAN TRUSTING A PLAN. `planTransactionDeletion`
 * runs when a screen renders and this runs when a button is pressed; a transfer
 * confirmed in between would otherwise be deleted through a stale plan. The
 * check is cheap and the failure it prevents is a silently unpaired counterpart.
 */
export async function deleteTransactionAndLinks(transactionId: string): Promise<Transaction> {
  return withUnitOfWork(async () => {
    const transaction = await getTransaction(transactionId);
    if (transaction === null) throw new TransactionNotFoundError(transactionId);

    const links = await listLinksForTransaction(transactionId);
    const refusal = await refusalFor(transaction, links);
    if (refusal !== null) throw new TransactionDeleteRefusedError(transactionId, refusal);

    const loanPayment = await getPaymentByTransaction(transactionId);
    if (loanPayment !== null) await deletePayment(loanPayment.id);

    const billPayment = await getBillPaymentByTransaction(transactionId);
    if (billPayment !== null) await deleteBillPayment(billPayment.id);

    for (const link of links) {
      await deleteDissolvedLink(link.id);
    }

    // The card asked "is this a payment on one of your loans?" about a row that
    // is about to stop existing. Left open it offers an accept that can only
    // fail — `recordPayment` would insert a `loan_payments` row pointing at
    // nothing — and the only working button would be "Not a loan payment",
    // which asks the user to record the opposite of what happened.
    //
    // THE CARD IS SIMPLY CLOSED, and there is no way to record that it was
    // closed for THIS reason rather than because the payment turned out to be
    // real. `review_queue_repo.resolve` writes only `resolved_at` — its
    // `resolution` argument is voided on the first line, by its own doc, for
    // the pinned contract's signature — so a card closed here and one the user
    // confirmed are indistinguishable on disk. `closeLoanMatchesFor` therefore
    // takes no resolution to pass; see its header for why adding one back
    // would be a claim the storage cannot keep.
    await closeLoanMatchesFor(transactionId);

    await deleteTransaction(transactionId);

    // AFTER the delete, never before: the predicate inside asks whether
    // anything still points at the capture, and the row being removed is the
    // thing that would answer yes. See `markCaptureAnswered`.
    await markCaptureAnswered(transaction.rawNotificationId, {
      amount: transaction.amount,
      direction: transaction.direction,
      merchant: transaction.merchant,
      walletId: transaction.walletId,
      deletedTransactionId: transaction.id,
    });

    return transaction;
  });
}
