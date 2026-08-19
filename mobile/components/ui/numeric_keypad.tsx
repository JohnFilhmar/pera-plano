// mobile/components/ui/numeric_keypad.tsx — W1 Task 2. Replaces
// components/transactions/amount_numpad.tsx.
//
// AN EXPLICIT THREE-COLUMN GRID, NEVER flex-wrap. The component this replaces
// wrapped fixed-width children and got 4/4/3 on the A54 -- not a chosen
// layout, just what wrapping does at that width, and it would silently become
// something else on a tablet. Each row is its own flex-row of flex-1
// children, so three columns is a property of the markup rather than of the
// screen.
//
// PRESENTATIONAL AND STATELESS. It knows nothing about money, holds no text,
// and never converts anything: lib/money/peso_input.ts owns all of that, and
// keeping the two apart is what lets the state machine be tested exhaustively
// without a renderer.
import { Pressable, Text, View } from "react-native";
import { Delete } from "lucide-react-native";
import { cssInterop } from "nativewind";

// Lucide ignores `className` until registered; `nativeStyleToProp` routes the
// resolved colour back onto the `color` prop it actually reads.
cssInterop(Delete, { className: { target: "style", nativeStyleToProp: { color: true } } });

export type KeypadMode = "peso" | "integer" | "rate";

export type NumericKeypadProps = {
  mode: KeypadMode;
  onKey: (key: string) => void;
  /** One character. */
  onBackspace: () => void;
  /** Everything. Long press only — see the test for why they are separate. */
  onClear: () => void;
};

const ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "backspace"],
];

const KEY_CLASS = "h-14 flex-1 items-center justify-center rounded-2xl bg-surface dark:bg-surface-dark";

export function NumericKeypad({ mode, onKey, onBackspace, onClear }: NumericKeypadProps) {
  const decimalInert = mode === "integer";

  return (
    <View testID="numeric-keypad" className="gap-2">
      {ROWS.map((row) => (
        <View key={row.join("")} className="flex-row gap-2">
          {row.map((key) => {
            if (key === "backspace") {
              return (
                <Pressable
                  key={key}
                  testID="keypad-backspace"
                  accessibilityRole="button"
                  accessibilityLabel="Delete last character"
                  accessibilityHint="Press and hold to clear"
                  onPress={onBackspace}
                  onLongPress={onClear}
                  className={KEY_CLASS}
                >
                  <Delete className="text-fg dark:text-fg-dark" size={22} />
                </Pressable>
              );
            }

            const inert = key === "." && decimalInert;

            return (
              <Pressable
                key={key}
                testID={`keypad-key-${key}`}
                accessibilityRole="button"
                accessibilityLabel={key === "." ? "Decimal point" : key}
                accessibilityState={{ disabled: inert }}
                disabled={inert}
                onPress={inert ? undefined : () => onKey(key)}
                className={`${KEY_CLASS}${inert ? " opacity-30" : ""}`}
              >
                <Text className="text-2xl font-semibold text-fg dark:text-fg-dark">{key}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
