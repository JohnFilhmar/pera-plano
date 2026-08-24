// components/reports/summary_tiles.tsx — M3b Task 3, rule 4.
//
// THREE NUMBERS, ALREADY COMPUTED. `summarizePeriod` (lib/reports/aggregate.ts)
// owns every figure here; this component only picks a tone for net and lays
// three `StatTile`s out — the same atom Home's hero row uses, so a period
// figure and an account figure read as the same kind of thing app-wide.
import { View } from "react-native";

import { StatTile } from "@/components/ui/stat_tile";
import type { StatTileTone } from "@/components/ui/stat_tile";
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
function netTone(net: number): StatTileTone {
  return net >= 0 ? "brand" : "danger";
}

export function SummaryTiles({ summary, testID }: SummaryTilesProps) {
  return (
    <View testID={testID ?? "summary-tiles"} className="flex-row gap-3">
      <StatTile testID="summary-spend" label="Spend" amount={summary.spend} />
      <StatTile testID="summary-income" label="Income" amount={summary.income} />
      <StatTile testID="summary-net" label="Net" amount={summary.net} tone={netTone(summary.net)} />
    </View>
  );
}
