import { render, screen } from "@testing-library/react-native";

import { ShareBar } from "../share_bar";

const SHARES = [
  { id: "gcash", label: "GCash", value: 60, color: "#0038A8" },
  { id: "maya", label: "Maya", value: 17, color: "#12B76A" },
  { id: "cash", label: "Cash", value: 23, color: "#15803D" },
];

test("each share renders a segment and a legend entry with its percentage", () => {
  render(<ShareBar testID="s" shares={SHARES} />);
  screen.getByTestId("s-seg-gcash");
  screen.getByText("GCash 60%");
});

test("percentages are computed from the total, not assumed to be percentages", () => {
  render(<ShareBar testID="s" shares={[
    { id: "a", label: "A", value: 1, color: "#000000" },
    { id: "b", label: "B", value: 3, color: "#111111" },
  ]} />);
  screen.getByText("A 25%");
  screen.getByText("B 75%");
});

test("a zero total renders nothing rather than dividing by zero", () => {
  render(<ShareBar testID="s" shares={[{ id: "a", label: "A", value: 0, color: "#000000" }]} />);
  expect(screen.queryByTestId("s-seg-a")).toBeNull();
});
