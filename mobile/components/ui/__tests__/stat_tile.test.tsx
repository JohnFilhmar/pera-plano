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

// ---------------------------------------------------------------------------
// F1's regression, guarded structurally — mobile-ui-revamp Part 2 Task 2/3.
// ---------------------------------------------------------------------------
//
// The two tests above did NOT actually prove F1 stays fixed. Both read
// `t-amount`'s `className` — a string authored on the JSX in this file,
// present whether or not the fix holds — because RNTL inspects the props on
// the React element tree, never a resolved colour. Reverting to the original
// bug (wrap `<AmountText amount={amount} />` in a toned `<Text>`) would put
// `TONE_CLASS[tone]` back on an ancestor `<Text>` and `AmountText`'s own,
// always-present colour class on the child `<Text>` it renders — and in React
// Native a nested `<Text>`'s own explicit style wins over its ancestor's for
// the range it covers. `t-amount` would still exist, still carry the toned
// `className` on the OUTER `<Text>`, and both tests above would still pass,
// green, over three identical grey numbers.
//
// Home's tri-tile row (app/(tabs)/index.tsx) is StatTile's first real
// consumer and signals state entirely through `tone` — Spent so far turns
// `danger` once a limit is blown, `warn` once it is close. A silent revert of
// F1 would not fail a single existing test; it would just make that signal
// disappear. The only assertion that actually depends on the fix rather than
// merely being compatible with it is a STRUCTURAL one: `t-amount`'s own child
// must be the formatted string itself, not a nested element that could be
// quietly carrying (and overriding) its own colour underneath it.
test("the toned amount's child is the formatted string itself, not a nested element — guards F1 from a silent revert", () => {
  render(<StatTile testID="t" label="Spent so far" amount={1031200} tone="danger" />);
  const amountText = screen.getByTestId("t-amount");
  expect(typeof amountText.props.children).toBe("string");
  expect(amountText.props.children).toBe("₱10,312.00");
});
