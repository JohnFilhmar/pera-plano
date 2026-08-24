// mobile/components/ui/__tests__/date_field.test.tsx — W1 Task 8.
//
// NO Date OBJECT CROSSES THE BOUNDARY, and nothing calls toISOString. That
// method is UTC, so for a UTC+8 user near midnight it names the wrong
// calendar day -- the exact class of bug lib/dates.ts's header warns about.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

import { DateField } from "../date_field";

jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ onChange, value }: { onChange: (event: unknown, date?: Date) => void; value: Date }) => (
      <>
        <Pressable
          testID="picker-pick"
          onPress={() => onChange({ type: "set" }, new Date(2026, 8, 30))}
        >
          <Text>pick</Text>
        </Pressable>
        <Pressable testID="picker-cancel" onPress={() => onChange({ type: "dismissed" }, undefined)}>
          <Text>cancel</Text>
        </Pressable>
        {/* getMonth() is 0-indexed and deliberately NOT adjusted here: this
            renders exactly what the picker was handed, so a wrong month (or
            day) shows up as a wrong number instead of being reformatted away. */}
        <Text testID="picker-value">{`${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`}</Text>
      </>
    ),
  };
});

function Harness({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <DateField
      testID="due"
      label="First payment due"
      placeholder="Pick a date"
      value={value}
      onChange={setValue}
    />
  );
}

test("an empty field shows its placeholder and no picker", () => {
  render(<Harness />);

  expect(screen.getByText("Pick a date")).toBeTruthy();
  expect(screen.queryByTestId("picker-pick")).toBeNull();
});

test("pressing the field opens the picker", () => {
  render(<Harness />);

  fireEvent.press(screen.getByTestId("due"));

  expect(screen.getByTestId("picker-pick")).toBeTruthy();
});

test("an existing value opens the picker on the matching local calendar date", () => {
  render(<Harness initial="2026-09-30" />);

  fireEvent.press(screen.getByTestId("due"));

  // September is month index 8, not 9 -- this is the reverse half of the
  // toISOString-class bug the component exists to prevent. A component that
  // passed `month` instead of `month - 1` into the picker's Date would land
  // on index 9 (October) here, and none of the other tests would catch it:
  // they only round-trip through a picked Date, never seed one from an
  // existing IsoDate.
  expect(String(screen.getByTestId("picker-value").props.children)).toBe("2026-8-30");
});

test("choosing a date yields a local YYYY-MM-DD and closes the picker", () => {
  render(<Harness />);
  fireEvent.press(screen.getByTestId("due"));

  fireEvent.press(screen.getByTestId("picker-pick"));

  expect(screen.getByText("2026-09-30")).toBeTruthy();
  expect(screen.queryByTestId("picker-pick")).toBeNull();
});

test("cancelling leaves the value alone", () => {
  render(<Harness initial="2026-08-19" />);
  fireEvent.press(screen.getByTestId("due"));

  fireEvent.press(screen.getByTestId("picker-cancel"));

  expect(screen.getByText("2026-08-19")).toBeTruthy();
});

test("the field is announced with its label and value", () => {
  render(<Harness initial="2026-08-19" />);

  expect(screen.getByLabelText("First payment due, 2026-08-19")).toBeTruthy();
});
