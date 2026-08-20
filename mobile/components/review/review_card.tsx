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
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
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

import { ConfidenceMeter } from "./confidence_meter";

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
 * THE SCREEN AND THE TESTS SHARE THIS DEFINITION rather than each re-deriving
 * it from `readAmount`, because the one place that actually enforces "no
 * amount, no commit" is `resolve_actions.ts`'s `proposalFrom` — a second,
 * slightly different reader here would let the button's disabled state and
 * the write path disagree about the exact same payload.
 */
export function hasParsedAmount(item: ReviewQueueItem): boolean {
  return readAmount(item.payload) !== null;
}

function readDirection(payload: ReviewItemPayload): TxDirection | null {
  return payload.direction === "in" || payload.direction === "out" ? payload.direction : null;
}

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

/** What each side of a pair is called, so the user knows which is which. */
const SIDE_LABELS: Record<ReviewKind, { candidate: string; counterpart: string }> = {
  "low-confidence": { candidate: "What PeraPlano read", counterpart: "" },
  "unknown-provider": { candidate: "What PeraPlano read", counterpart: "" },
  "possible-duplicate": {
    candidate: "This notification",
    counterpart: "Already in your ledger",
  },
  "ambiguous-transfer": {
    candidate: "This notification",
    counterpart: "The possible other leg",
  },
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
  testID,
}: SideProps) {
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
      <View className="flex-row flex-wrap items-center gap-2 pt-1">
        {walletName === null ? (
          // `warn`, because an unmatched wallet is the one field the user
          // must supply before anything can be committed.
          <Chip label="No wallet matched" tone="warn" />
        ) : (
          <Chip label={walletName} />
        )}
        {categoryName === null ? null : <Chip label={categoryName} />}
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
        <View
          testID={`review-snippet-${item.id}`}
          className="gap-1 rounded-xl bg-bg p-3 dark:bg-bg-dark"
        >
          {lines.map((line) => (
            <Text key={line} className="text-sm text-fg dark:text-fg-dark">
              {line}
            </Text>
          ))}
        </View>
      ) : null}
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
  testID,
}: ReviewCardProps) {
  const actions = REVIEW_ACTIONS[item.kind];
  const confidence = readConfidence(item.payload);
  const counterpartId = counterpartIdOf(item);
  const amount = readAmount(item.payload);
  const categoryId = readString(item.payload, "categoryId");

  // Task 4b. `low-confidence` is the ONLY kind whose primary can commit a
  // payload with no amount: `possible-duplicate` and `ambiguous-transfer`
  // come from a normalized event (`pipeline.ts`'s two gated queue sites) and
  // always carry one, and `unknown-provider`'s primary opens the correction
  // form (`primaryActionFor` in app/review/index.tsx returns `"correct"` for
  // it) rather than committing anything — so there is nothing for those three
  // kinds to guard against here. `resolve_actions.ts`'s `proposalFrom` already
  // throws on a missing amount, which is why the ledger was never actually at
  // risk; what this guards against is the OTHER failure — the mutation
  // rejecting with no `onError` on `useReviewAction`, so the biggest, greenest
  // button on the card did nothing at all when tapped. This is also defensive
  // against a hand-built or older row that predates this guard existing.
  const blockedByMissingAmount = item.kind === "low-confidence" && !hasParsedAmount(item);

  return (
    <View testID={testID ?? `review-card-${item.id}`} className="px-4 pb-3">
      <Card>
        <View className="gap-3">
          {/* RULE 3, AND IT IS THE FIRST THING ON THE CARD ON PURPOSE. The user
              reads why before they read what — a card whose explanation sits
              under the actions is a card whose actions get tapped first. */}
          <Text
            testID={`review-reason-${item.id}`}
            className="text-sm text-fg dark:text-fg-dark"
          >
            {reviewReason(item)}
          </Text>

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
              />
              {counterpartId === null ? null : (
                <CounterpartSide
                  item={item}
                  transactionId={counterpartId}
                  wallets={wallets}
                  candidateAmount={amount}
                />
              )}
              {/* No score, no meter. `unknown-provider` never reaches here, and
                  a payload that lost its `confidence` would otherwise render a
                  0% bar — the app reporting a measurement it never took. */}
              {confidence === null ? null : (
                <ConfidenceMeter
                  confidence={confidence}
                  testID={`review-confidence-${item.id}`}
                />
              )}
            </>
          )}

          <View className="flex-row gap-2">
            <View className="flex-1">
              <Button
                testID={`review-primary-${item.id}`}
                title={actions.primary}
                variant="primary"
                disabled={onPrimary === undefined || blockedByMissingAmount}
                onPress={onPrimary ? () => onPrimary(item) : () => undefined}
              />
            </View>
            <View className="flex-1">
              {/* "Correct" stays enabled even while the primary is blocked —
                  supplying the amount is exactly the way forward, and
                  disabling the one path off this card would strand the
                  user on it. */}
              <Button
                testID={`review-secondary-${item.id}`}
                title={actions.secondary}
                variant="secondary"
                disabled={onSecondary === undefined}
                onPress={onSecondary ? () => onSecondary(item) : () => undefined}
              />
            </View>
          </View>

          {blockedByMissingAmount ? (
            <Text
              testID={`review-blocked-${item.id}`}
              className="text-xs text-fg-2 dark:text-fg-2-dark"
            >
              PeraPlano needs the amount before this can be recorded. Add the details, or reject
              it.
            </Text>
          ) : null}

          {onReject ? (
            <Button
              testID={`review-reject-${item.id}`}
              title={REVIEW_REJECT_LABEL}
              variant="ghost"
              onPress={() => onReject(item)}
            />
          ) : null}
        </View>
      </Card>
    </View>
  );
}
