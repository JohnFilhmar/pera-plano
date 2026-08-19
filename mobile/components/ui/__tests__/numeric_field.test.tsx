// mobile/components/ui/__tests__/numeric_field.test.tsx — W1 Task 5.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { TextInput } from "react-native";
import { useState } from "react";

import { KeypadProvider } from "@/contexts/keypad_context";
import { KeypadHost } from "../keypad_host";
import { NumericField } from "../numeric_field";
import type { KeypadMode } from "../numeric_keypad";

// Explicit prop typing (rather than letting `mode`'s default infer its own
// type) because `mode = "peso" as const` alone locks the inferred type to
// the single literal "peso" and rejects every other KeypadMode a test below
// passes in.
function Harness({ initial = "", mode = "peso" }: { initial?: string; mode?: KeypadMode }) {
  const [value, setValue] = useState(initial);
  return (
    <KeypadProvider>
      <NumericField
        testID="amount"
        label="How much?"
        mode={mode}
        placeholder="Amount"
        value={value}
        onChangeText={setValue}
      />
      <KeypadHost />
    </KeypadProvider>
  );
}

test("THE GUARANTEE: the field renders no TextInput, so no OS keyboard can appear", () => {
  // showSoftInputOnFocus={false} on a real TextInput is the other way to do
  // this, and it is a prop one future edit can drop. A tree with no text
  // input in it cannot raise a keyboard no matter what anyone does later.
  render(<Harness />);

  expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
});

test("pressing the field opens the keypad with its label and mode", () => {
  render(<Harness />);

  fireEvent.press(screen.getByTestId("amount"));

  expect(screen.getByTestId("keypad-host")).toBeTruthy();
  expect(screen.getByTestId("keypad-label").props.children).toBe("How much?");
});

test("keystrokes flow back into the field's own value", () => {
  render(<Harness />);
  fireEvent.press(screen.getByTestId("amount"));

  for (const key of ["1", "0", "0", "0"]) {
    fireEvent.press(screen.getByTestId(`keypad-key-${key}`));
  }

  // Closed first: while the panel is open, "₱1,000" renders in both the
  // field and the panel's own display, and getByText throws on multiple
  // matches. Closing is also what a user actually does to finish entry.
  fireEvent.press(screen.getByTestId("keypad-done"));

  expect(screen.getByText("₱1,000")).toBeTruthy();
});

test("the panel stays in sync as the value grows", () => {
  render(<Harness />);
  fireEvent.press(screen.getByTestId("amount"));

  for (const key of ["9", "9"]) {
    fireEvent.press(screen.getByTestId(`keypad-key-${key}`));
  }

  expect(String(screen.getByTestId("keypad-display").props.children)).toBe("₱99");
});

test("an empty field shows its placeholder", () => {
  render(<Harness />);

  expect(screen.getByText("Amount")).toBeTruthy();
});

test("a seeded field shows the formatted amount", () => {
  render(<Harness initial="1000.50" />);

  expect(screen.getByText("₱1,000.50")).toBeTruthy();
});

test("integer mode shows the raw number, unformatted", () => {
  render(<Harness initial="6" mode="integer" />);

  expect(screen.getByText("6")).toBeTruthy();
});

test("the field is announced with its label and value", () => {
  render(<Harness initial="1000" />);

  expect(screen.getByLabelText("How much?, ₱1,000")).toBeTruthy();
});
