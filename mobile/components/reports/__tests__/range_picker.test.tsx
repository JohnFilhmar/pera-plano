// components/reports/__tests__/range_picker.test.tsx — fix-wave FIX 2.
//
// The custom-range Apply button had no validation: `from`/`to` default to
// `""`, and pressing Apply immediately produced a query that degrades to
// zero rows, showing "No transactions in this period" — a misleading
// message when the real problem was invalid input, not missing data.
// Nothing crashes either way (Number.isFinite / SQLite's NaN comparisons
// close the range on their own), so this file pins the UI-level guard:
// Apply stays disabled — and inert on press — until both fields match
// `YYYY-MM-DD` and `from <= to`.
//
// RangePicker's own tier-gating behaviour (rule 5, the PlusGate wrapping,
// month pills vs. the free static label) is already pinned in
// charts.test.tsx; this file only covers the Apply-button guard.
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";
import { __setTierForTests } from "@/lib/entitlements";
import type { AvailableScopes, ReportScope } from "@/lib/reports/reports_service";

import { RangePicker } from "../range_picker";

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

beforeEach(() => {
  __setTierForTests("plus");
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

  fireEvent.changeText(screen.getByTestId("range-picker-custom-from"), "2026-08-15");
  fireEvent.changeText(screen.getByTestId("range-picker-custom-to"), "2026-08-01");

  const apply = screen.getByTestId("range-picker-custom-apply");
  expect(apply.props.accessibilityState.disabled).toBe(true);

  fireEvent.press(apply);
  expect(onSelectCustom).not.toHaveBeenCalled();
});

test("Apply is disabled when a field doesn't match YYYY-MM-DD", () => {
  const onSelectCustom = openCustomForm();

  fireEvent.changeText(screen.getByTestId("range-picker-custom-from"), "2026/08/01");
  fireEvent.changeText(screen.getByTestId("range-picker-custom-to"), "2026-08-15");

  const apply = screen.getByTestId("range-picker-custom-apply");
  expect(apply.props.accessibilityState.disabled).toBe(true);

  fireEvent.press(apply);
  expect(onSelectCustom).not.toHaveBeenCalled();
});

test("Apply is active and calls onSelectCustom with a valid from <= to pair", () => {
  const onSelectCustom = openCustomForm();

  fireEvent.changeText(screen.getByTestId("range-picker-custom-from"), "2026-08-01");
  fireEvent.changeText(screen.getByTestId("range-picker-custom-to"), "2026-08-15");

  const apply = screen.getByTestId("range-picker-custom-apply");
  expect(apply.props.accessibilityState.disabled).toBe(false);

  fireEvent.press(apply);
  expect(onSelectCustom).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-15" });
});

test("Apply is active when from equals to", () => {
  const onSelectCustom = openCustomForm();

  fireEvent.changeText(screen.getByTestId("range-picker-custom-from"), "2026-08-01");
  fireEvent.changeText(screen.getByTestId("range-picker-custom-to"), "2026-08-01");

  const apply = screen.getByTestId("range-picker-custom-apply");
  expect(apply.props.accessibilityState.disabled).toBe(false);

  fireEvent.press(apply);
  expect(onSelectCustom).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-01" });
});
