// components/onboarding/skip_link.tsx — the one control that makes rule 1
// ("every step is skippable... skipping never blocks and never dead-ends") a
// real, tappable affordance rather than a policy statement (m3c-onboarding-
// client plan Task 1). Purely presentational, the same split
// device_lock_explainer.tsx uses: the caller owns what "skip" means for a
// given step (in practice, `nextStep(step)`) and this component only renders
// the tap target and forwards the press.
//
// LIVES IN THE FRAME'S HEADER NOW (mobile-ui-revamp Part 3 Task 6), beside
// the back chevron, rather than stacked under the primary button in the
// footer — onboarding_frame.tsx's own header explains the trade this makes.
// The testID and the callback contract are exactly what they were; only the
// className changed, to a compact corner action instead of a full-width
// footer row.
import { Pressable, Text } from "react-native";

export function SkipLink({
  onPress,
  label = "Skip for now",
}: {
  onPress: () => void;
  label?: string;
}) {
  return (
    <Pressable
      testID="onboarding-skip-link"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="min-h-[44px] items-center justify-center px-2"
    >
      <Text numberOfLines={1} className="text-row font-semibold text-fg-2 dark:text-fg-2-dark">
        {label}
      </Text>
    </Pressable>
  );
}
