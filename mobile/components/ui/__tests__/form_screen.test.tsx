// mobile/components/ui/__tests__/form_screen.test.tsx — W1 Task 7.
//
// KeyboardProvider has been mounted in app/_layout.tsx since before W1 and
// nothing consumed it: there was not one KeyboardAvoidingView,
// KeyboardAwareScrollView or keyboardShouldPersistTaps anywhere in the app,
// which is why the Save button on every long form sat under the keyboard.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { KeypadProvider } from "@/contexts/keypad_context";
import { KeypadHost } from "../keypad_host";
import { NumericField } from "../numeric_field";
import { BASE_PADDING, FormScreen } from "../form_screen";

test("renders its children inside a scroll container", () => {
  render(
    <KeypadProvider>
      <FormScreen>
        <Text>body</Text>
      </FormScreen>
    </KeypadProvider>,
  );

  expect(screen.getByTestId("form-screen")).toBeTruthy();
  expect(screen.getByText("body")).toBeTruthy();
});

test("taps land on the first press while something is focused", () => {
  // keyboardShouldPersistTaps='handled': without it the first tap on a chip
  // or a Save button is eaten by the dismissal.
  render(
    <KeypadProvider>
      <FormScreen>
        <Text>body</Text>
      </FormScreen>
    </KeypadProvider>,
  );

  expect(screen.getByTestId("form-screen").props.keyboardShouldPersistTaps).toBe("handled");
});

function padding(): number {
  return screen.getByTestId("form-screen").props.contentContainerStyle.paddingBottom;
}

function Harness() {
  return (
    <KeypadProvider>
      <FormScreen>
        <NumericField testID="amount" label="Amount" value="" onChangeText={() => {}} />
      </FormScreen>
      <KeypadHost />
    </KeypadProvider>
  );
}

test("pads the bottom by the keypad's height once it is open", () => {
  render(<Harness />);

  fireEvent.press(screen.getByTestId("amount"));
  fireEvent(screen.getByTestId("keypad-host"), "layout", {
    nativeEvent: { layout: { height: 320, width: 400, x: 0, y: 0 } },
  });

  expect(padding()).toBeGreaterThanOrEqual(320);
});

// THE CLOSED BASELINE — EXACT, NOT A FLOOR (final review, Critical 2).
//
// The assertion above is `toBeGreaterThanOrEqual(320)`, which passes just as
// happily at 100000: it cannot see a `keypadHeight` that outlived its panel.
// This is the one that can. A stale height is reachable in two taps (open the
// review-queue correction sheet, tap the amount, tap the category row, dismiss
// the picker — the picker's host was the active one, so it unmounts active),
// and it lands here as several hundred px of phantom padding under a form
// with no keypad anywhere near it.
test("with nothing focused, it reserves NOTHING for the keypad", () => {
  render(<Harness />);

  expect(padding()).toBe(BASE_PADDING);
});

test("goes back to the closed baseline after the panel closes", () => {
  render(<Harness />);

  fireEvent.press(screen.getByTestId("amount"));
  fireEvent(screen.getByTestId("keypad-host"), "layout", {
    nativeEvent: { layout: { height: 320, width: 400, x: 0, y: 0 } },
  });
  expect(padding()).toBeGreaterThanOrEqual(320); // sanity: it really opened

  fireEvent.press(screen.getByTestId("keypad-done"));

  expect(padding()).toBe(BASE_PADDING);
});
