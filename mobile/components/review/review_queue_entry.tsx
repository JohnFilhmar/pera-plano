// components/review/review_queue_entry.tsx — the way into the Review Queue
// (docs/04-features/08-review-queue.md §UX states: "The queue lives at the top
// of the Transactions tab").
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
import { ChevronRight, Inbox } from "lucide-react-native";
import { Text, View } from "react-native";

import { registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list_row";

const QueueGlyph = registerIcon(Inbox);
const ChevronGlyph = registerIcon(ChevronRight);

export const REVIEW_QUEUE_ENTRY_TITLE = "Needs your review";

/**
 * How many are waiting, in the queue's own words.
 *
 * "A second look" deliberately echoes the empty state on the queue screen
 * itself ("nothing needs a second look") so the two read as one feature rather
 * than two screens that happen to be linked. Singular and plural are separate
 * because "1 items" is the kind of detail that makes an app feel unfinished at
 * exactly the moment it is asking to be trusted with money.
 */
export function reviewQueueEntrySubtitle(count: number): string {
  return count === 1 ? "1 item needs a second look" : `${count} items need a second look`;
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

  return (
    <View className="px-4 pb-2 pt-3">
      <Card>
        <ListRow
          testID={testID}
          title={REVIEW_QUEUE_ENTRY_TITLE}
          subtitle={reviewQueueEntrySubtitle(count)}
          left={<QueueGlyph size={20} className="text-brand dark:text-brand-dark" />}
          right={<ChevronGlyph size={18} className="text-fg-2 dark:text-fg-2-dark" />}
          onPress={onPress}
        />
      </Card>
    </View>
  );
}
