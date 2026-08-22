// components/ui/stat_tile.tsx — one of the three tiles under the Home hero
// (Balance · Spent so far · Saved).
import { Text, View } from "react-native";

import type { Centavos } from "@/types/domain";
import { AmountText } from "./amount_text";
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
    <View className="flex-1">
      <Card variant="default">
        <Text
          testID={testID === undefined ? undefined : `${testID}-label`}
          numberOfLines={1}
          className="text-micro font-medium text-fg-2 dark:text-fg-2-dark"
        >
          {label}
        </Text>
        {/*
          `testID` (bare, no suffix) sits on THIS wrapper rather than on the
          outer flex-1 View. `toHaveTextContent` in this repo's RNTL version
          checks the QUERIED element's entire flattened subtree text for an
          exact match, not a substring — verified empirically, since a plain,
          unnested sibling-label reproduction failed the same way a nested
          `AmountText` did. Putting the bare testID on the outer View (which
          also contains the label Text) makes "label + amount" its flattened
          text forever, and no `toHaveTextContent("₱…")` assertion against it
          can pass while the label renders beside it. Scoping the bare testID
          to a wrapper that contains ONLY the amount Text keeps its flattened
          text exactly the formatted amount, with zero layout effect — an
          unstyled View around one Text adds no visible box.
        */}
        <View testID={testID}>
          <Text
            testID={testID === undefined ? undefined : `${testID}-amount`}
            numberOfLines={1}
            className={`mt-0.5 text-section font-bold ${TONE_CLASS[tone]}`}
          >
            <AmountText amount={amount} size="md" />
          </Text>
        </View>
      </Card>
    </View>
  );
}
