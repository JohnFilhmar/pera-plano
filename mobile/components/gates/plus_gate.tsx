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
 * The label on an UNLOCKED Plus capability during beta.
 *
 * Why label it at all, when nothing is blocked: the design puts a mint lock
 * badge on nine boards, and until now `getTier() === "plus"` returned bare
 * children, so not one of them had ever rendered in the running app. Shipping
 * the badge only on the `free` path would have shipped the entire Plus visual
 * language as unreachable code.
 *
 * Why this wording and not a plain "PLUS": a badge reading PLUS on a feature
 * that is not locked reads as a bug. This says the true thing — it becomes
 * paid later, it is yours now — so the eventual switch to paid is a change of
 * copy rather than a change of layout across a dozen screens, and beta testers
 * already know which features they were promised.
 */
export const PLUS_BETA_LABEL = "PLUS · free in beta";

/**
 * Paid-tier gate — docs/11-mobile-app-design-prompt.md "TWO GATING STATES",
 * state 2 ("Plus"). A gated capability is fully built; content renders in
 * normal colors (never desaturated — that would read as SoonGate's "not built
 * yet," which is a different promise).
 *
 * TWO badge treatments, not one, so a user can tell "yours" from "not yours"
 * without reading:
 *   - LOCKED (free tier): solid brand fill, on-brand ink, the word "Plus".
 *     Pressing anywhere in the gated area intercepts the press and opens the
 *     upgrade sheet instead of running the capability's own action.
 *   - UNLOCKED (plus tier): soft mint fill, brand-ink text, PLUS_BETA_LABEL.
 *     Purely informational — it sits beside a fully working control, never a
 *     second gate — so unlike the locked branch it must NOT intercept
 *     presses; children render with no wrapping Pressable and no
 *     `pointerEvents="none"`.
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
    return (
      <View>
        {children}
        <View
          testID="plus-badge"
          className="mt-1 flex-row items-center gap-1 self-start rounded-full bg-brand-soft px-2 py-0.5 dark:bg-brand-soft-dark"
        >
          {/*
            Ink is `brand-ink`/`brand-ink-dark`, never the raw `brand` a first
            draft of this badge used. constants/colors.ts's own recorded
            arithmetic has `brand` on a 14%-alpha tint of itself at 3.96:1 —
            under the 4.5:1 AA floor — and this badge's `bg-brand-soft` (the
            opaque mint token, #DCFCE7) only clears `text-brand` at 4.567:1, a
            hair over the floor with no headroom for a future palette tweak.
            `brand-ink` measures 6.49:1 against that same background —
            comfortably clear — which is also the categorical rule
            components/ui/chip.tsx's SOFT_INK table already applies to every
            soft chip in the app: text on a hue's own soft tint reaches for
            that hue's `-ink` token, not the base tone.
          */}
          <Lock size={11} className="text-brand-ink dark:text-brand-ink-dark" />
          <Text className="text-badge font-bold text-brand-ink dark:text-brand-ink-dark">
            {PLUS_BETA_LABEL}
          </Text>
        </View>
      </View>
    );
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
          <Lock size={11} className="text-on-brand dark:text-on-brand-dark" />
          <Text className="text-badge font-bold text-on-brand dark:text-on-brand-dark">
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
