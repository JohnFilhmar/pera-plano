// components/review/review_card.tsx — m1c plan Task 9, rules 3–5;
// docs/04-features/08-review-queue.md §Item types and their cards.
//
// ONE CARD PER THING THE PIPELINE REFUSED TO DECIDE. Every card here is the app
// saying "I saw money move and I am not sure enough to record it silently", and
// the queue is only worth having if each card can be settled in one tap by
// someone who has read it.
//
// THREE THINGS THIS FILE IS CAREFUL ABOUT.
//
//   THE SENTENCE IS THE GATE'S, NOT THIS FILE'S. `GATE_REASONS` holds the exact
//   strings `confidence_gate.ts` stamped onto the payload, and `reviewReason`
//   prefers the payload's own `reason` before falling back to the entry written
//   for that route. Nothing here restates one. Two copies of a sentence the user
//   reads at their most anxious moment will drift, and the copy they see will be
//   the stale one — a card explaining itself with yesterday's wording is worse
//   than one that says nothing, because it is confidently wrong.
//
//   TWO OF THE FOUR KINDS ARRIVE WITH NO REASON AT ALL. `pipeline.ts` omits it
//   for `unknown-provider` at BOTH queue sites, and again for the
//   `parsed === null` low-confidence site. Those are the two cards the user
//   understands least — an app they have never heard of, and a notification
//   nothing could be read from — so they are exactly the ones that must not
//   render blank. See `REASON_FALLBACKS`.
//
//   A PAIR IS SHOWN AS A PAIR. "Same transaction or different?" and "is this a
//   transfer?" are questions about two records. A card showing one of them asks
//   the user to judge a pairing they cannot see, so the counterpart is resolved
//   through `useTransaction` and rendered beside the candidate — and when it has
//   gone, the card says so rather than leaving half the question blank.
//
// ACTIONS ARE RENDERED HERE AND WIRED IN TASK 10. A card handed no handler
// renders its pair DISABLED rather than live-but-inert: rule 4 is about what the
// card shows, and a money decision that silently does nothing when tapped is the
// affordance Tasks 4 and 6 both refused to ship.
//
// A SECOND, NARROWER REASON THE PRIMARY CAN BE DISABLED: task 4b's guard,
// widened by the whole-branch review to `missingLedgerField`. A
// `low-confidence` card whose payload is missing ANY field the ledger
// requires — a positive amount, a direction, or a wallet — disables ITS OWN
// primary even with a handler supplied, because tapping it could only throw
// inside `proposalFrom` and be swallowed. See `ReviewCardProps.onPrimary`'s
// doc comment for why that one kind is the only exception to "disabled means
// no handler".
import { CircleHelp } from "lucide-react-native";
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Button, registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { providerLabelForPackage } from "@/constants/providers";
import { useRawCapture } from "@/hooks/queries/use_raw_capture";
import { useTransaction } from "@/hooks/queries/use_transaction";
import { GATE_REASONS } from "@/lib/ingest/confidence_gate";
import type { ProviderRuleset } from "@/lib/ingest/ruleset_types";
import type {
  Category,
  Centavos,
  RawCapture,
  ReviewItemPayload,
  ReviewKind,
  ReviewQueueItem,
  TxDirection,
  Wallet,
} from "@/types/domain";

import { ConfidenceMeter, confidencePercent } from "./confidence_meter";

/** The card's leading glyph (task-4b) — a generic "this needs a decision"
 * mark for all four kinds, not a per-kind icon: `kind` already has its own
 * pair of action labels (`REVIEW_ACTIONS`), and a glyph that changed with it
 * would be one more thing to keep in sync with no test pinning it. */
const QuestionGlyph = registerIcon(CircleHelp);

export type ReviewActionPair = { primary: string; secondary: string };

/**
 * The four action pairs, in the SPEC's words rather than the plan's.
 *
 * docs/04-features/08-review-queue.md §"Item types and their cards" names every
 * one of these; the m1c plan's Task 9 rule 4 renames three of them ("Merge" /
 * "Keep both", "Link as transfer" / "Keep separate", "Yes, it is" / "No, ignore
 * this app"). Global Constraints settle it — "Where this plan and a spec
 * disagree, the spec wins" — and the spec's wording is the better half of the
 * disagreement anyway: every string below is the user's ANSWER to the question
 * the card just asked, in their own words. "Merge" is a database operation;
 * "Same transaction" is what the user actually knows.
 *
 * Rule 7: the primary is reachable in exactly one tap from the card. The
 * secondary of a low-confidence card is the only one that opens a form, which is
 * why it is the only pair whose second label is a verb rather than an answer.
 */
export const REVIEW_ACTIONS: Record<ReviewKind, ReviewActionPair> = {
  "low-confidence": { primary: "Looks right", secondary: "Correct" },
  "possible-duplicate": { primary: "Same transaction", secondary: "Different" },
  "ambiguous-transfer": { primary: "It's a transfer", secondary: "Not a transfer" },
  "unknown-provider": { primary: "This is a money notification", secondary: "Not money" },
  /**
   * The fifth kind's pair, and it is the only one whose PRIMARY names a
   * counterparty rather than a verdict — because it is the only kind whose
   * answer is a CHOICE among the user's own loans, not a yes/no about one
   * record. `loanMatchPrimaryLabel` builds the real string from the sole
   * candidate; this entry is the wording when there is nothing to name (a
   * payload that lost its candidates, or a card rendered without one).
   *
   * The secondary is a rejection, and per loans rule 10 that is ALL it is:
   * "Rejecting a suggestion never creates a negative UserRule automatically."
   * "Not a loan payment" says what the user decided about THIS transaction and
   * promises nothing about the next one — which is exactly what the app does.
   */
  "loan-match": { primary: "Record this payment", secondary: "Not a loan payment" },
  /**
   * SAME WORDS AS `ambiguous-transfer`, ON PURPOSE. Both kinds ask the exact
   * same yes/no question — "does this leg pair with another movement of the
   * same money?" — and differ only in whether a candidate counterpart already
   * exists to name (`ambiguous-transfer`) or has to be chosen from scratch
   * (`one-sided-transfer`, `payload.counterpartWalletId` still `null` or a
   * rule's guess). The card body that lets the user make that choice is
   * Task 12's; this entry only supplies the pair's wording so the type
   * compiles in the meantime.
   */
  "one-sided-transfer": { primary: "It's a transfer", secondary: "Not a transfer" },
};

/**
 * The reject affordance's label — task 4a.
 *
 * THE SAME WORDS `unknown-provider`'s SECONDARY already uses ("Not money" in
 * `REVIEW_ACTIONS`) and the same words `use_review_action.ts`'s own doc
 * comment uses for `dismiss`. A third wording for the same outcome ("Reject",
 * "Dismiss", "Ignore") would ask the user to learn that they mean the same
 * thing, on the one card kind where they are seeing the sentence for the
 * first time.
 */
export const REVIEW_REJECT_LABEL = "Not money";

/**
 * The sentence to show when the payload carries none — one `GATE_REASONS` entry
 * per kind, never a string written here.
 *
 * WHICH ENTRY, AND WHY EACH IS THE RIGHT ONE:
 *
 *   `unknown-provider` → `unknownProvider`. Written for exactly this case, and
 *   it is the reason `hardRouteReason` would have returned had the capture ever
 *   reached the gate. It does not: `pipeline.ts` queues an unknown package
 *   BEFORE the stages run, which is why there is no `reason` in the payload at
 *   all rather than an oversight to work around.
 *
 *   `low-confidence` → `unreadable`. The only low-confidence payload missing a
 *   reason is the `parsed === null` one — "matched a provider but nothing
 *   readable in the text" — and `unreadable` is the gate's sentence for a score
 *   below the prefilled band, which is what a failed parse scores (0).
 *
 *   The two pair kinds keep their hard-route reasons. Those payloads always
 *   carry one, so these entries only ever answer a corrupt or hand-built row —
 *   but a card with no sentence is the failure this table exists to make
 *   impossible, so every kind has an entry rather than three.
 */
export const REASON_FALLBACKS: Record<ReviewKind, string> = {
  "low-confidence": GATE_REASONS.unreadable,
  "unknown-provider": GATE_REASONS.unknownProvider,
  "possible-duplicate": GATE_REASONS.possibleDuplicate,
  "ambiguous-transfer": GATE_REASONS.ambiguousTransfer,
  /**
   * NOT a `GATE_REASONS` entry, because the confidence gate never saw this
   * item — `loan_match_queue.ts` raises it AFTER the row was committed, with no
   * gate involved at all. Its `loanMatchReason` is what every real payload
   * carries; this is the singular wording, kept as the fallback for the one
   * that reads better when the candidate count is unknown.
   */
  "loan-match": "This looks like a payment on one of your loans. Record it?",
  /**
   * HAND-WRITTEN, LIKE `loan-match`'s, NOT A `GATE_REASONS` ENTRY — Task 10
   * wires the gate's own `oneSidedTransfer` reason onto the payload for every
   * real item, so this only ever answers a corrupt or hand-built row (same
   * caveat as the two pair kinds above). Worded to match the question Task
   * 12's card body asks ("Where did this money come from/go?"), not the
   * gate's routing language.
   */
  "one-sided-transfer": "PeraPlano saw one side of a possible transfer. Where did the rest of it go?",
};

/**
 * Why this item is in the queue, in one plain sentence (rule 3).
 *
 * The payload's own `reason` wins, because it is the string the gate chose for
 * THIS event out of seven possibilities — a low-confidence item can be here for
 * an unmapped wallet, a foreign currency or simply a weak score, and the
 * fallback table cannot tell those apart. A blank or non-string value falls
 * through to the table rather than rendering an empty line.
 */
export function reviewReason(item: ReviewQueueItem): string {
  const stated = item.payload.reason;
  if (typeof stated === "string" && stated.trim() !== "") return stated;
  return REASON_FALLBACKS[item.kind];
}

// ---------------------------------------------------------------------------
// Payload readers
// ---------------------------------------------------------------------------
//
// `ReviewItemPayload` is `Record<string, unknown>` — the repository stores it
// verbatim as JSON and deliberately never interprets it (review_queue_repo.ts's
// header). So every field is read defensively: an item enqueued by an older
// build, or by a stage that has since changed shape, must render a partial card
// rather than crash the whole queue and take every other item down with it.

function readString(payload: ReviewItemPayload, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readAmount(payload: ReviewItemPayload): Centavos | null {
  const value = payload.amount;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * True when this card's payload carries an amount the ledger could accept.
 *
 * DELIBERATELY NOT "is `readAmount` non-null" — that reader above only feeds
 * DISPLAY (`Side`'s amount), and a genuine ₱0.00 notification should still
 * render as ₱0.00, not as "Amount not read". Whether the ledger will accept
 * the row is a stricter, different question, and `resolve_actions.ts`'s OWN
 * `readAmount` is the authority on it: that function requires `value > 0`
 * before `proposalFrom` will build a Transaction, so this predicate mirrors
 * that positivity rule rather than this file's own display reader.
 *
 * THE FAILURE MODE THIS PREVENTS, SPECIFICALLY: `lib/ingest/amount.ts`'s
 * `parseAmountToCentavos` returns `0`, never `null`, for a genuine "₱0.00" —
 * by that module's own words, "0 is a legitimate amount and must stay
 * distinguishable from a refusal". So a low-confidence item can reach this
 * card with a real, non-null `amount: 0`. Treating that as "parsed" would
 * render the primary ENABLED, and the tap would still throw
 * `IncompleteReviewItemError` inside `proposalFrom` with no `onError` to
 * catch it — the exact silent dead tap this task exists to close, just
 * reachable through a different payload than "amount is missing".
 */
export function hasParsedAmount(item: ReviewQueueItem): boolean {
  const amount = readAmount(item.payload);
  return amount !== null && amount > 0;
}

function readDirection(payload: ReviewItemPayload): TxDirection | null {
  return payload.direction === "in" || payload.direction === "out" ? payload.direction : null;
}

/** The three fields `proposalFrom` refuses to build a Transaction without. */
export type LedgerRequiredField = "amount" | "direction" | "wallet";

/**
 * Which ledger-required field this payload is missing, or `null` when it
 * carries all three.
 *
 * MIRRORS `resolve_actions.ts`'s `proposalFrom` — same three checks, in the
 * same order — because that function is the one that actually decides, and
 * any disagreement between the two shows up as a button that looks live and
 * does nothing. `hasParsedAmount` above answers only the first of the three;
 * this answers all of them.
 *
 * THE FAILURE MODE THIS PREVENTS, AND WHY THE WALLET IS THE IMPORTANT ONE: an
 * unmapped wallet is a ROUTINE hard route, not an edge case.
 * `GATE_REASONS.unmappedWallet` ("PeraPlano could not tell which account this
 * came from. Choose the wallet.") fires for every notification from an
 * account the user has not added yet, and `pipeline.ts` enqueues those as
 * `low-confidence` with `walletId: null`. Before this guard their primary
 * rendered ENABLED: the tap threw `IncompleteReviewItemError(id, "wallet")`
 * inside `proposalFrom`, `useReviewAction`'s mutation carries no `onError`,
 * and the biggest, greenest button on the card did nothing at all. That is
 * the identical trap task 4b closed for `amount`, reached through a different
 * field — found by the whole-branch review, 2026-08-21.
 */
export function missingLedgerField(item: ReviewQueueItem): LedgerRequiredField | null {
  if (!hasParsedAmount(item)) return "amount";
  if (readDirection(item.payload) === null) return "direction";
  if (readString(item.payload, "walletId") === null) return "wallet";
  return null;
}

/**
 * What the blocked line calls each field. The user's words, not the schema's:
 * "direction" is a column name, and someone reading a card about their own
 * money thinks in "money in or out".
 */
const BLOCKED_FIELD_LABEL: Record<LedgerRequiredField, string> = {
  amount: "the amount",
  direction: "whether this was money in or out",
  wallet: "the wallet",
};

/**
 * The score, or `null` when the payload never carried one.
 *
 * THE DISTINCTION IS THE WHOLE POINT, and `?? 0` would destroy it.
 * `unknown-provider` payloads have no `confidence` key because nothing was
 * parsed; a low-confidence payload from a failed parse has `confidence: 0`
 * because the parse ran and scored nothing. The first must render no meter, the
 * second must render an honest 0%.
 */
function readConfidence(payload: ReviewItemPayload): number | null {
  const value = payload.confidence;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The counterpart this card has to show beside its candidate, if any. */
function counterpartIdOf(item: ReviewQueueItem): string | null {
  if (item.kind === "possible-duplicate") {
    return readString(item.payload, "duplicateOfTransactionId");
  }
  if (item.kind === "ambiguous-transfer") {
    return readString(item.payload, "transferCounterpartTransactionId");
  }
  return null;
}

/**
 * One loan a `loan-match` payload offers, as this card understands it.
 *
 * READ DEFENSIVELY OFF `payload`, NOT IMPORTED FROM `loan_match_queue.ts`.
 * That module is where the shape is written and documented, but it reaches the
 * loans and review-queue repositories, and pulling it into a component would
 * drag the database layer into every render tree that mounts a card — the same
 * separation `lib/loans/loans_service.ts`'s own header records paying for when
 * reminders had to be moved out of it before the Plan tab could render under
 * Jest. Reading the JSON here matches what this file already does for all four
 * other kinds, and for the same stated reason: an item enqueued by an older
 * build must render a partial card rather than crash the whole queue.
 */
export type LoanCandidateView = {
  loanId: string;
  counterparty: string;
  /** `null` when the payload carried no balance — the row still renders, without one. */
  outstanding: Centavos | null;
  reasons: string[];
};

/** The loans this card offers, in payload order (best first — the matcher sorted them). */
export function loanCandidates(item: ReviewQueueItem): LoanCandidateView[] {
  if (item.kind !== "loan-match") return [];
  const raw = item.payload.candidates;
  if (!Array.isArray(raw)) return [];

  const views: LoanCandidateView[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    const loanId = typeof candidate.loanId === "string" ? candidate.loanId : null;
    if (loanId === null || loanId === "") continue;
    views.push({
      loanId,
      // A loan always has a counterparty (`loans.counterparty` is NOT NULL), so
      // this only ever fires for a hand-built row — but an unnamed button on a
      // money decision is the one thing worse than no button.
      counterparty:
        typeof candidate.counterparty === "string" && candidate.counterparty.trim() !== ""
          ? candidate.counterparty
          : "This loan",
      outstanding:
        typeof candidate.outstanding === "number" && Number.isFinite(candidate.outstanding)
          ? candidate.outstanding
          : null,
      reasons: Array.isArray(candidate.reasons)
        ? candidate.reasons.filter((reason): reason is string => typeof reason === "string")
        : [],
    });
  }
  return views;
}

/**
 * The primary button's words.
 *
 * A `loan-match` card with exactly ONE candidate names it — "Record on Kuya
 * Ben" — because that is the whole decision, and a generic "Record this
 * payment" would make the user scroll back up to remember which loan they were
 * agreeing to. With two or more, the primary is not the affordance at all (the
 * per-candidate buttons are, and the screen supplies no `onPrimary`), so the
 * static label stands.
 */
export function primaryLabelFor(item: ReviewQueueItem): string {
  const candidates = loanCandidates(item);
  if (item.kind === "loan-match" && candidates.length === 1) {
    return `Record on ${candidates[0].counterparty}`;
  }
  return REVIEW_ACTIONS[item.kind].primary;
}

/** What each side of a pair is called, so the user knows which is which. */
const SIDE_LABELS: Record<ReviewKind, { candidate: string; counterpart: string }> = {
  "low-confidence": { candidate: "What PeraPlano read", counterpart: "" },
  "unknown-provider": { candidate: "What PeraPlano read", counterpart: "" },
  /**
   * "ALREADY IN YOUR LEDGER", not "What PeraPlano read". Every other card shows
   * a PROPOSAL — a row that does not exist yet and will not until the user
   * agrees. A loan-match card shows a row that is already committed and already
   * counted; the only question is whether it also pays down a loan. A label
   * implying the transaction is still pending would invite the user to reject
   * it in the belief that rejecting keeps it out of their ledger.
   */
  "loan-match": { candidate: "Already in your ledger", counterpart: "" },
  "possible-duplicate": {
    candidate: "This notification",
    counterpart: "Already in your ledger",
  },
  "ambiguous-transfer": {
    candidate: "This notification",
    counterpart: "The possible other leg",
  },
  /**
   * "What PeraPlano read", same as `low-confidence`/`unknown-provider` —
   * task-10-brief.md confirms a one-sided transfer "queues an item and
   * commits nothing", so this leg is a PROPOSAL like theirs, not an
   * already-committed row like `loan-match`'s. `counterpart` is unreachable
   * today: `counterpartIdOf` returns `null` for this kind (the whole point of
   * "one-sided" is that no committed counterpart row exists to fetch), so
   * `CounterpartSide` never renders it. Empty, like every other kind with no
   * counterpart to name.
   */
  "one-sided-transfer": { candidate: "What PeraPlano read", counterpart: "" },
};

// ---------------------------------------------------------------------------
// Sides
// ---------------------------------------------------------------------------

type SideProps = {
  label: string;
  amount: Centavos | null;
  direction: TxDirection | null;
  merchant: string | null;
  walletName: string | null;
  categoryName: string | null;
  /**
   * The category's confidence, shown as a trailing percentage on its chip
   * (task-4b: "the top suggestion carries its confidence"). `undefined` for
   * every call site but the candidate side — the counterpart is a real,
   * already-committed row (rule: "Both legs are already-committed
   * Transactions"), not a guess, and has no score to show.
   */
  categoryConfidence?: number | null;
  testID: string;
};

/**
 * One record, as this card understands it. Used for the parsed candidate and —
 * with the fields read off a real row instead of a payload — for its
 * counterpart, so the two are visually comparable rather than merely adjacent.
 */
function Side({
  label,
  amount,
  direction,
  merchant,
  walletName,
  categoryName,
  categoryConfidence,
  testID,
}: SideProps) {
  const categoryLabel =
    categoryName === null
      ? null
      : categoryConfidence === null || categoryConfidence === undefined
        ? categoryName
        : `${categoryName} · ${confidencePercent(categoryConfidence)}%`;

  return (
    <View testID={testID} className="gap-1 rounded-xl bg-bg p-3 dark:bg-bg-dark">
      <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">{label}</Text>
      {amount === null ? (
        // NEVER "₱0.00". A card about money that definitely moved, showing zero,
        // is a false statement the user has no way to detect — and the whole
        // reason this item is in the queue is that the amount could not be read.
        <Text className="text-base font-semibold text-fg dark:text-fg-dark">
          Amount not read
        </Text>
      ) : (
        <AmountText amount={amount} direction={direction ?? undefined} size="lg" />
      )}
      <Text className="text-sm text-fg dark:text-fg-dark">
        {merchant ?? "No merchant in the notification"}
      </Text>
      {/* `fill="outline"` on both, not the default solid — this box is
          `bg-bg`, and `tone="neutral" fill="solid"` is `bg-bg` too (Chip's
          own file: "neutral is the only unfilled tone"), which painted these
          two chips invisible against their own container. */}
      <View className="flex-row flex-wrap items-center gap-2 pt-1">
        {walletName === null ? (
          // `warn`, because an unmatched wallet is the one field the user
          // must supply before anything can be committed.
          <Chip label="No wallet matched" tone="warn" />
        ) : (
          <Chip label={walletName} fill="outline" />
        )}
        {categoryLabel === null ? null : <Chip label={categoryLabel} fill="outline" />}
      </View>
    </View>
  );
}

function walletNameOf(wallets: readonly Wallet[], walletId: string | null): string | null {
  if (walletId === null) return null;
  return wallets.find((wallet) => wallet.id === walletId)?.name ?? null;
}

/**
 * The committed half of a pair, plus the fee gap when there is one.
 *
 * ITS OWN COMPONENT SO THE HOOK IS UNCONDITIONAL. `useTransaction` may only be
 * called for the two kinds that have a counterpart, and React forbids a
 * conditional hook — so the condition lives on whether this component is
 * rendered at all, not inside it.
 */
function CounterpartSide({
  item,
  transactionId,
  wallets,
  candidateAmount,
}: {
  item: ReviewQueueItem;
  transactionId: string;
  wallets: readonly Wallet[];
  candidateAmount: Centavos | null;
}) {
  const { data: transaction, isPending } = useTransaction(transactionId);
  const label = SIDE_LABELS[item.kind].counterpart;
  const testID = `review-counterpart-${item.id}`;

  if (isPending) {
    return (
      <View testID={testID} className="gap-1 rounded-xl bg-bg p-3 dark:bg-bg-dark">
        <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">{label}</Text>
      </View>
    );
  }

  if (!transaction) {
    // The row was deleted or purged between the enqueue and this render. Saying
    // so is the only honest option: the user cannot answer "same or different?"
    // about a record that is gone, and a silently one-sided card would look like
    // the question was answerable.
    return (
      <View testID={testID} className="gap-1 rounded-xl bg-bg p-3 dark:bg-bg-dark">
        <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">{label}</Text>
        <Text className="text-sm text-fg-2 dark:text-fg-2-dark">
          That record is no longer available.
        </Text>
      </View>
    );
  }

  // §"Ambiguous transfer": the legs "with wallets, amounts, and the fee
  // difference". The gap is the number that settles the pairing — ₱10 short of
  // the other leg is a transfer fee, ₱500 short is a different transaction —
  // and computing it here rather than trusting a payload field means it always
  // describes the two rows actually on screen.
  const feeGap =
    candidateAmount === null ? 0 : Math.abs(candidateAmount - transaction.amount);

  return (
    <>
      <Side
        testID={testID}
        label={label}
        amount={transaction.amount}
        direction={transaction.direction}
        merchant={transaction.merchant ?? transaction.counterparty}
        walletName={walletNameOf(wallets, transaction.walletId)}
        categoryName={null}
      />
      {item.kind === "ambiguous-transfer" && feeGap > 0 ? (
        <View
          testID={`review-fee-${item.id}`}
          className="flex-row items-center justify-between px-1"
        >
          <Text className="text-xs text-fg-2 dark:text-fg-2-dark">Difference between the legs</Text>
          <AmountText amount={feeGap} size="sm" />
        </View>
      ) : null}
    </>
  );
}

/**
 * Up to three distinct, non-empty lines of the capture — the spec's "captured
 * snippet".
 *
 * All four fields, not just `text`: an expanded Android notification routinely
 * carries the amount the collapsed one omits, and this card's entire question is
 * "is this money?". Duplicates are collapsed because Android repeats `text` in
 * `bigText` constantly, and the same sentence printed twice reads as a bug.
 */
function snippetLines(capture: RawCapture): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const field of [capture.title, capture.text, capture.bigText, capture.subText]) {
    const value = field?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    lines.push(value);
    if (lines.length === 3) break;
  }
  return lines;
}

/**
 * The unknown-provider body: which app it came from, and what it said.
 *
 * BOTH HALVES ARE THE QUESTION. "Is this a money notification?" cannot be
 * answered without the notification, and the source app is what makes the
 * follow-up ("always ignore this app") a decision rather than a guess. Its own
 * component for the same reason as `CounterpartSide` — `useRawCapture` is only
 * legal for this kind.
 */
function UnknownSourceBody({
  item,
  providers,
}: {
  item: ReviewQueueItem;
  providers: readonly ProviderRuleset[];
}) {
  const { data: capture } = useRawCapture(item.rawNotificationId);

  const packageName = readString(item.payload, "packageName") ?? capture?.packageName ?? null;
  // By definition no ruleset provider matches an unknown package, so this
  // resolves to the package id itself — which is still the most specific true
  // thing the app can say about an app it does not recognise.
  const sourceName =
    packageName === null ? "An app on this phone" : providerLabelForPackage(providers, packageName);
  const lines = capture ? snippetLines(capture) : [];

  return (
    <View className="gap-2">
      <View className="gap-1">
        <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">From</Text>
        <Text
          testID={`review-source-${item.id}`}
          className="text-base font-semibold text-fg dark:text-fg-dark"
        >
          {sourceName}
        </Text>
      </View>
      {lines.length > 0 ? (
        // "CAPTURED TEXT" (task-4b) — `bg-chip`, not `bg-bg`: this sits
        // inside a `bg-surface` Card same as `Side`'s boxes, but is labelled
        // as a QUOTE of the notification rather than a proposed field, so it
        // gets the app's "quoted material" treatment (matches the captured
        // text on `why_recorded_panel.tsx`'s source-notification block).
        <View
          testID={`review-snippet-${item.id}`}
          className="gap-1 rounded-xl bg-chip p-3 dark:bg-chip-dark"
        >
          <Text className="text-badge font-bold text-fg-2 dark:text-fg-2-dark">
            CAPTURED TEXT
          </Text>
          {lines.map((line) => (
            <Text key={line} className="font-mono text-micro text-fg dark:text-fg-dark">
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The loans this transaction might be paying — the "listing the candidates"
 * half of loans rule 9.
 *
 * WITH ONE CANDIDATE this renders its reasons and NO button: the card's own
 * primary already says "Record on <name>" (`primaryLabelFor`), and a second
 * control doing the identical thing on the same card is how a user learns not
 * to read either.
 *
 * WITH TWO OR MORE it renders a button per loan, and the screen supplies no
 * `onPrimary` at all — which this file's own rule renders as DISABLED, so the
 * biggest button on the card cannot pick a loan on the user's behalf. That is
 * rule 9 verbatim: "If two or more open loans are plausible for one
 * Transaction, it is always a suggestion listing the candidates — never an
 * auto-match." Choosing the top-scoring one silently would be an auto-match
 * wearing a confirmation, and the loan it guessed wrong on is a balance the
 * user has no reason to re-check.
 *
 * THE REASONS ARE NOT DECORATION. `scoreCandidate` produces them for the same
 * purpose the match sheet needs them (loans Task 8 rule 5: each candidate shown
 * "with its amount, date, and WHY IT MATCHED"), and here they are the only way
 * to tell two utangs apart when both are plausible. A bare score asks the user
 * to trust a number they cannot check, on a decision that moves a balance.
 */
function LoanMatchBody({
  item,
  candidates,
  onChooseLoan,
}: {
  item: ReviewQueueItem;
  candidates: readonly LoanCandidateView[];
  onChooseLoan?: (item: ReviewQueueItem, loanId: string) => void;
}) {
  const choosing = candidates.length > 1;

  return (
    <View testID={`review-loans-${item.id}`} className="gap-2">
      {choosing ? (
        <Text className="text-xs uppercase text-fg-2 dark:text-fg-2-dark">
          Which loan is this?
        </Text>
      ) : null}
      {candidates.map((candidate) => (
        <View
          key={candidate.loanId}
          testID={`review-loan-${item.id}-${candidate.loanId}`}
          className="gap-1 rounded-xl bg-bg p-3 dark:bg-bg-dark"
        >
          <View className="flex-row items-center justify-between gap-2">
            <Text className="flex-1 text-base font-semibold text-fg dark:text-fg-dark">
              {candidate.counterparty}
            </Text>
            {candidate.outstanding === null ? null : (
              <AmountText amount={candidate.outstanding} size="sm" />
            )}
          </View>
          {candidate.reasons.length === 0 ? null : (
            <View className="flex-row flex-wrap items-center gap-2 pt-1">
              {candidate.reasons.map((reason) => (
                <Chip key={reason} label={reason} fill="outline" />
              ))}
            </View>
          )}
          {choosing ? (
            <Button
              testID={`review-loan-choice-${item.id}-${candidate.loanId}`}
              title={`Record on ${candidate.counterparty}`}
              variant="secondary"
              size="md"
              disabled={onChooseLoan === undefined}
              onPress={
                onChooseLoan ? () => onChooseLoan(item, candidate.loanId) : () => undefined
              }
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export type ReviewCardProps = {
  item: ReviewQueueItem;
  /** Resolved by the screen, which already holds both collections. */
  wallets?: readonly Wallet[];
  categories?: readonly Category[];
  /** For naming an unknown package as well as it can be named. */
  providers?: readonly ProviderRuleset[];
  /**
   * m1c Task 10. ABSENT MEANS DISABLED, not inert: the pair still renders (rule
   * 4 is about what the card shows) but cannot be tapped, so no triage decision
   * is ever silently dropped on the floor.
   *
   * NOT THE ONLY WAY THE PRIMARY ENDS UP DISABLED, as of task 4b: a
   * `low-confidence` item with no positive `hasParsedAmount` disables the
   * primary even when this prop IS supplied. That is a data-integrity guard,
   * not a missing-handler state — see `missingLedgerField` and `missingField` below.
   */
  onPrimary?: (item: ReviewQueueItem) => void;
  onSecondary?: (item: ReviewQueueItem) => void;
  /**
   * Task 4a. ABSENT MEANS NOT RENDERED — the opposite rule from the pair
   * above, and deliberately so. The pair is DEFINITIONAL to the item's kind
   * (rule 4: every kind has one), so a card handed no primary/secondary
   * handler still shows what the two outcomes ARE, disabled. A reject is not
   * definitional — only `low-confidence` gets one from the screen
   * (`app/review/index.tsx`'s `rejectActionFor`), because it is the only kind
   * that can be pure noise with no pairing question attached. A permanently
   * disabled "Not money" on a duplicate or transfer card would read as a
   * broken button on a card that never had that outcome, not as an
   * inapplicable one — so the screen not supplying the handler means this
   * card simply has no third button, full stop.
   */
  onReject?: (item: ReviewQueueItem) => void;
  /**
   * `loan-match` only, and only when the payload lists TWO OR MORE loans — the
   * one card whose answer is a choice rather than a verdict (loans rule 9).
   * Absent means the per-loan buttons render disabled, the same "absent means
   * disabled" rule the pair above keeps and for the same reason: a money
   * decision that silently does nothing when tapped is the affordance this file
   * refuses to ship.
   */
  onChooseLoan?: (item: ReviewQueueItem, loanId: string) => void;
  testID?: string;
};

export function ReviewCard({
  item,
  wallets = [],
  categories = [],
  providers = [],
  onPrimary,
  onSecondary,
  onReject,
  onChooseLoan,
  testID,
}: ReviewCardProps) {
  const actions = REVIEW_ACTIONS[item.kind];
  const loans = loanCandidates(item);
  const confidence = readConfidence(item.payload);
  const counterpartId = counterpartIdOf(item);
  const amount = readAmount(item.payload);
  const categoryId = readString(item.payload, "categoryId");

  // Task 4b, WIDENED BY THE WHOLE-BRANCH REVIEW (2026-08-21).
  // `low-confidence` is the ONLY kind whose primary can commit an incomplete
  // payload: `possible-duplicate` and `ambiguous-transfer` come from a
  // normalized event (`pipeline.ts`'s two gated queue sites) and always carry
  // amount, direction and wallet, and `unknown-provider`'s primary opens the
  // correction form (`primaryActionFor` in app/review/index.tsx returns
  // `"correct"` for it) rather than committing anything — so there is nothing
  // for those three kinds to guard against here.
  //
  // `resolve_actions.ts`'s `proposalFrom` already throws on any of its three
  // required fields, which is why the LEDGER was never at risk; what this
  // guards is the OTHER failure — that throw becomes a rejected mutation with
  // no `onError` on `useReviewAction`, so the biggest, greenest button on the
  // card did nothing at all when tapped. This originally checked the amount
  // alone, and the WALLET turned out to be the far more common way in, because
  // an unmapped wallet is a routine hard route rather than an edge case. See
  // `missingLedgerField`. Also defensive against a hand-built or older row.
  const missingField = item.kind === "low-confidence" ? missingLedgerField(item) : null;

  return (
    <View testID={testID ?? `review-card-${item.id}`} className="px-4 pb-3">
      <Card>
        <View className="gap-3">
          {/* RULE 3, AND IT IS THE FIRST THING ON THE CARD ON PURPOSE. The user
              reads why before they read what — a card whose explanation sits
              under the actions is a card whose actions get tapped first. The
              glyph disc (task-4b) is purely decorative: `review-reason-{id}`
              is still the same Text, at the same position, with the same
              content — nothing about what it says or where it sits changed,
              only what sits beside it. */}
          <View className="flex-row items-start gap-2">
            <View className="h-9 w-9 items-center justify-center rounded-full bg-chip dark:bg-chip-dark">
              <QuestionGlyph size={18} className="text-fg-2 dark:text-fg-2-dark" />
            </View>
            <Text
              testID={`review-reason-${item.id}`}
              className="flex-1 pt-2 text-sm text-fg dark:text-fg-dark"
            >
              {reviewReason(item)}
            </Text>
          </View>

          {item.kind === "unknown-provider" ? (
            <UnknownSourceBody item={item} providers={providers} />
          ) : (
            <>
              <Side
                testID={`review-candidate-${item.id}`}
                label={SIDE_LABELS[item.kind].candidate}
                amount={amount}
                direction={readDirection(item.payload)}
                merchant={readString(item.payload, "merchant")}
                walletName={walletNameOf(wallets, readString(item.payload, "walletId"))}
                categoryName={
                  categories.find((category) => category.id === categoryId)?.name ?? null
                }
                // "the top suggestion carries its confidence" (task-4b) — the
                // SAME score the meter below reads, on the one side that is a
                // proposal rather than an already-committed row.
                categoryConfidence={confidence}
              />
              {counterpartId === null ? null : (
                <CounterpartSide
                  item={item}
                  transactionId={counterpartId}
                  wallets={wallets}
                  candidateAmount={amount}
                />
              )}
              {loans.length === 0 ? null : (
                <LoanMatchBody item={item} candidates={loans} onChooseLoan={onChooseLoan} />
              )}
              {/* No score, no meter. `unknown-provider` never reaches here, and
                  a payload that lost its `confidence` would otherwise render a
                  0% bar — the app reporting a measurement it never took.

                  A `loan-match` payload carries none either, ON PURPOSE. The
                  meter reads the INGEST confidence — how well the notification
                  parsed — and a loan-match card's transaction parsed perfectly
                  well; it is already committed. Painting the match score in the
                  same bar would say "PeraPlano is 45% sure it read this
                  notification" when what it means is "45% sure this pays that
                  loan", and the per-candidate reasons above are the honest form
                  of the second statement. */}
              {confidence === null ? null : (
                <ConfidenceMeter
                  confidence={confidence}
                  testID={`review-confidence-${item.id}`}
                />
              )}
            </>
          )}

          {/* The transfer-ambiguity banner (task-4b) — real money moved and
              the question is only HOW to record it, which is exactly what
              rule 3's reason sentence already says (`reviewReason`, the
              gate's own words). Reused rather than restated: two copies of
              this sentence on one card would be the drift the file's own
              header warns about, just committed twice in the same render. */}
          {item.kind === "ambiguous-transfer" ? (
            <Chip
              testID={`review-transfer-banner-${item.id}`}
              label={reviewReason(item)}
              tone="warn"
              fill="soft"
            />
          ) : null}

          {/* Primary FULL WIDTH on its own row (task-4b), secondary and
              reject smaller below it — same testIDs, labels, `disabled` and
              `onPress` as before; only the layout changed. NOT icon-only:
              `Button`'s `iconOnly` needs one icon per button, and the
              secondary's label is a different WORD for each of the four
              kinds ("Correct" / "Different" / "Not a transfer" / "This is a
              money notification") — a single pencil (or any one glyph) would
              be right for at most one of them and wrong, silently, for the
              other three. */}
          <Button
            testID={`review-primary-${item.id}`}
            title={primaryLabelFor(item)}
            variant="primary"
            disabled={onPrimary === undefined || missingField !== null}
            onPress={onPrimary ? () => onPrimary(item) : () => undefined}
          />
          {/* "Correct" stays enabled even while the primary is blocked —
              supplying the amount is exactly the way forward, and disabling
              the one path off this card would strand the user on it. */}
          <Button
            testID={`review-secondary-${item.id}`}
            title={actions.secondary}
            variant="secondary"
            size="md"
            disabled={onSecondary === undefined}
            onPress={onSecondary ? () => onSecondary(item) : () => undefined}
          />

          {missingField === null ? null : (
            <Text
              testID={`review-blocked-${item.id}`}
              className="text-xs text-fg-2 dark:text-fg-2-dark"
            >
              {`PeraPlano needs ${BLOCKED_FIELD_LABEL[missingField]} before this can be recorded. Add the details, or reject it.`}
            </Text>
          )}

          {onReject ? (
            <Button
              testID={`review-reject-${item.id}`}
              title={REVIEW_REJECT_LABEL}
              variant="ghost"
              size="md"
              onPress={() => onReject(item)}
            />
          ) : null}
        </View>
      </Card>
    </View>
  );
}
