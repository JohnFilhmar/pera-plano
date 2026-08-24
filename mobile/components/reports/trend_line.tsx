// components/reports/trend_line.tsx — M3b Task 3, rules 1 and 3; restyled for
// mobile-ui-revamp Part 3 Task 4 into the board's "Last 6 periods" bar row.
//
// BARS, NOT A LINE, per the task-4 brief. The degenerate-input guard (fewer
// than 2 points) and the legend below — rule 3's text alternative, since a
// bar alone gives a screen reader nothing and a finance app must not hide
// numbers inside a picture — both carry over unchanged from the line chart
// this replaces; only the shape drawn from `points` changed.
//
// "OVER-LIMIT" DOES NOT REPRODUCE AGAINST THIS COMPONENT'S DATA. The task
// brief asks for "any over-limit period filled soft danger", but `TrendPoint`
// (lib/reports/aggregate.ts) carries only `label`, `range`, `spend` and
// `income` — no Limit reference reaches `trendSeries()`, `getReport()`, or
// this component's props. docs/04-features/10-reports.md's own "Data
// touched" table lists a Limit read for "the spend-vs-Limit comparison in
// Period spend" as a documented but NEVER-IMPLEMENTED capability — grepping
// `lib/reports/reports_service.ts` confirms it never imports `lib/limits`.
// Painting a bar danger-red for "over limit" with nothing behind it to
// compare against would assert something false to the user, which is worse
// than the alternative this file ships instead: every period bar renders
// neutral except the current one (brand), and no danger fill exists here at
// all. Flagged in the task report as a claim that did not reproduce, for
// whoever owns wiring Limits into Reports next.
//
// SPEND ONLY, per docs/04-features/10-reports.md's stated default metric
// ("Default metric: spend; a toggle adds net") — a net toggle is a later
// refinement the doc itself defers, not this task's scope.
import { Text, View } from "react-native";

import { AmountText } from "@/components/ui/amount_text";
import { Card } from "@/components/ui/card";
import { MONTHS } from "@/lib/datetime";
import type { TrendPoint } from "@/lib/reports/aggregate";

export type TrendLineProps = {
  points: TrendPoint[];
  testID?: string;
};

/** `'2026-08-01'` → `'Aug 2026'`. lib/datetime.ts's own month table, not a new one. */
function periodLabel(dateIso: string): string {
  const [year, month] = dateIso.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

/** `'2026-08-01'` → `'Aug'` — the short label the board draws under each bar. */
function shortMonthLabel(dateIso: string): string {
  const [, month] = dateIso.split("-");
  return MONTHS[Number(month) - 1];
}

const BAR_ROW_HEIGHT = 96;
/** A bar at zero spend still shows a sliver, never nothing — rule 15's
 * "zero-height bars, not gaps" applied to a minimum rather than a literal
 * zero, since a truly invisible bar and a missing period read identically. */
const MIN_BAR_HEIGHT = 4;

export function TrendLine({ points, testID }: TrendLineProps) {
  // One point cannot describe a trend — the same guard the line chart this
  // replaces applied, carried over unchanged.
  if (points.length < 2) {
    return (
      <Card testID={testID ?? "trend-line"}>
        <Text className="text-fg-2 dark:text-fg-2-dark">Not enough periods yet to show a trend.</Text>
      </Card>
    );
  }

  const values = points.map((point) => point.spend);
  const max = Math.max(...values);
  const lastIndex = points.length - 1;

  return (
    <Card testID={testID ?? "trend-line"}>
      <Text className="text-body font-bold text-fg dark:text-fg-dark">Last 6 periods</Text>

      <View className="mt-4 flex-row items-end gap-2" style={{ height: BAR_ROW_HEIGHT }}>
        {points.map((point, index) => {
          const isCurrent = index === lastIndex;
          // `max === 0` means every period in view is zero — every bar sits
          // at the same floor rather than dividing 0/0 into NaN.
          const barHeight =
            max === 0 ? MIN_BAR_HEIGHT : Math.max(MIN_BAR_HEIGHT, (point.spend / max) * BAR_ROW_HEIGHT);

          return (
            <View key={point.label} className="flex-1 items-center gap-1.5" style={{ height: BAR_ROW_HEIGHT }}>
              <View className="w-full flex-1 justify-end">
                <View
                  testID={`trend-point-${point.label}`}
                  className={`w-full rounded-md ${isCurrent ? "bg-brand dark:bg-brand-dark" : "bg-chip dark:bg-chip-dark"}`}
                  style={{ height: barHeight }}
                />
              </View>
              <Text
                numberOfLines={1}
                className={
                  isCurrent
                    ? "text-micro font-bold text-brand dark:text-brand-dark"
                    : "text-micro font-medium text-fg-2 dark:text-fg-2-dark"
                }
              >
                {shortMonthLabel(point.label)}
              </Text>
            </View>
          );
        })}
      </View>

      <View testID="trend-legend" className="mt-3 gap-1 border-t border-line pt-3 dark:border-line-dark">
        {points.map((point) => (
          <View key={point.label} testID={`trend-legend-${point.label}`} className="flex-row justify-between">
            <Text className="text-fg-2 dark:text-fg-2-dark">{periodLabel(point.label)}</Text>
            <AmountText amount={point.spend} />
          </View>
        ))}
      </View>
    </Card>
  );
}
