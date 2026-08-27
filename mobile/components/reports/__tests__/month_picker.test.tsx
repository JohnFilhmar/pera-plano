// components/reports/__tests__/month_picker.test.tsx
//
// THE DEFECT THIS FILE PINS. The period control used to be a horizontal
// ScrollView over `availableScopes().months`, which the service returns
// OLDEST FIRST. A ScrollView starts at offset 0, so Reports opened showing a
// month from last year while the month it was actually reporting on sat off
// the right edge — never scrolled to, never visibly selected. The tests below
// are all about the one thing that replaced it: which year the sheet opens on,
// and that the selected month is visible and marked without anyone scrolling.
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { ThemeProvider } from "@/contexts/theme_context";

import { MonthPicker } from "../month_picker";

/** A trailing-12 window ending Aug 2026 — the shape `availableScopes` emits. */
const MONTHS_12 = [
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
];

function withTheme(ui: ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function open(props: Partial<Parameters<typeof MonthPicker>[0]> = {}) {
  const onSelect = jest.fn();
  const utils = withTheme(
    <MonthPicker
      visible
      value="2026-08"
      months={MONTHS_12}
      onDismiss={jest.fn()}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { onSelect, ...utils };
}

test("the sheet opens on the SELECTED month's year, not the oldest one offered", () => {
  open();

  // The old strip's answer was 2025 — offset 0 of an oldest-first list.
  expect(screen.getByTestId("range-picker-year")).toHaveTextContent("2026");
  expect(
    screen.getByTestId("range-picker-month-2026-08").props.accessibilityState.selected,
  ).toBe(true);
});

test("a selected month in the earlier year opens on THAT year", () => {
  open({ value: "2025-11" });

  expect(screen.getByTestId("range-picker-year")).toHaveTextContent("2025");
  expect(
    screen.getByTestId("range-picker-month-2025-11").props.accessibilityState.selected,
  ).toBe(true);
});

test("with a custom range applied the sheet opens on the NEWEST year, not the oldest", () => {
  // `value` is null while a custom range is what's on screen. Falling back to
  // the oldest year would reproduce the original defect for exactly the users
  // who had used the Plus feature.
  open({ value: null });

  expect(screen.getByTestId("range-picker-year")).toHaveTextContent("2026");
});

test("every month of the shown year is drawn, with the ones outside the window disabled", () => {
  open();

  // Jan–Aug 2026 are in the window; Sep–Dec 2026 are in the FUTURE and are
  // drawn dimmed rather than omitted — a grid missing four cells reads as a
  // rendering bug.
  expect(screen.getByTestId("range-picker-month-2026-08").props.accessibilityState.disabled).toBe(
    false,
  );
  expect(screen.getByTestId("range-picker-month-2026-12").props.accessibilityState.disabled).toBe(
    true,
  );
});

test("a month outside the window is inert on press", () => {
  const { onSelect } = open();

  fireEvent.press(screen.getByTestId("range-picker-month-2026-12"));
  expect(onSelect).not.toHaveBeenCalled();
});

test("picking a month reports it as 'YYYY-MM'", () => {
  const { onSelect } = open();

  fireEvent.press(screen.getByTestId("range-picker-month-2026-03"));
  expect(onSelect).toHaveBeenCalledWith("2026-03");
});

test("the year stepper walks the window and stops at both ends", () => {
  const { onSelect } = open();

  expect(screen.getByTestId("range-picker-year-next").props.accessibilityState.disabled).toBe(true);

  fireEvent.press(screen.getByTestId("range-picker-year-prev"));
  expect(screen.getByTestId("range-picker-year")).toHaveTextContent("2025");
  expect(screen.getByTestId("range-picker-year-prev").props.accessibilityState.disabled).toBe(true);

  // Sep 2025 is the oldest month in the window and reachable in one step.
  fireEvent.press(screen.getByTestId("range-picker-month-2025-09"));
  expect(onSelect).toHaveBeenCalledWith("2025-09");
});

test("reopening re-anchors on the selected month's year rather than where it was left", () => {
  const { rerender } = withTheme(
    <MonthPicker
      visible
      value="2026-08"
      months={MONTHS_12}
      onDismiss={jest.fn()}
      onSelect={jest.fn()}
    />,
  );

  fireEvent.press(screen.getByTestId("range-picker-year-prev"));
  expect(screen.getByTestId("range-picker-year")).toHaveTextContent("2025");

  const sheet = (visible: boolean) => (
    <ThemeProvider>
      <MonthPicker
        visible={visible}
        value="2026-08"
        months={MONTHS_12}
        onDismiss={jest.fn()}
        onSelect={jest.fn()}
      />
    </ThemeProvider>
  );
  rerender(sheet(false));
  rerender(sheet(true));

  expect(screen.getByTestId("range-picker-year")).toHaveTextContent("2026");
});

test("a one-month window (Free's list) still renders that month selectable", () => {
  const { onSelect } = open({ value: "2026-08", months: ["2026-08"] });

  expect(screen.getByTestId("range-picker-year")).toHaveTextContent("2026");
  expect(screen.getByTestId("range-picker-year-prev").props.accessibilityState.disabled).toBe(true);
  expect(screen.getByTestId("range-picker-year-next").props.accessibilityState.disabled).toBe(true);

  fireEvent.press(screen.getByTestId("range-picker-month-2026-08"));
  expect(onSelect).toHaveBeenCalledWith("2026-08");
});
