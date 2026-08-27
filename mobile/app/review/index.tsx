// app/review/index.tsx — the Review Queue (m1c plan Task 9;
// docs/04-features/08-review-queue.md).
//
// THE PRESSURE VALVE OF THE INGEST PIPELINE. Everything the pipeline could not
// commit with confidence waits here for a one-or-two-tap human decision, and the
// alternative to this screen is not "fewer cards" — it is the gate guessing, and
// wrong rows landing silently in a ledger the user has no reason to doubt (top
// risk 4).
//
// TWO FAILURE MODES OUTRANK EVERYTHING VISUAL, AND BOTH ARE STRUCTURAL:
//
//   A CARD WITH NO EXPLANATION trains the user to tap through without reading.
//   The queue then still clears, still shows zero, and has become a rubber
//   stamp — the same wrong data as a lax gate, with a confirmation attached.
//   `review_card.tsx` is where that is prevented; this screen's part is simply
//   never rendering a card any other way.
//
//   A QUEUE THAT GROWS stops being triage and becomes a second inbox nobody
//   opens. That is why the order here is OLDEST FIRST and not negotiable: a
//   newest-first queue guarantees that its oldest item is the one nobody ever
//   reaches, sinking a row with every capture until it expires unread at 30 days
//   and is discarded without ever having been seen.
//
// THIN BY DESIGN. Grouping, copy and per-kind layout live in the components; the
// screen resolves the four collections its cards need and orders the list.
// Global Constraints: hooks only, no repository import, no SQL.
import { ChevronLeft } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CorrectSheet } from "@/components/review/correct_sheet";
import { loanCandidates, ReviewCard, type AutofillCommit } from "@/components/review/review_card";
import { registerIcon } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useReviewAction, type ReviewAction } from "@/hooks/mutations/use_review_action";
import { useCategories } from "@/hooks/queries/use_categories";
import { useRawCapture } from "@/hooks/queries/use_raw_capture";
import { useReviewQueue } from "@/hooks/queries/use_review_queue";
import { useRuleset } from "@/hooks/queries/use_ruleset";
import { useWallets } from "@/hooks/queries/use_wallets";
import type { ReviewQueueItem } from "@/types/domain";

const BackGlyph = registerIcon(ChevronLeft);

export const REVIEW_QUEUE_TITLE = "Review queue";

/**
 * Rule 6's empty state, in the SPEC's words.
 *
 * docs/04-features/08-review-queue.md §UX states writes it with the full stop —
 * `"All caught up."` — where the m1c plan drops it; Global Constraints give the
 * spec the tie. The same row calls it a reward: "absence of work is the reward".
 *
 * So this is the one empty state in the app that is allowed to feel good, and it
 * keeps the paper-airplane mark (`EmptyState`'s default) rather than the spec's
 * bare line — the spec's "no empty-state artwork" clause is explicitly scoped to
 * *inside the ledger*, where the queue appears as a collapsed row, not to this
 * screen, which a user reached by asking for it and should not find blank.
 *
 * There is NO ACTION BUTTON. docs/06-information-architecture.md §5: empty
 * states are "calm, not salesy". There is also nothing to offer — the queue
 * fills by itself or not at all.
 */
export const REVIEW_EMPTY_TITLE = "All caught up.";
export const REVIEW_EMPTY_BODY =
  "PeraPlano only asks when it isn't sure. Right now, nothing needs a second look.";

/**
 * Oldest first (rule 2), sorted HERE rather than trusted from the caller.
 *
 * `listOpen` already returns `ORDER BY created_at ASC`, so relying on it would
 * pass every test written against the repository's output — and silently invert
 * the queue the first time anything else feeds this list: a cached array
 * restored by the persister, a client-side filter, an optimistic insert after a
 * Task 10 resolution. The cost of being wrong is invisible (nothing throws; the
 * oldest item just quietly rots at the bottom until it expires), which is
 * exactly the kind of bug worth three lines of defence.
 *
 * The id breaks a `createdAt` tie so the order is stable: `startIngest` drains
 * up to 500 buffered captures in one pass and several can be enqueued within the
 * same millisecond, and an unstable sort there would reshuffle the visible queue
 * on every refetch under the user's thumb.
 */
export function sortOldestFirst(items: readonly ReviewQueueItem[]): ReviewQueueItem[] {
  return [...items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * What the PRIMARY button on each kind of card actually does (rule 4's pairs, in
 * the spec's wording — see `REVIEW_ACTIONS`).
 *
 *   "Looks right"                  → commit exactly what was proposed.
 *   "Same transaction"             → discard the HELD twin. The DedupeGate never
 *                                    committed it, so there is nothing to delete
 *                                    and the committed original is untouched
 *                                    (rule 10). `mergeDuplicate` is the ledger's
 *                                    merge, for two rows that are both already
 *                                    committed.
 *   "It's a transfer"              → commit the queued leg AND pair it, in one
 *                                    write; a commit that failed to pair would
 *                                    leave an internal movement inflating spend.
 *   "This is a money notification" → open the assisted form, which is the only
 *                                    way the missing amount and wallet can be
 *                                    supplied.
 */
function primaryActionFor(item: ReviewQueueItem): ReviewAction | "correct" | null {
  switch (item.kind) {
    case "low-confidence":
      return { kind: "confirm", itemId: item.id };
    case "possible-duplicate":
      return { kind: "dismiss", itemId: item.id };
    case "ambiguous-transfer":
      return { kind: "confirm-transfer", itemId: item.id };
    case "unknown-provider":
      return "correct";
    case "loan-match": {
      // `null` WHEN THERE IS A CHOICE TO MAKE — loans rule 9: "If two or more
      // open loans are plausible for one Transaction, it is always a suggestion
      // listing the candidates — never an auto-match." Returning the
      // top-scoring loan here would make the primary button an auto-match
      // wearing a confirmation: one tap, no statement of which loan, and a
      // balance the user has no reason to go back and check.
      //
      // `null` reaches `ReviewCard` as an ABSENT `onPrimary`, which that file's
      // own rule renders as disabled-but-visible — so the pair still shows what
      // the outcomes are, and `LoanMatchBody` renders the per-loan buttons that
      // actually pick one.
      const candidates = loanCandidates(item);
      if (candidates.length !== 1) return null;
      return { kind: "confirm-loan-match", itemId: item.id, loanId: candidates[0].loanId };
    }
    case "one-sided-transfer":
      // `null` FOR THE SAME REASON `loan-match` RETURNS IT ABOVE — the choice
      // (which wallet the other leg belongs to) is the card's to make, not a
      // single answer this function could stand for. Unlike `loan-match`
      // there is no "exactly one candidate" shortcut either: every unarchived
      // wallet is a candidate, and picking one for the user would mint a
      // ledger row on an account they never named. Task 12's card dispatches
      // the real action through `onChooseTransferWallet` once a wallet is
      // chosen; this function is never the path for it.
      return null;
    case "wallet-kind-unclear":
      // "Money I have" — the user confirming the assumption the app has been
      // running on since this wallet was created. It PINS rather than merely
      // agreeing, which is why it is a real action and not a dismissal: a
      // wallet its owner has vouched for must not be flipped later by a run
      // of odd notifications.
      return { kind: "answer-wallet-kind", itemId: item.id, owed: false };
  }
}

/**
 * And the SECONDARY.
 *
 *   "Correct"        → the form. Rule 5: the only action that opens one.
 *   "Different"      → commit the held twin as its own Transaction. Two genuine
 *                      ₱1,250.00 purchases minutes apart are a real thing, and
 *                      the gate holding the second one was a question.
 *   "Not a transfer" → commit the queued leg unpaired; both legs then count
 *                      normally, which is what "not a transfer" means.
 *   "Not money"      → discard the capture. NOT the mute: spec §"unknown
 *                      provider" step 5 offers "always ignore notifications like
 *                      this" only after the SECOND dismissal of the same source,
 *                      and creating an ignore rule on the first would silence an
 *                      app on one tap the user cannot see the consequence of.
 */
function secondaryActionFor(item: ReviewQueueItem): ReviewAction | "correct" {
  switch (item.kind) {
    case "low-confidence":
      return "correct";
    case "possible-duplicate":
    case "ambiguous-transfer":
      return { kind: "confirm", itemId: item.id };
    case "unknown-provider":
      return { kind: "dismiss", itemId: item.id };
    case "loan-match":
      // "Not a loan payment" — and NOTHING ELSE (loans rule 10: "Rejecting a
      // suggestion never creates a negative UserRule automatically"). The
      // transaction stays exactly where it is, committed and counted; only the
      // question goes away. That rule's follow-up — a one-time "stop suggesting
      // this merchant for this loan?" after repeated rejections — needs a
      // rejection count per merchant-loan pair that nothing stores yet, and
      // writing an `ignore` rule here instead would silence a real repayment
      // the user only meant to skip once.
      return { kind: "dismiss", itemId: item.id };
    case "one-sided-transfer":
      // "Not a transfer" — commit the captured leg UNPAIRED, exactly what
      // `ambiguous-transfer`'s own secondary does above, and for the same
      // reason: the money already parsed and moved, so the honest way to
      // decline "is this half of a transfer?" is to let it count normally on
      // its own, not to discard it. `confirm` with no counterpart is that.
      return { kind: "confirm", itemId: item.id };
    case "wallet-kind-unclear":
      // "Money I owe" — the ONLY secondary in this queue that is not a
      // rejection, a correction or a way out. It is the other half of a
      // two-answer question, and it is exactly as final as the primary: both
      // pin the wallet. Rendering it in the secondary slot is a layout
      // decision, not a statement that this answer is the lesser one.
      return { kind: "answer-wallet-kind", itemId: item.id, owed: true };
  }
}

/**
 * The reject affordance (task 4a) — `null` for a kind whose own pair already
 * offers a way out, or that must never offer one at all.
 *
 *   `low-confidence`     → the only kind with no rejection anywhere in its
 *                          pair ("Looks right" / "Correct" both keep the
 *                          card's proposal alive), and the one kind that can
 *                          be pure noise: a failed parse, an unmapped wallet,
 *                          a foreign currency PeraPlano cannot read at all.
 *                          Ten such rows sat in the owner's queue with no way
 *                          to clear them — this is that way.
 *   `possible-duplicate` → its PRIMARY ("Same transaction") already discards
 *                          the held twin; a second "Not money" button would
 *                          be a second way to do what one button already
 *                          does.
 *   `unknown-provider`   → its SECONDARY IS "Not money" (`REVIEW_ACTIONS`) —
 *                          the exact outcome this function exists to add
 *                          elsewhere is already that card's own pair.
 *   `ambiguous-transfer` → real money moved and the amount parsed; the open
 *                          question is HOW to record it (as a transfer or
 *                          not), never WHETHER. Dismissing would lose a real
 *                          transaction, so this kind deliberately gets none —
 *                          not an oversight, the one case reject must refuse.
 *   `loan-match`         → its SECONDARY is the rejection ("Not a loan
 *                          payment", `REVIEW_ACTIONS`), exactly as
 *                          `unknown-provider`'s is. A third button repeating
 *                          it would ask the user to work out which of two
 *                          identical outcomes they meant.
 *   `one-sided-transfer` → same call as `ambiguous-transfer`, and for the
 *                          identical reason: real money moved and parsed, so
 *                          the open question is HOW to record it (paired or
 *                          not), never WHETHER. Its own secondary ("Not a
 *                          transfer") is already the honest way to decline.
 */
function rejectActionFor(item: ReviewQueueItem): ReviewAction | null {
  return item.kind === "low-confidence" ? { kind: "dismiss", itemId: item.id } : null;
}

export default function ReviewQueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: items } = useReviewQueue();
  const { data: wallets } = useWallets();
  const { data: categories } = useCategories();
  const { data: ruleset } = useRuleset();
  const triage = useReviewAction();

  // The item whose correction form is open, held by ID rather than by object so
  // a refetch that replaces the array cannot leave a stale copy on screen.
  const [correcting, setCorrecting] = useState<string | null>(null);

  const ordered = items === undefined ? undefined : sortOldestFirst(items);
  const correctingItem = ordered?.find((entry) => entry.id === correcting) ?? null;
  // The notification behind the open sheet, so its fields can be seeded from
  // the text rather than opened blank (2026-08-28). The same query key the
  // card already read, so this resolves from cache rather than hitting the
  // database a second time; `null` disables it when no sheet is open.
  const { data: correctingCapture } = useRawCapture(correctingItem?.rawNotificationId ?? null);

  function dispatch(action: ReviewAction | "correct", item: ReviewQueueItem): void {
    if (action === "correct") {
      setCorrecting(item.id);
      return;
    }
    triage.mutate(action);
  }

  /**
   * The one-tap commit of an unknown provider's notification, from the fields
   * `candidates.ts` read out of its text.
   *
   * SAME MUTATION AS THE SHEET'S SAVE, deliberately: this path must not be able
   * to write a Transaction the sheet could not, so it goes through
   * `correctItem` and its `proposalFrom` guards rather than a shortcut of its
   * own.
   *
   * `createRule: false`, AND THAT IS THE WHOLE POINT OF SPELLING IT OUT.
   * `CorrectionPatch` defaults it to `true` (spec rule 12: "every correction
   * creates a rule unless the user opts out"), which is right for a correction
   * the user typed — they said something specific. Here they agreed to a
   * sentence on a button. Teaching the pipeline to route every future
   * notification from this app on the strength of one glance is exactly the
   * "the queue teaching the pipeline things nobody asked it to learn" that
   * `correct_sheet.tsx` refuses to do; a user who wants the rule can open the
   * sheet through "Change the details" and tick the box that says so.
   */
  function recordAutofill(item: ReviewQueueItem, proposal: AutofillCommit): void {
    triage.mutate({
      kind: "correct",
      itemId: item.id,
      patch: {
        amount: proposal.amount,
        direction: proposal.direction,
        walletId: proposal.walletId,
        ...(proposal.merchant === null ? {} : { merchant: proposal.merchant }),
        createRule: false,
      },
    });
  }

  return (
    // Insets, not a header: this screen runs `headerShown: false` and is NOT
    // inside the tab navigator, so nothing above it clears either system bar —
    // its own back button would sit under the status bar and the last review
    // card under Android's navigation bar (app.json `edgeToEdgeEnabled`). The
    // inner `pt-4`/`pb-8` stay as design padding on top of the system bars,
    // which only works because the insets go on this padding-free outer View:
    // a `style` prop replaces, rather than adds to, what `className` compiles.
    <View
      testID="review-queue-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center gap-2 px-2 pb-2 pt-4">
        <Pressable
          testID="review-queue-back"
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <BackGlyph size={24} className="text-fg dark:text-fg-dark" />
        </Pressable>
        {/* `text-title font-bold` (task-4b) — the app's own header scale
            (EmptyState's title uses the same pair), replacing the unscaled
            `text-xl font-semibold` this shipped with.

            THE TEXT ITSELF STAYS "Review queue", not the brief's "Needs
            review" — docs/04-features/08-review-queue.md's own H1 is
            "# Review Queue", and this constant already matched it before
            this task touched the file. Nothing pins the string either way
            (no test in this suite or `review_queue.test.tsx` reads
            `REVIEW_QUEUE_TITLE`), so this is a copy decision, not a test
            constraint — and where a restyle's suggested label and the
            feature's own spec disagree, the spec wins. */}
        <Text className="text-title font-bold text-fg dark:text-fg-dark">
          {REVIEW_QUEUE_TITLE}
        </Text>
      </View>

      {ordered === undefined ? (
        // Nothing at all until the first read resolves. Flashing "All caught up."
        // on every cold start would congratulate the user for work they have not
        // done, and the correction a frame later reads as data appearing from
        // nowhere.
        <View testID="review-queue-loading" className="flex-1">
          <LoadingSkeleton rows={5} />
        </View>
      ) : ordered.length === 0 ? (
        <View className="flex-1 justify-center">
          <EmptyState
            testID="review-queue-empty"
            title={REVIEW_EMPTY_TITLE}
            body={REVIEW_EMPTY_BODY}
          />
        </View>
      ) : (
        <ScrollView testID="review-queue-list">
          <View className="pb-8 pt-1">
            {ordered.map((entry) => {
              // Resolved once per entry rather than inline in `onReject`
              // below: the prop must be `undefined` (not a handler that
              // happens to no-op) whenever this kind has none, because
              // review_card.tsx renders NOTHING for an absent `onReject` —
              // see its header on why that is the opposite of the pair's
              // "absent means disabled" rule.
              const rejectAction = rejectActionFor(entry);
              // Same treatment, one kind further: `null` here means this card
              // has no single answer its primary could stand for (a
              // `loan-match` listing two or more loans), so the handler is
              // WITHHELD rather than supplied-and-inert — which is what makes
              // the button render disabled instead of picking a loan silently.
              const primaryAction = primaryActionFor(entry);
              return (
                <ReviewCard
                  key={entry.id}
                  item={entry}
                  wallets={wallets}
                  categories={categories}
                  providers={ruleset?.providers}
                  // Supplying the handlers is what lights the pair up:
                  // without them the card renders DISABLED rather than
                  // live-but-inert — see review_card.tsx's header on why a
                  // dead tap on a money decision is the one affordance worth
                  // withholding.
                  onPrimary={
                    primaryAction === null ? undefined : (item) => dispatch(primaryAction, item)
                  }
                  onSecondary={(item) => dispatch(secondaryActionFor(item), item)}
                  onReject={
                    rejectAction === null ? undefined : (item) => dispatch(rejectAction, item)
                  }
                  onChooseLoan={(item, loanId) =>
                    triage.mutate({ kind: "confirm-loan-match", itemId: item.id, loanId })
                  }
                  onRecordAutofill={recordAutofill}
                  // The escape hatch the card renders beside a one-tap
                  // record: the same sheet "This is a money notification"
                  // used to open, still one tap away for anyone who can see
                  // the app read the wrong number.
                  onEditDetails={(item) => setCorrecting(item.id)}
                  onChooseTransferWallet={(item, walletId, feeAmount) =>
                    triage.mutate({
                      kind: "confirm-one-sided-transfer",
                      itemId: item.id,
                      counterpartWalletId: walletId,
                      feeAmount,
                    })
                  }
                />
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* ONE SHEET FOR THE WHOLE LIST, not one per card. Only one correction can
          be open at a time, and mounting a modal behind every row would put the
          queue's whole form state in memory for a screen that shows a card at a
          time. */}
      {correctingItem === null ? null : (
        <CorrectSheet
          visible
          item={correctingItem}
          wallets={wallets ?? []}
          categories={categories ?? []}
          capture={correctingCapture}
          onDismiss={() => setCorrecting(null)}
          onSubmit={(patch) => {
            setCorrecting(null);
            triage.mutate({ kind: "correct", itemId: correctingItem.id, patch });
          }}
        />
      )}
    </View>
  );
}
