import { render, screen } from "@testing-library/react-native";

import { StatTile } from "../stat_tile";

test("a tile shows its label and its formatted amount", () => {
  render(<StatTile testID="t" label="Balance" amount={539000} />);
  screen.getByText("Balance");
  expect(screen.getByTestId("t")).toHaveTextContent("₱5,390.00");
});

test("tone colours the amount, never the label", () => {
  render(<StatTile testID="t" label="Spent so far" amount={1031200} tone="danger" />);
  expect(String(screen.getByTestId("t-amount").props.className)).toContain("text-danger");
  expect(String(screen.getByTestId("t-label").props.className)).toContain("text-fg-2");
});
