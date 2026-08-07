import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { isShipped } from "@/constants/shipped_features";
import type { FeatureKey } from "@/constants/shipped_features";

/**
 * Phased-rollout gate — docs/11-mobile-app-design-prompt.md "TWO GATING STATES",
 * state 1 ("Soon"). A "soon" feature is designed but not yet built in this
 * release phase: content stays visible but renders desaturated and
 * non-interactive, captioned with a neutral-grey "Soon" chip, so users can see
 * the roadmap without mistaking it for a paid-tier lock. PlusGate is the other
 * state and is deliberately colored the opposite way (brand green, not grey) —
 * the two must never be visually confused.
 *
 * `SHIPPED_FEATURES` (constants/shipped_features.ts) is the single per-build
 * switch this gate consults; it never re-implements rollout logic itself.
 */
export function SoonGate({
  feature,
  children,
}: {
  feature: FeatureKey;
  children: ReactNode;
}) {
  if (isShipped(feature)) {
    return <>{children}</>;
  }

  return (
    <View>
      <View pointerEvents="none" className="opacity-40">
        {children}
      </View>
      <View
        testID="soon-chip"
        className="mt-1 self-start rounded-full bg-fg-2 px-2 py-0.5 dark:bg-fg-2-dark"
      >
        <Text className="text-xs font-semibold text-surface dark:text-surface-dark">
          Soon
        </Text>
      </View>
    </View>
  );
}
