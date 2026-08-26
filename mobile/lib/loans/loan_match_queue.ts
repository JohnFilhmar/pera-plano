// lib/loans/loan_match_queue.ts — the post-commit half of loan matching
// (docs/04-features/06-loans.md §"Flow: automatic payment matching from the
// ledger", rules 8-10 and 17).
//
// WHAT WAS MISSING, AND WHY IT MATTERED. Step 1 of that flow reads "After a
// Transaction commits to the ledger, the matcher scores it against open
// loans", and step 3 says every plausible result "becomes a suggestion — never
// a silent commit. The user confirms or rejects from the loan detail OR THE
// REVIEW QUEUE." Only the loan-detail half existed: `findPaymentCandidates`
// runs when a screen asks it to, so a repayment that arrived while the user was
// anywhere else in the app was never mentioned to anybody. A borrower's GCash
// transfer would sit in the ledger as an ordinary inflow — counted as income
// (rule 17 exists precisely to stop that), with the loan still reading as
// unpaid — until the user happened to walk into Plan -> Loans and look.
//
// NOTHING HERE AUTO-MATCHES. Spec rule 9 permits exactly one thing to:
// "explicit provider loan events ... that map unambiguously to a single loan",
// and provider loan events are not modelled anywhere in this codebase yet. So
// this module raises SUGGESTIONS and only suggestions, at every score, for
// every loan count. The cost of being wrong is two numbers corrupted at once —
// the loan balance, and the user's income, because a matched transaction drops
// out of income cadence detection (rule 17) — and neither corruption announces
// itself.
//
// ONE ITEM, HOWEVER MANY LOANS. Rule 9's second sentence: "If two or more open
// loans are plausible for one Transaction, it is always a suggestion listing
// the candidates — never an auto-match." One transaction is one question, so it
// gets one card carrying every candidate, rather than N cards racing each other
// to claim the same row (only the first could ever be accepted — invariant I12
// makes one transaction pay at most one loan — and the rest would be dead cards
// the user taps and nothing happens).
//
// A MATCHER FAILURE MAY NEVER COST A COMMIT. The money moved whatever this
// module thinks; the ledger row is the record of that and it is already
// written by the time anything here runs. `raiseLoanMatchAfterCommit` is the
// wrapper both call sites use for exactly that reason — see its own note.
import { listOpen, enqueue, resolve } from "@/lib/db/repos/review_queue_repo";
import { withUnitOfWork } from "@/lib/db/unit_of_work";
import { findLoanMatchesForTransaction } from "@/lib/loans/loans_service";
import { recordPayment } from "@/lib/db/repos/loans_repo";
import type { LoanMatchCandidate } from "@/lib/loans/loans_service";
import type { LoanPayment, ReviewItemPayload, ReviewQueueItem, Transaction } from "@/types/domain";

/** The `ReviewKind` migration 011 added, named once so no call site spells it. */
export const LOAN_MATCH_KIND = "loan-match" as const;

/**
 * The sentence the card leads with (review_card.tsx rule 3: no card is ever
 * unexplained). Written HERE rather than in the component because
 * `review_card.tsx`'s own header pins the rule that the sentence belongs to
 * whatever produced the item — `GATE_REASONS` for the four ingest kinds, this
 * for the one loans raises — and a second copy in the component is the drift
 * that file spends three paragraphs warning about.
 *
 * SINGULAR AND PLURAL ARE GENUINELY DIFFERENT QUESTIONS. With one candidate the
 * user is being asked to confirm; with several they are being asked to CHOOSE,
 * and a card that says "this looks like a payment on your loan" while showing
 * three loans is asking a question it has not stated.
 */
export function loanMatchReason(candidateCount: number): string {
  return candidateCount === 1
    ? "This looks like a payment on one of your loans. Record it?"
    : "This could be a payment on more than one of your loans. Which one?";
}

/**
 * What a `loan-match` item carries, and the ONLY shape anything should read out
 * of `payload`.
 *
 * `review_queue_items.payload_json` is stored verbatim and never interpreted by
 * the repository (its own header), so every consumer reads it defensively —
 * this type documents the contract, it does not enforce it at runtime. An item
 * enqueued by an older build must render a partial card, never crash the queue
 * and take every other item down with it.
 */
export type LoanMatchPayload = {
  /** The COMMITTED row this card is about. Already in the ledger — see the file header. */
  transactionId: string;
  amount: number;
  direction: "in" | "out";
  occurredAt: number;
  merchant: string | null;
  counterparty: string | null;
  walletId: string;
  candidates: LoanMatchCandidate[];
  reason: string;
};

/** True when `payload` is one this module wrote and can still be acted on. */
export function readLoanMatchPayload(item: ReviewQueueItem): LoanMatchPayload | null {
  if (item.kind !== LOAN_MATCH_KIND) return null;
  const payload = item.payload as Partial<LoanMatchPayload>;
  if (typeof payload.transactionId !== "string" || payload.transactionId === "") return null;
  if (!Array.isArray(payload.candidates) || payload.candidates.length === 0) return null;
  return payload as LoanMatchPayload;
}

/**
 * True when this transaction already has an OPEN loan-match card.
 *
 * Guards the one thing that would make this feature worse than not having it: a
 * queue with the same suggestion in it twice. Both call sites fire once per
 * commit today, but `processStored` reprocesses a durable capture after a crash
 * (pipeline.ts rule 10) and a user can retry a failed manual entry, and a
 * duplicate card is not a cosmetic problem — the user confirms the first, the
 * second becomes unacceptable (invariant I12) and sits there until it expires.
 *
 * OPEN ITEMS ONLY, deliberately. A card the user already dismissed must not
 * suppress a later one: rule 10 says rejecting "never creates a negative
 * UserRule automatically", and treating a dismissal as a permanent silence for
 * that transaction would be exactly that rule with the storage moved.
 */
async function hasOpenItemFor(transactionId: string): Promise<boolean> {
  const open = await listOpen();
  return open.some((item) => readLoanMatchPayload(item)?.transactionId === transactionId);
}

/**
 * Scores a freshly committed transaction against every open loan and raises ONE
 * suggestion when at least one is plausible. Returns the item's id, or `null`
 * when nothing was plausible and no card was made.
 *
 * THROWS ON A DATABASE FAULT, deliberately — this is the testable core.
 * Production call sites go through `raiseLoanMatchAfterCommit` below, which is
 * the one that swallows. Making the core silent too would leave no way to
 * assert it works.
 */
export async function raiseLoanMatchSuggestion(
  transaction: Transaction,
): Promise<string | null> {
  const candidates = await findLoanMatchesForTransaction(transaction);
  if (candidates.length === 0) return null;
  if (await hasOpenItemFor(transaction.id)) return null;

  const payload: LoanMatchPayload = {
    transactionId: transaction.id,
    amount: transaction.amount,
    direction: transaction.direction,
    occurredAt: transaction.occurredAt,
    merchant: transaction.merchant ?? null,
    counterparty: transaction.counterparty ?? null,
    walletId: transaction.walletId,
    candidates,
    reason: loanMatchReason(candidates.length),
  };

  const item = await enqueue({
    kind: LOAN_MATCH_KIND,
    // NO `rawNotificationId`, even when the transaction has one. That column is
    // a foreign key to the CAPTURE a card was built from, and the four ingest
    // kinds use it to show the user the notification text they are being asked
    // to judge. This card is not about a notification — it is about a committed
    // row — and the raw capture expires on its own 30-day TTL (Privacy Centre),
    // which would leave the reference dangling for a question that never needed
    // it.
    payload: payload as unknown as ReviewItemPayload,
  });
  return item.id;
}

/**
 * The same thing, for a caller that has just written to the ledger.
 *
 * SWALLOWS EVERYTHING, AND THAT IS THE POINT. By the time this runs the
 * Transaction is committed and durable — the money moved, and the row saying so
 * is the record of it. A matcher fault (SQLite busy, a corrupt payload, a bug
 * in the scorer) must not propagate into the commit path, because both callers
 * sit where a throw would be read as the COMMIT failing: `pipeline.ts`'s
 * `processStored` and `runGuarded` both catch silently, so an escaping error
 * there would look exactly like the capture failing to process, and
 * `useCreateTransaction`'s mutation would report a failed save for a
 * transaction that is already in the ledger — the user's next move being to
 * enter it again.
 *
 * Logged, not silent. `transform-remove-console` strips this from production
 * bundles, so it serves development and dev-client builds — the same trade
 * `pipeline.ts` makes for its parse-stats guard, and for the same reason: a
 * missing suggestion is survivable and undiagnosable is not.
 */
export async function raiseLoanMatchAfterCommit(transaction: Transaction): Promise<void> {
  try {
    await raiseLoanMatchSuggestion(transaction);
  } catch (error) {
    console.warn("[loans] a committed transaction could not be scored against open loans", error);
  }
}

/**
 * The user picked a loan on the card: record the payment and close the item.
 *
 * ATOMIC, OR NOTHING — the same rule every other triage write keeps
 * (`resolve_actions.ts` rule 2). A recorded payment beside an unresolved card
 * means the card comes back, the user confirms it again, and the second attempt
 * throws `PaymentAlreadyMatchedError` at them for doing what the app asked.
 *
 * `recordPayment` IS NOT BYPASSED, AND MUST NEVER BE. It is the only write path
 * into `loan_payments` and it is where the direction invariant is enforced —
 * `PaymentDirectionMismatchError` when an `in` transaction is offered to an
 * `i-owe` loan, or vice versa. `findLoanMatchesForTransaction` filters on the
 * same rule, so a mismatch reaching here means the payload was hand-built or
 * the loan's direction was edited after the card was raised; either way the
 * throw is correct and the item stays open.
 *
 * Returns `null` when the item is missing, already resolved, or names a loan
 * that is not among its own candidates — a double-tap and a stale card are both
 * no-ops by construction rather than by a flag someone has to remember.
 */
export async function confirmLoanMatch(
  itemId: string,
  loanId: string,
): Promise<LoanPayment | null> {
  const item = (await listOpen()).find((open) => open.id === itemId);
  if (item === undefined) return null;

  const payload = readLoanMatchPayload(item);
  if (payload === null) return null;
  // THE CARD'S OWN LIST IS THE AUTHORITY on which loans this transaction may
  // pay. Accepting any `loanId` the caller names would make this function a
  // general "attach transaction to loan" write reachable from the queue, with
  // none of the scoring that produced the card in the first place.
  if (!payload.candidates.some((candidate) => candidate.loanId === loanId)) return null;

  return withUnitOfWork(async () => {
    const payment = await recordPayment({ loanId, transactionId: payload.transactionId });
    await resolve(itemId, "confirmed");
    return payment;
  });
}

/**
 * The user said this is not a loan payment.
 *
 * RESOLVES THE ITEM AND WRITES NOTHING ELSE — spec rule 10: "Rejecting a
 * suggestion never creates a negative UserRule automatically." The follow-up
 * that rule describes ("repeated rejections for the same merchant surface a
 * one-time 'stop suggesting this merchant for this loan?' prompt") needs a
 * count of rejections per merchant-loan pair that nothing stores yet; it is a
 * separate feature, and guessing at it here by writing an `ignore` rule would
 * silence a real repayment the user only meant to skip once.
 *
 * A thin pass-through to `resolve` today, and named anyway: the call site is a
 * loan decision, and a bare `resolve(id, "dismissed")` in the triage switch
 * would give a future rejection counter nowhere to live.
 */
export async function dismissLoanMatch(itemId: string): Promise<void> {
  await resolve(itemId, "dismissed");
}
