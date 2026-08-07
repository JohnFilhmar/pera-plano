import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Lock } from "lucide-react-native";
import { cssInterop } from "nativewind";
import { getTier } from "@/lib/entitlements";
import { UpgradeSheet } from "./upgrade_sheet";
import type { PlusCapability } from "./upgrade_sheet";

// Lucide icons ship as plain SVG components and ignore `className` until they
// are registered with cssInterop; `nativeStyleToProp` routes the resolved
// `color` style back onto the `color` prop lucide actually reads.
cssInterop(Lock, {
  className: { target: "style", nativeStyleToProp: { color: true } },
});

/**
 * Paid-tier gate — docs/11-mobile-app-design-prompt.md "TWO GATING STATES",
 * state 2 ("Plus"). A gated capability is fully built; content renders in
 * normal colors (never desaturated — that would read as SoonGate's "not built
 * yet," which is a different promise) with a brand-green "Plus" badge and a
 * lock glyph. Pressing anywhere in the gated area intercepts the press and
 * opens the upgrade sheet instead of running the capability's own action.
 *
 * Consults `lib/entitlements.ts` — the only place in the app that knows about
 * tiers — and never re-implements tier logic here.
 */
export function PlusGate({
  capability,
  children,
}: {
  capability: PlusCapability;
  children: ReactNode;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  if (getTier() === "plus") {
    return <>{children}</>;
  }

  return (
    <>
      <Pressable
        testID="plus-gate"
        onPress={() => setSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Requires PeraPlano Plus — tap to see what's included"
      >
        <View pointerEvents="none">{children}</View>
        <View
          testID="plus-badge"
          className="mt-1 flex-row items-center gap-1 self-start rounded-full bg-brand px-2 py-0.5 dark:bg-brand-dark"
        >
          <Lock size={12} className="text-surface dark:text-surface-dark" />
          <Text className="text-xs font-semibold text-surface dark:text-surface-dark">
            Plus
          </Text>
        </View>
      </Pressable>
      <UpgradeSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        capability={capability}
      />
    </>
  );
}
