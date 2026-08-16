// components/reports/donut_chart.tsx — M3b Task 3, rules 1-3.
//
// THE ARC IS A DASHED CIRCLE, the same trick components/goals/progress_ring.tsx
// already uses: a stroke whose dash pattern is [segment length, full
// circumference] draws exactly that segment and nothing else, so there is no
// path arithmetic and no arc-flag edge case at any share. Each category gets
// its OWN Circle, rotated past every prior segment via strokeDashoffset,
// rather than one Path built from N arc commands — N circles give one stable
// testID per category and no trig to get wrong.
//
// RULE 3'S TEXT ALTERNATIVE IS NOT DECORATION. The legend below the ring
// carries the same figures a screen reader needs and a picture cannot give
// it — a finance app must not hide numbers inside a donut. Money in the
// legend goes through AmountText, the only formatter in the app.
import { Text, View } from "react-native";
import { Circle, Svg } from "react-native-svg";

import { AmountText } from "@/components/ui/amount_text";
import { palette } from "@/constants/colors";
import { useTheme } from "@/contexts/theme_context";
import type { CategoryTotal } from "@/lib/reports/aggregate";

export type DonutChartProps = {
  categories: CategoryTotal[];
  size?: number;
  strokeWidth?: number;
  testID?: string;
};

/**
 * Every non-neutral hue the palette defines (constants/colors.ts) — rule 2
 * forbids inventing new hex values, so this list IS the ceiling on how many
 * categories can look visually distinct in one donut at once. Past six
 * simultaneous slices the hash below cycles back through the same colors;
 * that is a token-budget limit worth flagging to a designer, not a bug in
 * the hash (see the Task 3 report).
 */
const CATEGORY_COLOR_KEYS = ["brand", "warn", "danger", "ph-blue", "ph-red", "ph-yellow"] as const;

/**
 * A small, deterministic string hash (djb2-family). `Math.imul` keeps every
 * step a true 32-bit integer multiply — without it `hash * 31` drifts into
 * float once `id` is long enough to exceed 2**53, and the SAME id could then
 * hash differently depending on the engine's rounding. `>>> 0` turns the
 * signed 32-bit result unsigned before `%`, since JS's `%` keeps the sign of
 * a negative dividend and a negative index has no palette slot.
 */
function hashToIndex(id: string, modulus: number): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(index)) | 0;
  }
  return (hash >>> 0) % modulus;
}

/**
 * A category id always resolves to the same palette hex, on every render and
 * every screen (rule 2) — hashed from the id itself, never from array
 * position or Map/object iteration order, either of which silently
 * reshuffles the moment a category is added, renamed, or archived.
 */
export function categoryColor(categoryId: string, dark: boolean): string {
  const key = CATEGORY_COLOR_KEYS[hashToIndex(categoryId, CATEGORY_COLOR_KEYS.length)];
  return palette[dark ? (`${key}-dark` as keyof typeof palette) : key];
}

export function DonutChart({
  categories,
  size = 200,
  strokeWidth = 28,
  testID,
}: DonutChartProps) {
  const { resolved } = useTheme();
  const dark = resolved === "dark";
  const center = size / 2;
  // Guards the same degenerate case ProjectionSparkline guards for its own
  // axis: a caller-supplied size/strokeWidth combo that leaves nothing to
  // draw must not divide into a negative or zero radius.
  const radius = Math.max(1, (size - strokeWidth) / 2);
  const circumference = 2 * Math.PI * radius;

  let cumulative = 0;
  const arcs = categories.map((category) => {
    const length = category.share * circumference;
    const arc = { categoryId: category.categoryId, length, offset: cumulative };
    cumulative += length;
    return arc;
  });

  return (
    <View testID={testID ?? "donut-chart"} className="gap-3">
      {categories.length === 0 ? (
        <Text className="text-fg-2 dark:text-fg-2-dark">No spending to break down.</Text>
      ) : (
        <Svg width={size} height={size}>
          {arcs.map((arc) => (
            <Circle
              key={arc.categoryId}
              testID={`donut-arc-${arc.categoryId}`}
              cx={center}
              cy={center}
              r={radius}
              stroke={categoryColor(arc.categoryId, dark)}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={`${arc.length} ${circumference}`}
              // Negative offset shifts the visible dash FORWARD along the
              // path by every prior segment's length, so segments tile
              // rather than overlap. Rotated -90° first so the first segment
              // starts at twelve o'clock, the same convention progress_ring
              // uses, rather than three.
              strokeDashoffset={-arc.offset}
              transform={`rotate(-90 ${center} ${center})`}
            />
          ))}
        </Svg>
      )}

      <View testID="donut-legend" className="gap-2">
        {categories.map((category) => (
          <View
            key={category.categoryId}
            testID={`donut-legend-${category.categoryId}`}
            className="flex-row items-center gap-2"
          >
            <View
              style={{ backgroundColor: categoryColor(category.categoryId, dark) }}
              className="h-3 w-3 rounded-full"
            />
            <Text className="flex-1 text-fg dark:text-fg-dark">{category.categoryName}</Text>
            <AmountText amount={category.total} />
            <Text className="w-12 text-right text-fg-2 dark:text-fg-2-dark">
              {`${Math.round(category.share * 100)}%`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
