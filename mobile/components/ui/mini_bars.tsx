// components/ui/mini_bars.tsx — the seven-day bar strip inside the Home hero.
//
// TAKES PLAIN NUMBERS, NOT Centavos. It draws relative heights and nothing
// else — no axis, no value labels, no currency. Typing it to Centavos would
// imply it knows about money, and the next caller with a non-money series
// would either lie about the type or copy the file.
import { Text, View } from "react-native";

export type MiniBarsProps = {
  values: readonly number[];
  /**
   * THE CALLER OWNS THE INK, and this is not laziness. These bars ride on the
   * Home hero's coloured fill, and which ink is legible on that fill depends
   * on the fill: white clears AA on `brand` (5.02:1) and `danger` (4.83:1) but
   * only reaches 3.2:1 on `warn`, so the amber hero takes DARK ink instead —
   * the same exception `components/ui/chip.tsx` already documents for amber.
   * A tone map inside this component would have to encode the hero's state
   * machine to get that right, and would then be wrong the first time anything
   * else drew a bar strip.
   */
  barClassName: string;
  labelClassName: string;
  startLabel?: string;
  endLabel?: string;
  testID?: string;
};

const TRACK_HEIGHT = 44;
/** A zero day is still a day. A 0dp bar reads as a rendering failure. */
const MIN_BAR_HEIGHT = 3;

export function MiniBars({
  values,
  barClassName,
  labelClassName,
  startLabel,
  endLabel,
  testID,
}: MiniBarsProps) {
  const peak = Math.max(...values, 0);

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={
        startLabel === undefined || endLabel === undefined
          ? "Spending for the period"
          : `Spending, ${startLabel} to ${endLabel}`
      }
    >
      <View className="flex-row items-end gap-1" style={{ height: TRACK_HEIGHT }}>
        {values.map((value, index) => (
          <View
            key={index}
            testID={testID === undefined ? undefined : `${testID}-bar-${index}`}
            className={`flex-1 rounded-sm ${barClassName}`}
            style={{
              height:
                peak <= 0
                  ? MIN_BAR_HEIGHT
                  : Math.max(MIN_BAR_HEIGHT, Math.round((value / peak) * TRACK_HEIGHT)),
            }}
          />
        ))}
      </View>
      {startLabel === undefined && endLabel === undefined ? null : (
        <View className="mt-1 flex-row justify-between">
          <Text className={`text-badge font-semibold ${labelClassName}`}>{startLabel}</Text>
          <Text className={`text-badge font-semibold ${labelClassName}`}>{endLabel}</Text>
        </View>
      )}
    </View>
  );
}
