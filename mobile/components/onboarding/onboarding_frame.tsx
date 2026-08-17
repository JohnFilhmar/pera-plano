// components/onboarding/onboarding_frame.tsx — the consistent shell every
// M3c step mounts into (m3c-onboarding-client plan Task 1, rule 2): progress
// dots, a back affordance, a primary action, and the skip link, so a step
// screen only has to supply its own content.
//
// ONE MISSING PROP HIDES ITS AFFORDANCE, RATHER THAN DISABLING IT. `onBack`
// and `onSkip` are both optional: "welcome" has nowhere to go back to (the
// device lock and recovery phrase ahead of it are unskippable and do not
// belong in this flow's own back-stack -- see onboarding_state.ts's header),
// and "done" has nothing left to skip. A visible-but-disabled button would
// imply a choice that is not really there; omitting the prop omits the
// control instead.
//
// SKIP AND PRIMARY ARE BOTH PLAIN CALLBACKS THE CALLER OWNS. This frame does
// not call `nextStep` itself -- it is pure chrome (rule 2's own wording), and
// coupling it to the step-order lib would make every future step screen's
// "back" and "primary" wiring inconsistent with how its "skip" is wired. Each
// step screen (later tasks) wires `onSkip` to `nextStep(step)` the same way
// this file's own test does, which is what actually makes rule 1's "skipping
// never dead-ends" true at runtime.
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react-native";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, registerIcon } from "@/components/ui/button";
import { SkipLink } from "@/components/onboarding/skip_link";
import { StepProgress } from "@/components/onboarding/step_progress";
import type { OnboardingStep } from "@/lib/onboarding/onboarding_state";

const BackGlyph = registerIcon(ChevronLeft);

export type OnboardingFrameProps = {
  step: OnboardingStep;
  title: string;
  children: ReactNode;
  onPrimary: () => void;
  primaryLabel?: string;
  primaryDisabled?: boolean;
  primaryBusy?: boolean;
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
};

export function OnboardingFrame({
  step,
  title,
  children,
  onPrimary,
  primaryLabel = "Continue",
  primaryDisabled = false,
  primaryBusy = false,
  onBack,
  onSkip,
  skipLabel,
}: OnboardingFrameProps) {
  // THE DEFECT THIS FIXES: the primary button sat UNDER Android's navigation
  // bar. app.json sets `edgeToEdgeEnabled`, so this frame's flex column runs
  // edge to edge and its footer's flat `pb-6` (24dp) was all that stood between
  // "Continue" and the ▢ ◁ strip — measured at 126px on a physical A54. The
  // owner's words: onboarding is "tricky on reaching that buried button".
  //
  // THE INSETS GO ON THIS OUTER VIEW, WHICH HAS NO PADDING CLASSES OF ITS OWN.
  // A `style` prop wins over the style NativeWind compiles from `className`, so
  // putting these on the header or footer would REPLACE their `pt-4`/`pb-6`
  // rather than clear the system bar in addition to it. Here the two compose:
  // the system bar's height, then the design padding, then the control.
  //
  // BOTH EDGES, because this frame is also reached before any navigator exists
  // (app/lock.tsx renders the first-run flow directly), so nothing above it has
  // handled the status bar either.
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="onboarding-frame"
      className="flex-1 bg-bg dark:bg-bg-dark"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center gap-2 px-2 pb-2 pt-4">
        {onBack ? (
          <Pressable
            testID="onboarding-back-button"
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            className="min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <BackGlyph size={24} className="text-fg dark:text-fg-dark" />
          </Pressable>
        ) : (
          // Reserves the back button's own width so the progress row stays
          // centered on steps with no back affordance -- a shifting layout
          // across steps would read as broken, not as "this one is first".
          <View className="min-h-[44px] min-w-[44px]" />
        )}
        <View className="flex-1">
          <StepProgress current={step} />
        </View>
        <View className="min-h-[44px] min-w-[44px]" />
      </View>

      <ScrollView
        testID="onboarding-content"
        className="flex-1"
        contentContainerClassName="gap-4 px-6 py-4"
      >
        <Text className="text-2xl font-bold text-fg dark:text-fg-dark">{title}</Text>
        {children}
      </ScrollView>

      <View className="gap-2 px-6 pb-6 pt-2">
        <Button
          testID="onboarding-primary-button"
          title={primaryLabel}
          onPress={onPrimary}
          disabled={primaryDisabled}
          loading={primaryBusy}
        />
        {onSkip ? <SkipLink onPress={onSkip} label={skipLabel} /> : null}
      </View>
    </View>
  );
}
