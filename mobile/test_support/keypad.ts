// mobile/test_support/keypad.ts — W1 Task 6.
//
// THE ONE WAY FORM TESTS DRIVE A NUMERIC FIELD. Before W1 they called
// fireEvent.changeText on a TextInput; components/ui/numeric_field.tsx has no
// TextInput, so every one of them needs a new verb. Eighteen files inventing
// that verb separately is eighteen things to fix the next time the panel's
// testIDs move.
//
// Requires the tree under test to be wrapped in KeypadProvider with a
// KeypadHost mounted — components/ui/__tests__/numeric_field.test.tsx shows
// the shape.
import { fireEvent, screen } from "@testing-library/react-native";

/** Focuses a NumericField, raising the panel. */
export function openKeypad(testID: string): void {
  fireEvent.press(screen.getByTestId(testID));
}

/** Closes the panel the way a user does. Values are already committed. */
export function closeKeypad(): void {
  fireEvent.press(screen.getByTestId("keypad-done"));
}

/**
 * Focuses `testID` and presses `text` one character at a time, then closes.
 *
 * Types the characters rather than setting the value, so every test exercises
 * the same appendKey rules the user does — including the refusals. A test
 * that sets "10.555" directly would pass against a field that cannot actually
 * be typed into that way.
 *
 * ON A SEEDED FIELD THIS REPLACES, IT DOES NOT APPEND. The first digit or
 * decimal after a focus starts a fresh string — see `untouched` in
 * contexts/keypad_context.tsx — so `typeAmount(id, "1300")` on a field
 * showing 1250 leaves 1300, not 12501300. A `clearAmount` before a
 * `typeAmount` is therefore redundant now rather than wrong; several suites
 * still carry one from before the panel behaved this way.
 */
export function typeAmount(testID: string, text: string): void {
  openKeypad(testID);
  for (const key of text) {
    fireEvent.press(screen.getByTestId(`keypad-key-${key}`));
  }
  closeKeypad();
}

/** Focuses `testID`, long-presses backspace to clear, then closes. */
export function clearAmount(testID: string): void {
  openKeypad(testID);
  fireEvent(screen.getByTestId("keypad-backspace"), "longPress");
  closeKeypad();
}
