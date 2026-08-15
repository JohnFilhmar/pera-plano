// components/goals/progress_ring.tsx — m2b Task 4, rule 1.
//
// DRAWN WITH react-native-svg, NOT A CHART LIBRARY. One ring does not justify a
// charting dependency, and every chart library brings its own animation and
// theming opinions that would fight the palette.
//
// THE ARC IS A DASHED CIRCLE, which is the standard trick and worth naming: a
// stroke whose dash pattern is `[fraction × circumference, circumference]`
// draws exactly that fraction and nothing else, so there is no path arithmetic
// and no arc-flag edge case at 50%. Rotated −90° so it starts at twelve
// o'clock rather than at three.
import { View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { palette } from "@/constants/colors";

export type ProgressRingProps = {
  /** 0..1. Clamped here as well as upstream — a ring cannot draw 120%. */
  fraction: number;
  /** A palette token value, already resolved for the current theme. */
  color: string;
  trackColor: string;
  size?: number;
  strokeWidth?: number;
  testID?: string;
  /** Rendered in the middle of the ring — the saved-of-target amounts. */
  children?: React.ReactNode;
};

export function ProgressRing({
  fraction,
  color,
  trackColor,
  size = 96,
  strokeWidth = 8,
  testID,
  children,
}: ProgressRingProps) {
  const safeFraction = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * safeFraction;

  return (
    // The wrapper carries the testID rather than the Svg — the same reason
    // components/wallets/wallet_type_icon.tsx gives: react-native-svg's prop
    // forwarding is not something a component should depend on.
    <View testID={testID} style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {safeFraction > 0 ? (
          <Circle
            testID={testID === undefined ? undefined : `${testID}-arc`}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            // Start at twelve o'clock. Without this the ring begins at three,
            // which reads as a clock face rather than as progress.
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children === undefined ? null : (
        <View className="absolute inset-0 items-center justify-center">{children}</View>
      )}
    </View>
  );
}

/** Palette values per pace, resolved by the card so this stays presentational. */
export const PACE_RING_COLOR = {
  light: {
    on_track: palette.brand,
    reached: palette.brand,
    no_deadline: palette.brand,
    behind: palette.warn,
    past_due: palette.danger,
  },
  dark: {
    on_track: palette["brand-dark"],
    reached: palette["brand-dark"],
    no_deadline: palette["brand-dark"],
    behind: palette["warn-dark"],
    past_due: palette["danger-dark"],
  },
} as const;
