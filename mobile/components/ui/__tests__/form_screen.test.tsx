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
import { FormScreen } from "../form_screen";

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

test("pads the bottom by the keypad's height once it is open", () => {
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
  render(<Harness />);

  fireEvent.press(screen.getByTestId("amount"));
  fireEvent(screen.getByTestId("keypad-host"), "layout", {
    nativeEvent: { layout: { height: 320, width: 400, x: 0, y: 0 } },
  });

  const padding = screen.getByTestId("form-screen").props.contentContainerStyle.paddingBottom;
  expect(padding).toBeGreaterThanOrEqual(320);
});
