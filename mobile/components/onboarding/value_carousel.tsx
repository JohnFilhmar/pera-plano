// components/onboarding/value_carousel.tsx — task-3-brief.md.
//
// The swipeable 4-panel art-placeholder carousel how_it_works.tsx renders
// above its existing mechanism copy. Each panel is `ImagePlaceholder`
// (components/ui/image_placeholder.tsx) fed one VALUE_PANELS entry
// (value_panels.ts) -- this file owns only the paging chrome (ScrollView +
// dot row), never any scene content of its own.
//
// PLAIN SCROLLVIEW, NO NEW DEPENDENCY (rule 4). `horizontal` +
// `pagingEnabled` + `showsHorizontalScrollIndicator={false}` is the whole
// carousel mechanism -- no react-native-pager-view, no reanimated-carousel.
//
// PANEL WIDTH IS MEASURED, NEVER HARDCODED. OnboardingFrame's content
// ScrollView applies `px-6` (24dp per side) around every step's children, so
// this carousel's own available width is `useWindowDimensions().width - 48`.
// FRAME_HORIZONTAL_PADDING below is that known 24dp x 2, not a guess at a
// panel size -- and `pagingEnabled` pages by the ScrollView's OWN width, so
// each panel wrapper is sized to exactly this so paging lands on panel
// boundaries.
//
// DOTS, NOT STEPPROGRESS (rule 5). step_progress.tsx tracks the nine-step
// onboarding flow; reusing it here would show the user two progress meters
// that disagree about what "step 2 of 4" means. This dot row only ever
// tracks the carousel's OWN paging position, filled the way StepProgress
// fills its dots but as a single active dot, not a cumulative count -- a
// carousel page is a place, not a milestone already passed.
//
// NESTED SCROLLVIEW FIX (rule 6). This carousel's horizontal ScrollView
// nests inside OnboardingFrame's vertical one. On Android, a nested
// ScrollView needs `nestedScrollEnabled` or the outer vertical scroller can
// claim the drag before the inner horizontal one sees it; iOS scrolls
// nested views without it, so the prop is a harmless no-op there. The fix
// lives here, not in OnboardingFrame, because only this component knows it
// is nested inside a scroller of the same library.
import { useCallback, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { ScrollView, useWindowDimensions, View } from "react-native";

import { ImagePlaceholder } from "@/components/ui/image_placeholder";
import { VALUE_PANELS, type ValuePanel } from "./value_panels";

// OnboardingFrame's `px-6` content padding, both sides (24dp x 2).
const FRAME_HORIZONTAL_PADDING = 48;

export type ValueCarouselProps = {
  /** Defaults to VALUE_PANELS. Injectable so a test can drive a smaller
   * fixture (rule 8) -- that is the entire reason this prop exists. */
  panels?: readonly ValuePanel[];
  testID?: string;
};

export function ValueCarousel({ panels = VALUE_PANELS, testID }: ValueCarouselProps) {
  const { width } = useWindowDimensions();
  const panelWidth = Math.max(width - FRAME_HORIZONTAL_PADDING, 0);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (panelWidth <= 0) return;
      const rawIndex = Math.round(event.nativeEvent.contentOffset.x / panelWidth);
      setActiveIndex(Math.min(Math.max(rawIndex, 0), panels.length - 1));
    },
    [panelWidth, panels.length],
  );

  return (
    <View testID={testID}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        nestedScrollEnabled
        onMomentumScrollEnd={handleMomentumScrollEnd}
        testID="value-carousel-scroll"
      >
        {panels.map((panel, index) => (
          <View key={panel.id} style={{ width: panelWidth }}>
            <ImagePlaceholder
              testID={`value-carousel-panel-${panel.id}`}
              label={panel.label}
              brief={panel.brief}
              index={index + 1}
              of={panels.length}
            />
          </View>
        ))}
      </ScrollView>
      <View
        testID="value-carousel-dots"
        accessibilityRole="progressbar"
        className="flex-row items-center justify-center gap-2 pt-2"
      >
        {panels.map((panel, index) => (
          <View
            key={panel.id}
            testID={`value-carousel-dot-${panel.id}`}
            className={
              index === activeIndex
                ? "h-2 w-2 rounded-full bg-brand dark:bg-brand-dark"
                : "h-2 w-2 rounded-full bg-brand-soft dark:bg-brand-soft-dark"
            }
          />
        ))}
      </View>
    </View>
  );
}
