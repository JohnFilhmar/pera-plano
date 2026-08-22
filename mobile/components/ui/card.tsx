// components/ui/card.tsx — m1c plan Task 2.
//
// The surface every other primitive sits on. Cards are the app's unit of
// content (docs/11: "calm, trustworthy, roomy cards with soft corners"), so the
// radius and padding chosen here become the rhythm of every screen in M1c–M3.
import type { ReactNode } from "react";
import { View } from "react-native";

export type CardVariant = "default" | "flat";

export type CardProps = {
  variant?: CardVariant;
  children: ReactNode;
  testID?: string;
};

/**
 * `default` is a drop shadow in light and a HAIRLINE in dark. A shadow on
 * `bg-dark` #0B1210 is invisible — there is no lighter ground for it to fall
 * on — so dark mode separates a card from the page with a 1px `line-dark`
 * edge instead. The design's own token block does the same thing: its `--shd`
 * is `0 1px 3px rgba(16,32,26,.07)` in light and `0 0 0 1px rgba(255,255,255,.04)`
 * in dark, which is a border written as a shadow.
 *
 * `flat` is the same card with both removed — for a card nested inside another
 * card or a sheet, where a second elevation reads as a bug rather than depth.
 * It is deliberately NOT a different colour: two card colours would compete
 * with the tone system Chip already owns.
 */
const VARIANT_CLASS: Record<CardVariant, string> = {
  default: "shadow-sm dark:border dark:border-line-dark",
  flat: "",
};

export function Card({ variant = "default", children, testID }: CardProps) {
  return (
    <View
      testID={testID}
      className={`rounded-2xl bg-surface p-4 dark:bg-surface-dark ${VARIANT_CLASS[variant]}`.trim()}
    >
      {children}
    </View>
  );
}
