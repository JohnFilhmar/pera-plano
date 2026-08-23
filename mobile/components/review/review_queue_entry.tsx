// components/review/review_queue_entry.tsx — the way into the Review Queue
// (docs/04-features/08-review-queue.md §UX states: "The queue lives at the top
// of the Transactions tab"). Restyled by task-4-brief.md (mobile UI revamp
// Part 2, Task 4) into the design's full-width soft-brand banner.
//
// THIS ROW IS WHY THE REVIEW QUEUE IS REACHABLE AT ALL. m1c Task 9 shipped
// app/review/index.tsx and the tab badge; nothing linked to the screen, and
// neither Task 9's nor Task 10's file list touches the Transactions tab. Without
// this row the entire feature — four card kinds, the correction sheet, every
// rule the pipeline learns — is code no user can reach.
//
// IT IS ABSENT AT ZERO, and that is the whole design of it. The spec calls an
// empty queue a REWARD ("absence of work is the reward"), and forbids
// empty-state artwork inside the ledger outright. A row that is always there is
// a row the user scrolls past without reading, which makes it useless on the one
// day it says something. Same reasoning as the tab badge next to it
// (review_badge.tsx), and deliberately the same rule: `undefined` (the count is
// still loading) renders nothing either, so a cold start never flashes a queue
// that is not there.
//
// PRESENTATIONAL. It is handed a count and a handler; the screen owns the hook
// and the navigation.
import { ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { registerIcon } from "@/components/ui/button";

const ChevronGlyph = registerIcon(ChevronRight);

/**
 * How many are waiting, in the banner's own words.
 *
 * Singular and plural are separate because "1 need a quick check" is the kind
 * of grammar slip that makes an app feel unfinished at exactly the moment it
 * is asking to be trusted with money.
 */
export function reviewQueueEntrySubtitle(count: number): string {
  return count === 1 ? "1 needs a quick check" : `${count} need a quick check`;
}

export type ReviewQueueEntryProps = {
  /** `undefined` while the first count is in flight; `0` when the queue is clear. */
  count: number | undefined;
  onPress: () => void;
  testID?: string;
};

export function ReviewQueueEntry({
  count,
  onPress,
  testID = "review-queue-entry",
}: ReviewQueueEntryProps) {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return null;

  const label = reviewQueueEntrySubtitle(count);

  return (
    <View className="px-4 pb-2 pt-3">
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        className="min-h-[44px] flex-row items-center gap-2 rounded-xl bg-brand-soft px-4 py-3 dark:bg-brand-soft-dark"
      >
        <Text className="flex-1 text-row font-semibold text-brand dark:text-brand-dark">
          {label}
        </Text>
        <ChevronGlyph size={16} className="text-brand dark:text-brand-dark" />
      </Pressable>
    </View>
  );
}
