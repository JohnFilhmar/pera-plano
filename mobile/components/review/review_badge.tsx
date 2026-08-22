// components/review/review_badge.tsx — m1c plan Task 9 rule 1;
// docs/04-features/08-review-queue.md rules 18–19.
//
// THE ZERO CASE IS THE WHOLE COMPONENT. A badge reading "0" is an unread marker
// pointing at nothing, and the spec is explicit that an empty queue is a REWARD
// ("absence of work is the reward" — §UX states). A user who taps a "0" and
// finds an empty screen learns that the badge is noise, and the badge's only job
// is to still be believed on the day it says "3".
//
// THE CAP IS 99+, WHICH IS THE SPEC'S NUMBER AND NOT THE PLAN'S.
// docs/04-features/08-review-queue.md rule 18 ends "Display caps at 99+"; the
// m1c plan's Task 9 rule 1 writes "capped at 9+". Global Constraints settle it —
// "Where this plan and a spec disagree, the spec wins" — and the plan's stated
// reason (a wider label overflows the tab icon) argues against itself, since
// "99+" is three characters and the "10" it was meant to prevent is two.
//
// The substance favours the spec as well. The queue's own backlog rule fires at
// >25 items, and a cap of 9 would render every backlog identically: 26 waiting
// and 260 waiting would both read "9+", hiding exactly the runaway the backlog
// banner exists to surface. 99+ keeps the badge informative right up to the
// point where the number stops being actionable.
import { Text, View } from "react-native";

import { useReviewCount } from "@/hooks/queries/use_review_count";

/** docs/04-features/08-review-queue.md rule 18 — "Display caps at 99+". */
export const REVIEW_BADGE_CAP = 99;

/**
 * The badge text, or `null` when there should be no badge at all.
 *
 * `undefined` is the count still loading and `0` is an empty queue; BOTH render
 * nothing, and they must, because the alternative on a cold start is a "0"
 * flashing onto the tab bar of an app that has nothing to review.
 *
 * A negative count cannot be produced by `countOpen()` — it is a `COUNT(*)` —
 * but it is rejected here anyway rather than rendered as "-1", because a badge
 * is a promise that tapping it leads somewhere.
 */
export function reviewBadgeLabel(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return null;
  return count > REVIEW_BADGE_CAP ? `${REVIEW_BADGE_CAP}+` : String(Math.trunc(count));
}

export type ReviewBadgeProps = {
  /** `undefined` while the first count is in flight. */
  count: number | undefined;
  testID?: string;
};

/**
 * The bubble itself. Presentational — it is handed a number and renders it or
 * nothing.
 *
 * Why red. The design draws this badge red on the Transactions tab. Green in
 * this app means "healthy" — it is the colour of a limit under budget and of
 * a listening wallet. A green count on a tab that means "three things need
 * your attention" says the opposite of what it is for. `on-brand` is still
 * the correct ink: it is the token for ink on a filled control, and
 * `constants/colors.ts` records `on-brand` on `danger` at 4.83:1 and
 * `on-brand-dark` on `danger-dark` at 6.42:1, both clearing AA.
 *
 * This is not a claim that the queue holds errors. An item lands here because
 * the pipeline behaved correctly by refusing to guess — low confidence, an
 * unrecognised provider, a possible duplicate — not because anything broke.
 * `danger` is doing a second job here, "needs your attention", alongside its
 * original one, actions that destroy data (see components/ui/chip.tsx); it is
 * not relabelling this queue as a set of mistakes.
 */
export function ReviewBadge({ count, testID = "review-badge" }: ReviewBadgeProps) {
  const label = reviewBadgeLabel(count);
  if (label === null) return null;

  const items = count === 1 ? "item" : "items";

  return (
    <View
      testID={testID}
      // Absolutely positioned so it rides the tab icon without changing the
      // icon's own layout — a badge that reflowed the tab bar would shift every
      // other tab under a thumb already on its way down.
      className="absolute -right-3 -top-1 min-w-[18px] items-center justify-center rounded-full bg-danger px-1 py-0.5 dark:bg-danger-dark"
      accessibilityLabel={`${label} ${items} waiting for review`}
    >
      <Text className="text-badge font-bold text-on-brand dark:text-on-brand-dark">{label}</Text>
    </View>
  );
}

/**
 * The badge wired to the live count — what the Transactions tab renders.
 *
 * `useReviewCount` is the ONLY polling query in the app (30 s), and this is the
 * reason it polls: the thing that fills the queue is an incoming notification
 * hitting the ingest pipeline in the background, with no user interaction to
 * hang a refetch off. Rule 19's "updates immediately on triage, expiry, or new
 * arrivals" has no other mechanism.
 *
 * Split from `ReviewBadge` so the presentation can be tested without a database
 * and the wiring can be tested with one.
 */
export function ReviewCountBadge({ testID }: { testID?: string }) {
  const { data } = useReviewCount();
  return <ReviewBadge count={data} testID={testID} />;
}
