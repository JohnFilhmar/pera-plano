// components/reports/ranked_bars.tsx — M3b Task 3, rule 1; restyled for
// mobile-ui-revamp Part 3 Task 4 into the board's "Where it went most" list.
//
// TOP MERCHANTS, RANKED. `topMerchants` (lib/reports/aggregate.ts) already
// sorts by total descending with a name-based tie-break, but this component
// re-sorts anyway rather than trusting the order it was handed — a ranked
// list that silently inherited its caller's order would draw a mislabeled
// ranking the moment some future caller forgot to sort, and re-sorting a
// top-N list this short costs nothing.
//
// ONE GENERIC DISC, NOT A PER-MERCHANT ICON. The board hand-picks a lucide
// glyph per named merchant (Jollibee gets a fork, Meralco gets a bolt) — but
// `MerchantTotal` (lib/reports/aggregate.ts) carries only a name, a total and
// a count, with no category or icon of its own. Guessing an icon from the
// merchant STRING would be exactly the kind of invented-in-a-restyle-task
// arithmetic the brief elsewhere warns against, so every row gets the same
// neutral `Store` disc instead — honest about what the data actually is.
//
// RANK IS NOW SHOWN BY LIST ORDER ALONE, NOT BAR LENGTH. The old
// react-native-svg Rect scaled to the leading merchant's total; the board's
// own version drops the bar entirely in favor of a plain ranked list (icon,
// name, count, amount), which is also what rule 3's "a screen reader reads
// the ranking directly" already asked for — a length-scaled bar carries no
// information a sighted user could read that the list order does not
// already give, and it cost a second react-native-svg mount per row.
import { Store } from "lucide-react-native";
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { registerIcon } from "@/components/ui/button";
import type { MerchantTotal } from "@/lib/reports/aggregate";

export type RankedBarsProps = {
  merchants: MerchantTotal[];
  testID?: string;
};

const StoreIcon = registerIcon(Store);

export function RankedBars({ merchants, testID }: RankedBarsProps) {
  if (merchants.length === 0) {
    return (
      <Card testID={testID ?? "ranked-bars"}>
        <Text className="text-body font-bold text-fg dark:text-fg-dark">Where it went most</Text>
        <Text className="mt-2 text-fg-2 dark:text-fg-2-dark">No merchants to rank yet.</Text>
      </Card>
    );
  }

  const ranked = [...merchants].sort(
    (a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant),
  );

  return (
    <Card testID={testID ?? "ranked-bars"}>
      <Text className="text-body font-bold text-fg dark:text-fg-dark">Where it went most</Text>
      <View className="mt-3 gap-3">
        {ranked.map((merchant) => (
          <View
            key={merchant.merchant}
            testID={`ranked-bar-${merchant.merchant}`}
            className="flex-row items-center gap-3"
          >
            <View className="h-[26px] w-[26px] items-center justify-center rounded-lg bg-chip dark:bg-chip-dark">
              <StoreIcon size={13} className="text-fg-2 dark:text-fg-2-dark" />
            </View>
            <Text numberOfLines={1} className="flex-1 text-row font-semibold text-fg dark:text-fg-dark">
              {merchant.merchant}
            </Text>
            <Chip
              testID={`ranked-bar-${merchant.merchant}-count`}
              label={`${merchant.count}×`}
              tone="neutral"
              fill="outline"
            />
            <AmountText amount={merchant.total} />
          </View>
        ))}
      </View>
    </Card>
  );
}
