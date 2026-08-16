// components/reports/ranked_bars.tsx — M3b Task 3, rule 1.
//
// TOP MERCHANTS, RANKED. `topMerchants` (lib/reports/aggregate.ts) already
// sorts by total descending with a name-based tie-break, but this component
// re-sorts anyway rather than trusting the order it was handed — a ranked
// list that silently inherited its caller's order would draw a mislabeled
// ranking the moment some future caller forgot to sort, and re-sorting a
// top-N list this short costs nothing.
//
// EACH BAR IS A SINGLE react-native-svg Rect, scaled to the leading
// merchant's total — the same "turn a number into a coordinate, nothing
// more" discipline components/home/projection_sparkline.tsx uses for its
// points. The name and the AmountText beside each bar are plain RN text,
// not SVG labels, so a screen reader reads the ranking directly (rule 3)
// rather than needing a separate legend.
import { Text, View } from "react-native";
import { Rect, Svg } from "react-native-svg";

import { AmountText } from "@/components/ui/amount_text";
import { palette } from "@/constants/colors";
import { useTheme } from "@/contexts/theme_context";
import type { MerchantTotal } from "@/lib/reports/aggregate";

export type RankedBarsProps = {
  merchants: MerchantTotal[];
  width?: number;
  testID?: string;
};

const BAR_HEIGHT = 10;

export function RankedBars({ merchants, width = 280, testID }: RankedBarsProps) {
  const { resolved } = useTheme();
  const barColor = resolved === "dark" ? palette["brand-dark"] : palette.brand;

  if (merchants.length === 0) {
    return (
      <View testID={testID ?? "ranked-bars"}>
        <Text className="text-fg-2 dark:text-fg-2-dark">No merchants to rank yet.</Text>
      </View>
    );
  }

  const ranked = [...merchants].sort(
    (a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant),
  );
  const max = ranked[0].total;

  return (
    <View testID={testID ?? "ranked-bars"} className="gap-3">
      {ranked.map((merchant) => {
        // max === 0 means every total is zero (or the list is degenerate) —
        // full-width bars read as "nothing to compare" without dividing by
        // zero into NaN.
        const barWidth = max === 0 ? width : (merchant.total / max) * width;
        return (
          <View key={merchant.merchant} testID={`ranked-bar-${merchant.merchant}`} className="gap-1">
            <View className="flex-row items-center justify-between">
              <Text className="flex-1 pr-2 text-fg dark:text-fg-dark">{merchant.merchant}</Text>
              <AmountText amount={merchant.total} />
            </View>
            <Svg width={width} height={BAR_HEIGHT}>
              <Rect x={0} y={0} width={barWidth} height={BAR_HEIGHT} rx={BAR_HEIGHT / 2} fill={barColor} />
            </Svg>
          </View>
        );
      })}
    </View>
  );
}
