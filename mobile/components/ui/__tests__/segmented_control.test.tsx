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
