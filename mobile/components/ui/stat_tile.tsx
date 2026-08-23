// components/ui/stat_tile.tsx — one of the three tiles under the Home hero
// (Balance · Spent so far · Saved).
import { Text, View } from "react-native";

import type { Centavos } from "@/types/domain";
import { formatCentavos } from "./amount_text";
import { Card } from "./card";

export type StatTileTone = "neutral" | "brand" | "warn" | "danger";

export type StatTileProps = {
  label: string;
  amount: Centavos;
  tone?: StatTileTone;
  testID?: string;
};

const TONE_CLASS: Record<StatTileTone, string> = {
  neutral: "text-fg dark:text-fg-dark",
  brand: "text-brand dark:text-brand-dark",
  warn: "text-warn dark:text-warn-dark",
  danger: "text-danger dark:text-danger-dark",
};

export function StatTile({ label, amount, tone = "neutral", testID }: StatTileProps) {
  return (
    <View className="flex-1" testID={testID}>
      <Card variant="default">
        <Text
          testID={testID === undefined ? undefined : `${testID}-label`}
          numberOfLines={1}
          className="text-micro font-medium text-fg-2 dark:text-fg-2-dark"
        >
          {label}
        </Text>
        {/*
          The formatted amount renders directly here rather than nesting
          `AmountText` inside this `Text`. In React Native, a nested `<Text>`'s
          own colour and size win over its ancestor's for the range it covers,
          so an `AmountText` child silently ate both `TONE_CLASS[tone]` and
          `text-section` — every tone rendered as `AmountText`'s own default
          `fg` colour at its `md` (14px) size instead. `formatCentavos` is the
          same formatter `AmountText` calls internally; calling it directly
          keeps one formatter for the app while letting this `Text`'s own
          className reach the glyphs. `fontVariant: tabular-nums` is copied
          from `AmountText` for the same reason it lives there: this figure
          re-renders as transactions land and must not jitter sideways.
        */}
        <Text
          testID={testID === undefined ? undefined : `${testID}-amount`}
          numberOfLines={1}
          className={`mt-0.5 text-section font-bold ${TONE_CLASS[tone]}`}
          style={{ fontVariant: ["tabular-nums"] }}
        >
          {formatCentavos(amount)}
        </Text>
      </Card>
    </View>
  );
}
