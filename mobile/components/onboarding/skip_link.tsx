// components/onboarding/skip_link.tsx — the one control that makes rule 1
// ("every step is skippable... skipping never blocks and never dead-ends") a
// real, tappable affordance rather than a policy statement (m3c-onboarding-
// client plan Task 1). Purely presentational, the same split
// device_lock_explainer.tsx uses: the caller owns what "skip" means for a
// given step (in practice, `nextStep(step)`) and this component only renders
// the tap target and forwards the press.
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
      className="items-center py-3"
    >
      <Text className="text-sm font-medium text-fg-2 dark:text-fg-2-dark">{label}</Text>
    </Pressable>
  );
}
