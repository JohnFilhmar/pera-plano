// components/transactions/amount_numpad.tsx — m1c plan Task 8, rules 1, 2 and 5.
//
// The landing state of manual entry. Cash entry competes with not-bothering
// (rule 1), so the amount is the first and only thing on screen; everything
// else is defaulted behind it.
//
// CONTROLLED ON THE RAW DIGIT STRING, never on a formatted one. `"1234"` means
// ₱12.34, and the peso string is rendered FROM those digits and never parsed
// BACK into a number. `Number("₱12.34".replace(...)) * 100` is the
// `12.10 * 100 === 1209.9999` bug wearing a different coat, and this codebase
// has already been bitten by it twice — in the parser and in the confidence
// gate. Keeping the digits as the source of truth makes the class of bug
// unreachable rather than merely avoided.
import { Pressable, Text, View } from "react-native";
import { Delete } from "lucide-react-native";
import { cssInterop } from "nativewind";

import { centavosFromDigits, formatCentavos } from "@/components/ui/amount_text";

// Lucide ignores `className` until registered; `nativeStyleToProp` routes the
// resolved colour back onto the `color` prop it actually reads.
cssInterop(Delete, { className: { target: "style", nativeStyleToProp: { color: true } } });

/**
 * The most digits that still convert to a safe integer number of centavos.
 *
 * `centavosFromDigits` clamps beyond this, so a further keystroke would be
 * SHOWN and then not SAVED — the display and the ledger quietly disagreeing
 * about the number the user is looking at. Refusing the keystroke instead keeps
 * what is on screen equal to what will be written.
 */
export const NUMPAD_MAX_DIGITS = 15;

/** Appends one digit, or returns the input unchanged when it may not be added. */
export function appendDigit(digits: string, key: string): string {
  // A leading zero is dropped rather than accumulated: "0" then "5" is ₱0.05,
  // not ₱0.05 reached via a "05" that later grows into "050".
  const base = digits === "0" ? "" : digits;
  const next = `${base}${key}`;

  if (next === "0") return "";
  if (next.length > NUMPAD_MAX_DIGITS) return digits;

  return next;
}

/** Removes the last digit. The inverse of one keystroke, never a clear. */
export function removeLastDigit(digits: string): string {
  return digits.slice(0, -1);
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

export type AmountNumpadProps = {
  digits: string;
  onDigitsChange: (digits: string) => void;
};

export function AmountNumpad({ digits, onDigitsChange }: AmountNumpadProps) {
  return (
    <View className="gap-6">
      <Text
        testID="numpad-amount"
        // Reads ₱0.00 rather than blank when untouched: this is the landing
        // state, and an empty field reads as "not loaded yet".
        className="text-center text-5xl font-bold text-fg dark:text-fg-dark"
        accessibilityLabel={`Amount ${formatCentavos(centavosFromDigits(digits))}`}
      >
        {formatCentavos(centavosFromDigits(digits))}
      </Text>

      <View className="flex-row flex-wrap justify-center gap-3">
        {KEYS.map((key) => (
          <Pressable
            key={key}
            testID={`numpad-key-${key}`}
            accessibilityRole="button"
            accessibilityLabel={key}
            onPress={() => onDigitsChange(appendDigit(digits, key))}
            className="h-16 w-20 items-center justify-center rounded-2xl bg-surface dark:bg-surface-dark"
          >
            <Text className="text-2xl font-semibold text-fg dark:text-fg-dark">{key}</Text>
          </Pressable>
        ))}

        {/* ONE KEY, TWO DISTINCT BEHAVIOURS. Press removes one digit; long
            press clears. Wiring both to the same handler passes any test that
            only checks the field ends up empty — on a one-digit amount they are
            identical — and leaves a user deleting a mistyped amount one key at
            a time while the digits shift under them. */}
        <Pressable
          testID="numpad-backspace"
          accessibilityRole="button"
          accessibilityLabel="Delete last digit"
          accessibilityHint="Press and hold to clear the amount"
          onPress={() => onDigitsChange(removeLastDigit(digits))}
          onLongPress={() => onDigitsChange("")}
          className="h-16 w-20 items-center justify-center rounded-2xl bg-surface dark:bg-surface-dark"
        >
          <Delete className="text-fg dark:text-fg-dark" size={22} />
        </Pressable>
      </View>
    </View>
  );
}
