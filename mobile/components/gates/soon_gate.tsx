import type { ReactNode } from "react";
import { View } from "react-native";
import { Chip } from "@/components/ui/chip";
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
 *
 * The chip itself is `components/ui/chip.tsx` tone `soon` rather than a local
 * pill, so this gate and every other grey chip in the app cannot drift into
 * two slightly different greys meaning the same thing. Layout (`mt-1`,
 * `self-start`) stays here — that is this gate's concern, not the chip's.
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
      <View className="mt-1 self-start">
        <Chip testID="soon-chip" label="Soon" tone="soon" />
      </View>
    </View>
  );
}
