// components/reports/summary_tiles.tsx — M3b Task 3, rule 4.
//
// THREE NUMBERS, ALREADY COMPUTED. `summarizePeriod` (lib/reports/aggregate.ts)
// owns every figure here; this component only picks a tone for net and lays
// three cards out.
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import type { PeriodSummary } from "@/lib/reports/aggregate";

export type SummaryTilesProps = {
  summary: PeriodSummary;
  testID?: string;
};

/**
 * Net is signed spending for the WHOLE period, not a single Transaction's
 * `direction` — it does not go through AmountText's own direction coloring,
 * which reserves red for nothing (components/ui/amount_text.tsx: "ordinary
 * spending is not an error state"). Brand for "ahead", danger for "behind"
 * mirrors the tone components/home/safe_to_spend_hero.tsx already uses for a
 * period-level verdict, not a single row.
 */
function netToneClass(net: number): string {
  return net >= 0 ? "text-brand dark:text-brand-dark" : "text-danger dark:text-danger-dark";
}

export function SummaryTiles({ summary, testID }: SummaryTilesProps) {
  return (
    <View testID={testID ?? "summary-tiles"} className="flex-row gap-3">
      <Card>
        <Text className="text-fg-2 dark:text-fg-2-dark">Spend</Text>
        <AmountText testID="summary-spend" amount={summary.spend} />
      </Card>
      <Card>
        <Text className="text-fg-2 dark:text-fg-2-dark">Income</Text>
        <AmountText testID="summary-income" amount={summary.income} />
      </Card>
      <Card>
        <Text className="text-fg-2 dark:text-fg-2-dark">Net</Text>
        <View testID="summary-net" className={netToneClass(summary.net)}>
          <AmountText amount={summary.net} />
        </View>
      </Card>
    </View>
  );
}
