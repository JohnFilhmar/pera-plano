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
import { Pressable, ScrollView, Text, View } from "react-native";

import { ReviewCard } from "@/components/review/review_card";
import { registerIcon } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty_state";
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

export default function ReviewQueueScreen() {
  const router = useRouter();

  const { data: items } = useReviewQueue();
  const { data: wallets } = useWallets();
  const { data: categories } = useCategories();
  const { data: ruleset } = useRuleset();

  const ordered = items === undefined ? undefined : sortOldestFirst(items);

  return (
    <View testID="review-queue-screen" className="flex-1 bg-bg dark:bg-bg-dark">
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
        <Text className="text-xl font-semibold text-fg dark:text-fg-dark">
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
            {ordered.map((entry) => (
              <ReviewCard
                key={entry.id}
                item={entry}
                wallets={wallets}
                categories={categories}
                providers={ruleset?.providers}
                // m1c Task 10 passes the handlers. Until it does, every pair
                // renders DISABLED rather than live-but-inert — see
                // review_card.tsx's header for why a dead tap on a money
                // decision is the one affordance worth withholding.
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
