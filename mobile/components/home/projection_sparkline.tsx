// components/home/projection_sparkline.tsx — M3 Part 2 Task 4, rule 4.
//
// The Plus projection, drawn with react-native-svg and no chart library.
//
// WRAPPED IN `PlusGate` BY ITS CALLER, not here: a component that gates itself
// cannot be reused anywhere the gate does not apply, and the gate belongs at
// the composition edge where the upgrade sheet's context makes sense.
import { Path, Svg } from "react-native-svg";
import { Text, View } from "react-native";

import { palette } from "@/constants/colors";
import { useTheme } from "@/contexts/theme_context";
import type { ProjectionPoint } from "@/lib/safe_to_spend_projection";

export type ProjectionSparklineProps = {
  points: ProjectionPoint[];
  width?: number;
  height?: number;
  testID?: string;
};

export function ProjectionSparkline({
  points,
  width = 320,
  height = 56,
  testID,
}: ProjectionSparklineProps) {
  const { resolved } = useTheme();
  const stroke = resolved === "dark" ? palette["brand-dark"] : palette.brand;

  // One point cannot describe a trend, and two pixels of line would read as a
  // rendering fault. A daily-scope limit legitimately projects one point.
  if (points.length < 2) return null;

  const values = points.map((point) => point.perDay);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat curve has zero range; dividing by it yields NaN and an empty `d`.
  const range = max - min === 0 ? 1 : max - min;

  const d = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      // SVG y grows downward, so the highest allowance sits at y = 0.
      const y = height - ((point.perDay - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <View testID={testID ?? "projection-sparkline"} className="gap-1">
      <Svg width={width} height={height}>
        <Path testID="projection-path" d={d} stroke={stroke} strokeWidth={2} fill="none" />
      </Svg>
      <Text className="text-xs text-fg-2 dark:text-fg-2-dark">
        {`Your daily allowance if you stop spending, through ${points[points.length - 1].date}`}
      </Text>
    </View>
  );
}
