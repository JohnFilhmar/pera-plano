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
 * `flat` is the same card with the shadow removed — for cards nested inside
 * another card or inside a sheet, where a second elevation reads as a bug
 * rather than as depth. It is deliberately NOT a different colour: two card
 * colours would compete with the tone system Chip already owns.
 */
const VARIANT_CLASS: Record<CardVariant, string> = {
  default: "shadow-sm",
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
