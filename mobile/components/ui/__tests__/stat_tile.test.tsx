import { render, screen } from "@testing-library/react-native";

import { StatTile } from "../stat_tile";

test("a tile shows its label and its formatted amount", () => {
  render(<StatTile testID="t" label="Balance" amount={539000} />);
  screen.getByText("Balance");
  // `toHaveTextContent` with a plain string requires the queried element's
  // ENTIRE flattened subtree text to match exactly — the bare tile testID
  // covers both the label and the amount, so a literal "₱5,390.00" can never
  // match ("Balance₱5,390.00" is the true flattened text). A regex uses
  // `.test()` instead, which matches a substring anywhere — the same reason
  // this codebase already reaches for a regex elsewhere (see
  // wallet_routes.test.tsx's `toHaveTextContent(/gcash/i)`).
  expect(screen.getByTestId("t")).toHaveTextContent(/₱5,390\.00/);
});

test("tone colours the amount, never the label", () => {
  render(<StatTile testID="t" label="Spent so far" amount={1031200} tone="danger" />);
  // `t-amount` is the Text that actually renders the glyphs — StatTile no
  // longer nests a separate `AmountText` Text inside it (F1), so this
  // element's className is the rendered colour, not a wrapper's.
  const amountText = screen.getByTestId("t-amount");
  expect(amountText).toHaveTextContent("₱10,312.00");
  expect(String(amountText.props.className)).toContain("text-danger");
  expect(String(screen.getByTestId("t-label").props.className)).toContain("text-fg-2");
});
