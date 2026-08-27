// components/review/review_filter_bar.tsx — the Review Queue's kind filter.
//
// THIS IS THE "GROUPED TRIAGE" THE BACKLOG STATE ASKS FOR.
// docs/04-features/08-review-queue.md §UX states says a queue over 25 items
// "offers grouped triage (items clustered by source pattern)"; clustering by
// KIND is the version of that this app can actually honour, because kind is a
// column on the row while "source pattern" lives inside an opaque
// `payload_json` the repository is forbidden to interpret. The user-visible
// promise is the same one either way: thirty mixed cards become one answerable
// question at a time — every duplicate, then every unknown app — instead of a
// list that changes its question every card.
//
// ONE KIND AT A TIME, not a multi-select. The whole value of the grouping is
// that the cards below the bar all ask the same thing, so the user answers in a
// rhythm instead of re-reading each card to work out which decision it wants.
// Two kinds selected is just a shorter mixed list. (The repository takes an
// ARRAY of kinds anyway — see `listOpenPage` — so a future multi-select needs
// nothing new below this component.)
//
// A SELECTED CHIP IS ITS OWN REMOVAL AFFORDANCE, exactly as in
// components/transactions/filter_bar.tsx: pressing the selected kind again
// returns to All. There is no separate clear control.
//
// PRESENTATIONAL. Counts arrive as a prop (Global Constraints: no repository
// import inside a component).
import { ScrollView, View } from "react-native";

import { REVIEW_KIND_LABELS, REVIEW_KINDS } from "@/constants/review_kinds";
import { Chip } from "@/components/ui/chip";
import type { ReviewKind } from "@/types/domain";

export type ReviewFilterBarProps = {
  /** Open items per kind. `undefined` while the first count is in flight. */
  counts?: Record<ReviewKind, number>;
  /** The kind currently filtered to, or `null` for the whole queue. */
  selected: ReviewKind | null;
  onChange: (next: ReviewKind | null) => void;
  testID?: string;
};

export function ReviewFilterBar({
  counts,
  selected,
  onChange,
  testID = "review-filter-bar",
}: ReviewFilterBarProps) {
  // A kind with nothing waiting gets no chip: seven chips over a queue of two
  // items is six controls that lead to an empty screen, and the bar's job is to
  // say what is IN the queue, not to enumerate what the pipeline can produce.
  //
  // THE SELECTED KIND IS THE EXCEPTION and keeps its chip at zero. That is the
  // moment the user triages the last duplicate: the chip vanishing under their
  // thumb would drop them into an unexplained empty list with no visible reason
  // and no control to leave it. It stays, reading "Maybe duplicate 0", next to
  // an empty state that says the filter is why.
  const visible = REVIEW_KINDS.filter(
    (kind) => (counts?.[kind] ?? 0) > 0 || kind === selected,
  );
  const total = counts === undefined ? undefined : REVIEW_KINDS.reduce((sum, kind) => sum + counts[kind], 0);

  // Nothing to filter. One chip reading "All 3" next to no alternative is a
  // control that cannot change anything — and it would sit above every
  // single-kind queue, which is the common case on a healthy install.
  if (counts !== undefined && visible.length < 2) return null;

  return (
    <View testID={testID} className="border-b border-fg-2 pb-2 dark:border-fg-2-dark">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2 px-4 py-2"
      >
        <Chip
          testID="review-filter-chip-all"
          label={total === undefined ? "All" : `All ${total}`}
          // `brand`/`neutral` rather than a literal `neutral` selected chip —
          // Chip paints `neutral` + `solid` in the screen's own background
          // colour, so a selected chip would read as LESS filled than its
          // unselected outline siblings (the same call filter_bar.tsx makes,
          // and for the same reason).
          tone={selected === null ? "brand" : "neutral"}
          fill={selected === null ? "solid" : "outline"}
          selected={selected === null}
          onPress={() => onChange(null)}
        />
        {visible.map((kind) => (
          <Chip
            key={kind}
            testID={`review-filter-chip-${kind}`}
            label={`${REVIEW_KIND_LABELS[kind]} ${counts?.[kind] ?? 0}`}
            tone={selected === kind ? "brand" : "neutral"}
            fill={selected === kind ? "solid" : "outline"}
            selected={selected === kind}
            onPress={() => onChange(selected === kind ? null : kind)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
