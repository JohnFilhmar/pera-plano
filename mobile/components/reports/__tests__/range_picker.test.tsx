// components/reports/__tests__/range_picker.test.tsx — fix-wave FIX 2,
// re-pointed at the calendar by numeric-input-system Task 14.
//
// The custom-range Apply button had no validation: `from`/`to` default to
// `""`, and pressing Apply immediately produced a query that degrades to
// zero rows, showing "No transactions in this period" — a misleading
// message when the real problem was invalid input, not missing data.
// Nothing crashes either way (Number.isFinite / SQLite's NaN comparisons
// close the range on their own), so this file pins the UI-level guard:
// Apply stays disabled — and inert on press — until both dates are set and
// `from <= to`.
//
// THE TWO GUARDS ARE NOT THE SAME GUARD, and this file now covers both.
// The BOUNDS (`maximumDate` on the start field, `minimumDate` on the end
// field) stop the user REACHING an invalid pair; `isValidCustomRange` still
// catches one. The mocked picker below deliberately IGNORES the bounds it is
// handed and fires whatever date a test asks for — that is what lets the
// "from after to" test still drive the component into the state the real
// dialog would refuse, and prove the string check has not quietly become
// decoration.
//
// RangePicker's own tier-gating behaviour (rule 5, the PlusGate wrapping,
// month pills vs. the free static label) is already pinned in
// charts.test.tsx; this file only covers the custom-range form.
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { __setTierForTests } from "@/lib/entitlements";
import type { AvailableScopes, ReportScope } from "@/lib/reports/reports_service";

import { RangePicker } from "../range_picker";

// One picker is mounted at a time (each DateField renders its dialog only
// while open), so a single pair of module-level slots always describes the
// dialog currently on screen. Recording the bounds is the point: a
// `minimumDate`/`maximumDate` nothing reads back would let the props be
// deleted with every test still green.
let mockPickedDate = new Date(2026, 7, 1);
let mockReceivedMinimumDate: Date | undefined;
let mockReceivedMaximumDate: Date | undefined;

jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({
      onChange,
      minimumDate,
      maximumDate,
    }: {
      onChange: (event: { type: string }, date?: Date) => void;
      minimumDate?: Date;
      maximumDate?: Date;
    }) => {
      mockReceivedMinimumDate = minimumDate;
      mockReceivedMaximumDate = maximumDate;
      return (
        <>
          <Pressable
            testID="date-picker-pick"
            onPress={() => onChange({ type: "set" }, mockPickedDate)}
          >
            <Text>pick</Text>
          </Pressable>
          <Pressable
            testID="date-picker-cancel"
            onPress={() => onChange({ type: "dismissed" }, undefined)}
          >
            <Text>cancel</Text>
          </Pressable>
        </>
      );
    },
  };
});

function withTheme(ui: ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

const PLUS_SCOPES: AvailableScopes = { months: ["2026-08"], customAllowed: true };
const MONTH_SCOPE: ReportScope = { kind: "month", month: "2026-08" };

function openCustomForm(onSelectCustom = jest.fn()) {
  withTheme(
    <RangePicker
      scope={MONTH_SCOPE}
      availableScopes={PLUS_SCOPES}
      onSelectMonth={jest.fn()}
      onSelectCustom={onSelectCustom}
    />,
  );
  fireEvent.press(screen.getByTestId("range-picker-custom-toggle"));
  return onSelectCustom;
}

/** Opens a date field, mock-picks the given local day, and closes the dialog. */
function pickDate(testID: string, year: number, month: number, day: number): void {
  mockPickedDate = new Date(year, month - 1, day);
  fireEvent.press(screen.getByTestId(testID));
  fireEvent.press(screen.getByTestId("date-picker-pick"));
}

/** Opens a date field and leaves the dialog up, so its bounds can be read. */
function openPicker(testID: string): void {
  mockReceivedMinimumDate = undefined;
  mockReceivedMaximumDate = undefined;
  fireEvent.press(screen.getByTestId(testID));
}

beforeEach(() => {
  __setTierForTests("plus");
  mockPickedDate = new Date(2026, 7, 1);
  mockReceivedMinimumDate = undefined;
  mockReceivedMaximumDate = undefined;
});

afterEach(() => {
  __setTierForTests(null);
});

test("Apply is disabled and inert with both fields empty", () => {
  const onSelectCustom = openCustomForm();

  const apply = screen.getByTestId("range-picker-custom-apply");
  expect(apply.props.accessibilityState.disabled).toBe(true);

  fireEvent.press(apply);
  expect(onSelectCustom).not.toHaveBeenCalled();
});

test("Apply is disabled and inert when from is after to", () => {
  const onSelectCustom = openCustomForm();

  // Reached by picking the START first, while it still has no upper bound —
  // then giving the END an earlier day the real dialog would have refused.
  // The point is that the string check catches it even so.
  pickDate("range-picker-custom-from", 2026, 8, 15);
  pickDate("range-picker-custom-to", 2026, 8, 1);

  const apply = screen.getByTestId("range-picker-custom-apply");
  expect(apply.props.accessibilityState.disabled).toBe(true);

  fireEvent.press(apply);
  expect(onSelectCustom).not.toHaveBeenCalled();
});

test("Apply is disabled while only one of the two dates has been picked", () => {
  // Replaces the old "doesn't match YYYY-MM-DD" case: a DateField emits
  // through `toDateIso`, so a malformed string is no longer reachable through
  // the UI at all. HALF-FILLED still is, and it is the same guard — the
  // pattern test is what rejects the untouched `""`.
  const onSelectCustom = openCustomForm();

  pickDate("range-picker-custom-from", 2026, 8, 1);

  const apply = screen.getByTestId("range-picker-custom-apply");
  expect(apply.props.accessibilityState.disabled).toBe(true);

  fireEvent.press(apply);
  expect(onSelectCustom).not.toHaveBeenCalled();
});

test("Apply is active and calls onSelectCustom with a valid from <= to pair", () => {
  const onSelectCustom = openCustomForm();

  pickDate("range-picker-custom-from", 2026, 8, 1);
  pickDate("range-picker-custom-to", 2026, 8, 15);

  const apply = screen.getByTestId("range-picker-custom-apply");
  expect(apply.props.accessibilityState.disabled).toBe(false);

  fireEvent.press(apply);
  expect(onSelectCustom).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-15" });
});

test("Apply is active when from equals to", () => {
  const onSelectCustom = openCustomForm();

  pickDate("range-picker-custom-from", 2026, 8, 1);
  pickDate("range-picker-custom-to", 2026, 8, 1);

  const apply = screen.getByTestId("range-picker-custom-apply");
  expect(apply.props.accessibilityState.disabled).toBe(false);

  fireEvent.press(apply);
  expect(onSelectCustom).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-01" });
});

// ---------------------------------------------------------------------------
// The two fields bound each other (numeric-input-system Task 14)
// ---------------------------------------------------------------------------

test("the start field cannot be set past the end date", () => {
  openCustomForm();

  pickDate("range-picker-custom-to", 2026, 8, 19);
  openPicker("range-picker-custom-from");

  // The bound is handed to the DIALOG, so an invalid pair is unreachable
  // rather than merely rejected afterwards.
  expect(mockReceivedMaximumDate).toEqual(new Date(2026, 7, 19));
  // And only in that direction: a start date has no floor.
  expect(mockReceivedMinimumDate).toBeUndefined();
});

test("the end field cannot be set before the start date", () => {
  openCustomForm();

  pickDate("range-picker-custom-from", 2026, 8, 1);
  openPicker("range-picker-custom-to");

  expect(mockReceivedMinimumDate).toEqual(new Date(2026, 7, 1));
  expect(mockReceivedMaximumDate).toBeUndefined();
});

test("neither field is bounded while the other is still empty", () => {
  // A bound derived from `""` would be an Invalid Date, and a dialog handed
  // one refuses every day on the calendar — the form would look broken on the
  // very first tap.
  openCustomForm();

  openPicker("range-picker-custom-from");
  expect(mockReceivedMaximumDate).toBeUndefined();
  fireEvent.press(screen.getByTestId("date-picker-cancel"));

  openPicker("range-picker-custom-to");
  expect(mockReceivedMinimumDate).toBeUndefined();
});

test("the hint no longer tells the user to type a format they cannot type", () => {
  openCustomForm();

  const hint = screen.getByTestId("range-picker-custom-hint");
  // "Enter both dates as YYYY-MM-DD" described a TextInput. These are
  // calendar dialogs — the instruction is now an instruction to do something
  // impossible, which is worse than no instruction at all.
  expect(hint).not.toHaveTextContent("YYYY-MM-DD");
  expect(hint).toHaveTextContent("Pick both dates to apply a custom range.");
});
