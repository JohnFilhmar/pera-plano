// components/reports/trend_line.tsx — M3b Task 3, rules 1 and 3.
//
// A SIBLING OF components/home/projection_sparkline.tsx: the same
// react-native-svg Path technique, the same degenerate-input guards (fewer
// than 2 points, zero range) rather than emitting NaN path data, the same
// theme-resolved stroke. The one addition is the legend below the curve —
// rule 3's text alternative, since a line alone gives a screen reader
// nothing and a finance app must not hide numbers inside a picture.
//
// SPEND ONLY, per docs/04-features/10-reports.md's stated default metric
// ("Default metric: spend; a toggle adds net") — a net toggle is a later
// refinement the doc itself defers, not this task's scope.
import { Text, View } from "react-native";
import { Circle, Path, Svg } from "react-native-svg";

import { AmountText } from "@/components/ui/amount_text";
import { palette } from "@/constants/colors";
import { useTheme } from "@/contexts/theme_context";
import { MONTHS } from "@/lib/datetime";
import type { TrendPoint } from "@/lib/reports/aggregate";

export type TrendLineProps = {
  points: TrendPoint[];
  width?: number;
  height?: number;
  testID?: string;
};

/** `'2026-08-01'` → `'Aug 2026'`. lib/datetime.ts's own month table, not a new one. */
function periodLabel(dateIso: string): string {
  const [year, month] = dateIso.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
}

export function TrendLine({ points, width = 320, height = 140, testID }: TrendLineProps) {
  const { resolved } = useTheme();
  const stroke = resolved === "dark" ? palette["brand-dark"] : palette.brand;

  // One point cannot describe a trend, and two pixels of line would read as
  // a rendering fault — the same guard ProjectionSparkline applies.
  if (points.length < 2) {
    return (
      <View testID={testID ?? "trend-line"}>
        <Text className="text-fg-2 dark:text-fg-2-dark">Not enough periods yet to show a trend.</Text>
      </View>
    );
  }

  const values = points.map((point) => point.spend);
  // Anchored at zero rather than the series' own minimum, so a run of quiet
  // periods reads as low against a real floor instead of a flat line
  // stretched to fill the chart — rule 15's "zero-height, not a gap" logic,
  // carried over from bars to a line.
  const min = Math.min(0, ...values);
  const max = Math.max(...values);
  // A flat series (every period equal, including all-zero) has zero range;
  // dividing by it yields NaN and an empty `d`.
  const range = max - min === 0 ? 1 : max - min;

  const coordinatesOf = (point: TrendPoint, index: number) => {
    const x = (index / (points.length - 1)) * width;
    // SVG y grows downward, so the highest spend sits at y = 0.
    const y = height - ((point.spend - min) / range) * height;
    return { x, y };
  };

  const d = points
    .map((point, index) => {
      const { x, y } = coordinatesOf(point, index);
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <View testID={testID ?? "trend-line"} className="gap-3">
      <Svg width={width} height={height}>
        <Path testID="trend-path" d={d} stroke={stroke} strokeWidth={2} fill="none" />
        {points.map((point, index) => {
          const { x, y } = coordinatesOf(point, index);
          return (
            <Circle key={point.label} testID={`trend-point-${point.label}`} cx={x} cy={y} r={3} fill={stroke} />
          );
        })}
      </Svg>
      <View testID="trend-legend" className="gap-1">
        {points.map((point) => (
          <View key={point.label} testID={`trend-legend-${point.label}`} className="flex-row justify-between">
            <Text className="text-fg-2 dark:text-fg-2-dark">{periodLabel(point.label)}</Text>
            <AmountText amount={point.spend} />
          </View>
        ))}
      </View>
    </View>
  );
}
