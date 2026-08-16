// components/onboarding/step_progress.tsx — the dot row onboarding_frame.tsx
// mounts (m3c-onboarding-client plan Task 1). One dot per ONBOARDING_STEPS
// entry, filled from the start through `current` inclusive -- a plain
// filled-count, not a fraction or a percentage bar: the flow's steps are
// unevenly weighted (a whole permission grant next to a single settings
// screen), and a filled-count only ever claims "this many are behind you",
// which stays true regardless of how long any one of them takes.
import { View } from "react-native";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/onboarding/onboarding_state";

export function StepProgress({ current }: { current: OnboardingStep }) {
  const currentIndex = ONBOARDING_STEPS.indexOf(current);

  return (
    <View
      testID="onboarding-step-progress"
      accessibilityRole="progressbar"
      className="flex-row items-center justify-center gap-2"
    >
      {ONBOARDING_STEPS.map((step, index) => (
        <View
          key={step}
          testID={`onboarding-step-dot-${step}`}
          className={`h-2 w-2 rounded-full ${
            index <= currentIndex
              ? "bg-brand dark:bg-brand-dark"
              : "bg-brand-soft dark:bg-brand-soft-dark"
          }`}
        />
      ))}
    </View>
  );
}
