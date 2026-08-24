import { fireEvent, render, screen } from "@testing-library/react-native";

import { SegmentedControl } from "../segmented_control";

const SEGMENTS = [
  { value: "limits", label: "Limits" },
  { value: "goals", label: "Goals" },
  { value: "utang", label: "Utang" },
  { value: "bills", label: "Bills" },
] as const;

test("every segment renders its label", () => {
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="limits" onChange={() => {}} />);
  for (const segment of SEGMENTS) {
    screen.getByText(segment.label);
  }
});

test("the selected segment is filled and announced as selected", () => {
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="goals" onChange={() => {}} />);
  expect(screen.getByTestId("s-goals").props.accessibilityState).toMatchObject({ selected: true });
  expect(String(screen.getByTestId("s-goals").props.className)).toContain("bg-brand");
  expect(screen.getByTestId("s-limits").props.accessibilityState).toMatchObject({ selected: false });
});

test("a segment announces itself as a radio, not a button — one of N, not an action", () => {
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="limits" onChange={() => {}} />);
  expect(screen.getByTestId("s-limits").props.accessibilityRole).toBe("radio");
});

test("pressing a segment reports its value", () => {
  const onChange = jest.fn();
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="limits" onChange={onChange} />);
  fireEvent.press(screen.getByTestId("s-utang"));
  expect(onChange).toHaveBeenCalledWith("utang");
});

test("pressing the already-selected segment does not fire onChange", () => {
  const onChange = jest.fn();
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="limits" onChange={onChange} />);
  fireEvent.press(screen.getByTestId("s-limits"));
  expect(onChange).not.toHaveBeenCalled();
});

test("each segment clears the 44dp touch target", () => {
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="limits" onChange={() => {}} />);
  expect(String(screen.getByTestId("s-limits").props.className)).toContain("min-h-[44px]");
});

test("a value matching no segment selects nothing rather than defaulting to the first", () => {
  render(
    // @ts-expect-error - NoInfer pins T to segments' literal union: a value naming no real segment must fail to compile, not silently render with nothing selected.
    <SegmentedControl testID="s" segments={SEGMENTS} value="not-a-real-segment" onChange={() => {}} />,
  );
  expect(screen.getByTestId("s-limits").props.accessibilityState).toMatchObject({ selected: false });
  expect(screen.getByTestId("s-goals").props.accessibilityState).toMatchObject({ selected: false });
  expect(screen.getByTestId("s-utang").props.accessibilityState).toMatchObject({ selected: false });
  expect(screen.getByTestId("s-bills").props.accessibilityState).toMatchObject({ selected: false });
});
