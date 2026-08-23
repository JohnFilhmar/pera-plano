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
import { ReviewCard } from "@/components/review/review_card";
import { registerIcon } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty_state";
import { useReviewAction, type ReviewAction } from "@/hooks/mutations/use_review_action";
import { useCategories } from "@/hooks/queries/use_categories";
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
function primaryActionFor(item: ReviewQueueItem): ReviewAction | "correct" {
  switch (item.kind) {
    case "low-confidence":
      return { kind: "confirm", itemId: item.id };
    case "possible-duplicate":
      return { kind: "dismiss", itemId: item.id };
    case "ambiguous-transfer":
      return { kind: "confirm-transfer", itemId: item.id };
    case "unknown-provider":
      return "correct";
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

  function dispatch(action: ReviewAction | "correct", item: ReviewQueueItem): void {
    if (action === "correct") {
      setCorrecting(item.id);
      return;
    }
    triage.mutate(action);
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
        <View testID="review-queue-loading" className="flex-1" />
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
                  onPrimary={(item) => dispatch(primaryActionFor(item), item)}
                  onSecondary={(item) => dispatch(secondaryActionFor(item), item)}
                  onReject={
                    rejectAction === null ? undefined : (item) => dispatch(rejectAction, item)
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
