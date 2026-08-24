// components/onboarding/step_progress.tsx — the dot row onboarding_frame.tsx
// mounts (m3c-onboarding-client plan Task 1). One dot per ONBOARDING_STEPS
// entry, filled from the start through `current` inclusive -- a plain
// filled-count, not a fraction or a percentage bar: the flow's steps are
// unevenly weighted (a whole permission grant next to a single settings
// screen), and a filled-count only ever claims "this many are behind you",
// which stays true regardless of how long any one of them takes.
//
// RESTYLE (mobile-ui-revamp Part 3 Task 6): the design's dot row draws the
// CURRENT step as a short pill rather than a same-size dot, so "where am I"
// reads at a glance instead of requiring a colour comparison across nine
// small circles. Steps already passed stay plain filled dots; steps still
// ahead stay the soft, unfilled tone. The fill rule itself -- everything
// through `current` inclusive is "brand" -- is unchanged; only the shape of
// the one dot AT `current` changed, and every `onboarding-step-dot-${step}`
// testID stays on the same step it always named.
import { View } from "react-native";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/onboarding/onboarding_state";

export function StepProgress({ current }: { current: OnboardingStep }) {
  const currentIndex = ONBOARDING_STEPS.indexOf(current);

  return (
    <View
      testID="onboarding-step-progress"
      accessibilityRole="progressbar"
      className="flex-row items-center justify-center gap-1.5"
    >
      {ONBOARDING_STEPS.map((step, index) => (
        <View
          key={step}
          testID={`onboarding-step-dot-${step}`}
          className={`h-2 rounded-full ${index === currentIndex ? "w-5" : "w-2"} ${
            index <= currentIndex
              ? "bg-brand dark:bg-brand-dark"
              : "bg-brand-soft dark:bg-brand-soft-dark"
          }`}
        />
      ))}
    </View>
  );
}
