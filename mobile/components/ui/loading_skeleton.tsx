// components/ui/loading_skeleton.tsx — task-5-brief.md.
//
// Placeholder content for a screen that has not resolved yet, replacing the
// blank `<View className="flex-1 bg-bg dark:bg-bg-dark" />` every `*-loading`
// testID used to return — a blank screen with nothing on it to say the app is
// working. `rows` grey bars stand in for whatever the loaded screen actually
// shows; the caller picks how many, because a detail screen's handful of
// fields is not a list's dozen rows.
//
// STATIC, DELIBERATELY (task-5-brief.md Step 3: "Do not animate the skeleton
// in this task"). A shimmer is motion, and motion — including the existing
// "Remove animations" reduced-motion handling `components/ui/brand_mark.tsx`
// already reads via `AccessibilityInfo` — lands in Task 7's device pass. A
// static skeleton has nothing to gate behind that setting and is still a
// strict improvement over the blank view it replaces.
//
// ONE ACCESSIBLE ANNOUNCEMENT, NOT `rows` OF THEM. `accessible` collapses the
// whole group into a single stop for a screen reader, so it says "Loading"
// once — without it, TalkBack would read every bar in turn as an empty,
// unlabelled row.
import { View } from "react-native";

export type LoadingSkeletonProps = {
  /** How many placeholder bars to draw. */
  rows: number;
  testID?: string;
};

/**
 * Alternates a full-width bar with a shorter one so the group reads as
 * text-shaped placeholder content rather than a stack of identical grey
 * rectangles — the same visual idea every other skeleton-loader convention
 * uses, applied with the app's own tokens instead of a borrowed component.
 */
const ROW_WIDTH_CLASS = ["w-full", "w-4/5"] as const;

export function LoadingSkeleton({ rows, testID }: LoadingSkeletonProps) {
  return (
    <View testID={testID} accessible accessibilityLabel="Loading" className="gap-3 p-4">
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          testID={testID === undefined ? undefined : `${testID}-row-${index}`}
          className={`h-4 rounded-md bg-chip dark:bg-chip-dark ${ROW_WIDTH_CLASS[index % ROW_WIDTH_CLASS.length]}`}
        />
      ))}
    </View>
  );
}
