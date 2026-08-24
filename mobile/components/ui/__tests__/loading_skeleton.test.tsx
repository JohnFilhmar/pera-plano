import { render, screen } from "@testing-library/react-native";

import { LoadingSkeleton } from "../loading_skeleton";

test("renders the requested number of placeholder rows", () => {
  render(<LoadingSkeleton testID="s" rows={3} />);
  screen.getByTestId("s-row-0");
  screen.getByTestId("s-row-2");
  expect(screen.queryByTestId("s-row-3")).toBeNull();
});

test("the skeleton is announced as busy rather than read out as empty rows", () => {
  render(<LoadingSkeleton testID="s" rows={2} />);
  // Both halves of the pair, not just the label: `accessible` is what
  // collapses the group into one stop for a screen reader in the first
  // place — a label with no `accessible` still reads every row.
  expect(screen.getByTestId("s").props.accessible).toBe(true);
  expect(screen.getByTestId("s").props.accessibilityLabel).toBe("Loading");
});
