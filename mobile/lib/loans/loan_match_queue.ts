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
import { createUserRule, listUserRules } from "@/lib/db/repos/user_rules_repo";
import { withUnitOfWork } from "@/lib/db/unit_of_work";
import { findLoanMatchesForTransaction } from "@/lib/loans/loans_service";
import { getPaymentByTransaction, recordPayment } from "@/lib/db/repos/loans_repo";
import { getTransaction } from "@/lib/db/repos/transactions_repo";
import { foldMerchant } from "@/lib/ingest/rule_matcher";
import type { LoanMatchCandidate } from "@/lib/loans/loans_service";
import type {
  LoanPayment,
  ReviewItemPayload,
  ReviewQueueItem,
  Transaction,
  TxDirection,
} from "@/types/domain";

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
 * The name a future notification on this trail will carry, or `null` when the
 * transaction carried none.
 *
 * MERCHANT FIRST, COUNTERPARTY SECOND, because a row usually has only one of
 * them: a provider's SEND template writes the recipient into `merchant`, its
 * RECEIVE template writes the sender into `counterparty` and leaves `merchant`
 * null (assets/parser_rules/seed.json). Reading `merchant` alone would teach a
 * rule for every i-owe payment and none at all for the owed-to-me repayments
 * that are half the feature — the same one-sided bug `loans_service.ts`'s
 * `nameStrength` carries a paragraph about.
 *
 * NOT THE LOAN'S OWN `counterparty`. The user typed that ("Kuya Ben"); the
 * trail is what the PROVIDER writes ("BEN SANTOS"), and only the second one
 * will be in next month's notification. docs/04-features/06-loans.md flow step
 * 4's own example says so: "transfers to JUAN D → payment on loan Juan-utang".
 */
function trailPattern(merchant: string | null, counterparty: string | null): string | null {
  for (const field of [merchant, counterparty]) {
    const trimmed = field?.trim() ?? "";
    if (trimmed !== "") return trimmed;
  }
  return null;
}

/**
 * Teaches rule 8's signal (b): "a confirmed match creates a UserRule ... so the
 * next payment from the same trail matches with higher confidence" (flow step
 * 4).
 *
 * A SCORE, NEVER A SILENT COMMIT. `loans_service.scoreCandidate` reads this
 * back as `SIGNAL_WEIGHT.rule` and nothing else does. Rule 9 leaves auto-match
 * to explicit provider loan events alone, and the card this rule improves is
 * still a card — see that file's weight comment for why a taught rule may not
 * become one.
 *
 * WRITES NOTHING WHEN THE TRAIL IS NAMELESS. `matcherFitsTransaction` treats a
 * blank `merchantPattern` as fail-closed, exactly as `rule_matcher.ts` does, so
 * a rule built from a nameless row could never fire — it would sit in the
 * settings list implying a correction was learned when none was, which is the
 * failure docs/09-v2-backlog.md §2b.4 calls worse than having no rule.
 *
 * ONE RULE PER TRAIL PER LOAN. The user confirms this month's payment and next
 * month's, and a second identical rule would add nothing to the score (the
 * signal fires once) while doubling a row in the settings list they have to be
 * able to read. Checked against DISABLED rules too, deliberately: a rule the
 * user switched off is a decision, and re-creating it on the next confirmation
 * would overturn it silently.
 */
async function teachLoanPaymentRule(input: {
  loanId: string;
  merchant: string | null;
  counterparty: string | null;
  direction: TxDirection;
  createdFrom: string;
}): Promise<void> {
  const pattern = trailPattern(input.merchant, input.counterparty);
  if (pattern === null) return;

  const folded = foldMerchant(pattern);
  const taught = await listUserRules("mark-loan-payment");
  const already = taught.some(
    (rule) =>
      rule.action.kind === "mark-loan-payment" &&
      rule.action.loanId === input.loanId &&
      foldMerchant(rule.matcher.merchantPattern) === folded,
  );
  if (already) return;

  await createUserRule({
    // THE DIRECTION IS PART OF THE TRAIL. Money moving the other way between
    // the same two parties is not a payment on this loan — `recordPayment`
    // would throw `PaymentDirectionMismatchError` on it — and a matcher that
    // omitted it would describe a rule broader than anything that can be acted
    // on. The scorer filters on direction before it ever reads a rule, so this
    // buys nothing there; it buys the settings list a rule that states what it
    // actually means.
    matcher: { merchantPattern: pattern, direction: input.direction },
    action: { kind: "mark-loan-payment", loanId: input.loanId },
    createdFrom: input.createdFrom,
  });
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
    // ALREADY RECORDED SOMEWHERE ELSE, AND THAT IS AN ANSWER, NOT A FAULT.
    //
    // Two surfaces can record this match and until now neither told the other:
    // this card, and the loan detail screen's match sheet. Confirm the sheet
    // first and the card survived; pressing it then reached `recordPayment`,
    // which found the transaction claimed and threw
    // `PaymentAlreadyMatchedError`, which app/review/index.tsx rendered as
    // "That didn't go through, and nothing was saved". It HAD gone through, it
    // WAS saved, and no amount of trying again could ever succeed. The only
    // working button left was "Not a loan payment", so the app was asking the
    // user to record the opposite of what happened. That is the owner's
    // 2026-09-05 report.
    //
    // RESOLVES, WRITES NOTHING. The card asked "is this a payment on one of
    // your loans?" and the ledger already says yes, so the question has an
    // answer and the item closes as `confirmed`. Writing a second
    // `loan_payments` row is not available even in principle: `transaction_id`
    // is UNIQUE, which is invariant I12 in schema form.
    //
    // TRUE EVEN WHEN THE CLAIM IS ANOTHER LOAN'S. I12 gives a transaction one
    // loan, so a card offering a second one has been overtaken by events. The
    // existing payment is the honest return value, and leaving the item open to
    // ask again would put an unanswerable question back in front of the user.
    //
    // AND IT TEACHES NOTHING. The row is already claimed, possibly by a
    // DIFFERENT loan than the one this card offered, and a rule saying "this
    // trail pays loan X" written off a payment that went to loan Y would score
    // every future repayment towards the wrong utang. The teaching below sits
    // on the branch that actually records the match, where the loan in the rule
    // is the loan the money paid.
    const existing = await getPaymentByTransaction(payload.transactionId);
    if (existing !== null) {
      await resolve(itemId, "confirmed");
      return existing;
    }

    const payment = await recordPayment({ loanId, transactionId: payload.transactionId });
    // INSIDE THE SAME UNIT OF WORK as the payment and the resolve, which is
    // what `unit_of_work.ts` exists for in its own words: "a Transaction, a
    // UserRule and a resolved queue item, all three or none of them". A rule
    // that survived a rolled-back payment would score a loan the user never
    // confirmed anything against.
    await teachLoanPaymentRule({
      loanId,
      merchant: payload.merchant,
      counterparty: payload.counterparty,
      direction: payload.direction,
      createdFrom: itemId,
    });
    await resolve(itemId, "confirmed");
    return payment;
  });
}

/**
 * Closes every OPEN loan-match card for a transaction, because it has one now.
 *
 * THE HALF OF THE RACE THAT NEVER REACHES THE CARD. `confirmLoanMatch` above
 * handles a user who arrives at the card second. This handles the user who
 * never goes back to it: they record the payment on the loan screen, and the
 * card would otherwise sit in the queue asking a question that is already
 * answered until it expires, offering an accept that can only fail.
 *
 * `confirmed`, not `dismissed`. The card asked "is this a payment on one of
 * your loans", the answer turned out to be yes, and a queue that recorded it
 * as a dismissal would be filing the user's own decision as a rejection.
 *
 * IT TAKES NO RESOLUTION ARGUMENT, AND THAT IS A DECISION, NOT AN OVERSIGHT.
 * Two different things bring a caller here: the payment was recorded on
 * another surface (the answer is yes), and the transaction was deleted from
 * the ledger (GAP-108 — the question is not answered at all, it is void,
 * because the row it asked about is gone). Distinguishing them looks worth a
 * parameter and is not, because nothing downstream can record the difference:
 * `review_queue_repo.resolve` opens with `void resolution`, and its own doc
 * says the argument "is accepted for the pinned contract §3 signature but not
 * persisted". All that is ever written is `resolved_at`. A parameter here
 * would state an intention it cannot store, and an argument that READS as
 * though it changes the row is worse than no argument at all — the next
 * person writes a test asserting a distinction that has never existed. If a
 * resolution is ever persisted, add it back here, with a test that reads it
 * back out.
 */
export async function closeLoanMatchesFor(transactionId: string): Promise<void> {
  const open = await listOpen();
  for (const item of open) {
    if (readLoanMatchPayload(item)?.transactionId === transactionId) {
      await resolve(item.id, "confirmed");
    }
  }
}

/**
 * Record a payment from OUTSIDE the queue, and close whatever the queue was
 * still asking about it.
 *
 * ONE UNIT OF WORK, for the same reason `confirmLoanMatch` is one: a recorded
 * payment beside a surviving card is precisely the state this task exists to
 * remove, and a half-applied write would recreate it.
 *
 * IT LIVES HERE AND NOT IN `loans_service.ts`. That module must not import the
 * review queue. This one already imports both sides and is the only module
 * allowed to; reversing that would make the two a cycle, which is how the Plan
 * tab stopped rendering under Jest during m2 Task 8.
 *
 * IT TEACHES THE SAME RULE THE CARD DOES. Flow step 3 names both surfaces —
 * "the user confirms or rejects from the loan detail OR the Review Queue" — and
 * step 4's UserRule is written by the confirmation, not by which screen it was
 * made on. Teaching from one and not the other would leave the match sheet's
 * users permanently at the confidence they started with, and the two surfaces
 * disagreeing about the same pair of rows is the failure `findLoanMatches...`'s
 * "ONE SCORER, NOT TWO" note already guards from the other side.
 *
 * `recordManualPayment` (loans_service) deliberately teaches NOTHING, and the
 * distinction is the trail. Both of these link a transaction the PROVIDER
 * wrote, so the name in the rule is the name the next notification will carry.
 * A manual payment mints its own row with `merchant: loan.counterparty` — the
 * user's own "Kuya Ben" — and a rule built from that would match nothing a
 * provider ever sends.
 */
export async function recordPaymentAndCloseCards(
  loanId: string,
  transactionId: string,
): Promise<LoanPayment> {
  return withUnitOfWork(async () => {
    const payment = await recordPayment({ loanId, transactionId });
    // AFTER `recordPayment`, so the direction invariant has already been
    // enforced: a mismatch throws and rolls the whole unit back, rather than
    // leaving behind a rule for a match that was never legal.
    const transaction = await getTransaction(transactionId);
    if (transaction !== null) {
      await teachLoanPaymentRule({
        loanId,
        merchant: transaction.merchant,
        counterparty: transaction.counterparty,
        direction: transaction.direction,
        createdFrom: transactionId,
      });
    }
    await closeLoanMatchesFor(transactionId);
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
