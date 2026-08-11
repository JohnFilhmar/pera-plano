// components/ui/__tests__/amount_text.test.tsx — m1c plan Task 1.
//
// This is the only money formatter in the app (Global Constraints: "Never
// format money anywhere else"), so every screen built after this one inherits
// whatever it gets wrong. Two of these tests are load-bearing well beyond this
// file:
//
//   - formatCentavos(5) === "₱0.05" is the regression test for the whole
//     integer-centavos discipline. If centavos are ever read as pesos, every
//     amount in the app is wrong by 100x and nothing throws.
//   - an `out` amount renders U+2212 MINUS, not a hyphen. A hyphen is narrower
//     than a digit, so a right-aligned column of amounts visibly wobbles.
import { render, screen } from "@testing-library/react-native";
import { AmountText, formatCentavos } from "../amount_text";

const MINUS = "−";

// ---------------------------------------------------------------------------
// formatCentavos
// ---------------------------------------------------------------------------

test.each([
  [123456, "₱1,234.56"],
  [0, "₱0.00"],
  // Centavo precision. "₱5.00" or "₱0.5" here means the integer-centavos
  // contract has been broken somewhere upstream of the display layer.
  [5, "₱0.05"],
  [50, "₱0.50"],
  [-123456, "-₱1,234.56"],
  [100000000, "₱1,000,000.00"],
])("formatCentavos(%i) is %s", (centavos, expected) => {
  expect(formatCentavos(centavos)).toBe(expected);
});

test("a negative amount signs the whole figure, not the digits after the peso mark", () => {
  // "₱-1,234.56" reads as a currency called "₱-" and breaks alignment in a
  // right-aligned column, which is where amounts always live.
  expect(formatCentavos(-1)).toBe("-₱0.01");
  expect(formatCentavos(-1)).not.toContain("₱-");
});

// ---------------------------------------------------------------------------
// AmountText
// ---------------------------------------------------------------------------

function classesOf(testID: string): string {
  return String(screen.getByTestId(testID).props.className ?? "");
}

test("an in amount renders a + and the brand color", () => {
  render(<AmountText testID="amt" amount={123456} direction="in" />);

  expect(screen.getByTestId("amt")).toHaveTextContent(`+₱1,234.56`);
  expect(classesOf("amt")).toContain("text-brand");
  expect(classesOf("amt")).toContain("dark:text-brand-dark");
});

test("an out amount renders a true minus, not a hyphen", () => {
  render(<AmountText testID="amt" amount={123456} direction="out" />);

  const rendered = screen.getByTestId("amt");
  expect(rendered).toHaveTextContent(`${MINUS}₱1,234.56`);
  // The specific failure this guards: a hyphen looks almost identical here and
  // is wrong at every other size.
  expect(String(rendered.props.children)).not.toContain("-₱");
});

test("an out amount is NOT red — ordinary spending is not an error state", () => {
  render(<AmountText testID="amt" amount={123456} direction="out" />);

  expect(classesOf("amt")).toContain("text-fg");
  expect(classesOf("amt")).not.toContain("danger");
});

test("muted overrides the direction color, both ways", () => {
  // A transfer leg is excluded from every spend total, so it must never read
  // as ordinary spending — or as income.
  render(<AmountText testID="out" amount={1000} direction="out" muted />);
  expect(classesOf("out")).toContain("text-fg-2");
  expect(classesOf("out")).not.toContain("text-brand");

  screen.unmount();

  render(<AmountText testID="in" amount={1000} direction="in" muted />);
  expect(classesOf("in")).toContain("text-fg-2");
  expect(classesOf("in")).not.toContain("text-brand");
});

test("showSign false renders no sign at all", () => {
  render(<AmountText testID="amt" amount={123456} direction="out" showSign={false} />);

  const rendered = screen.getByTestId("amt");
  expect(rendered).toHaveTextContent("₱1,234.56");
  expect(String(rendered.props.children)).not.toContain(MINUS);
  expect(String(rendered.props.children)).not.toContain("+");
});

test("no direction renders no sign, and the neutral color", () => {
  // A wallet balance has no direction — it is a position, not a movement.
  render(<AmountText testID="amt" amount={123456} />);

  expect(screen.getByTestId("amt")).toHaveTextContent("₱1,234.56");
  expect(classesOf("amt")).toContain("text-fg");
});

test("every size renders, and hero is the largest", () => {
  // `hero` is the Safe-to-Spend number on Home (rule 4).
  const sizes = ["sm", "md", "lg", "hero"] as const;
  for (const size of sizes) {
    render(<AmountText testID={`amt-${size}`} amount={100} size={size} />);
    expect(screen.getByTestId(`amt-${size}`)).toHaveTextContent("₱1.00");
  }
});

test("no hard-coded hex reaches the rendered output", () => {
  // Global Constraints: contract §2 tokens only, so light and dark follow
  // automatically. A literal colour renders identically in both themes.
  render(<AmountText testID="amt" amount={123456} direction="in" />);

  const rendered = screen.getByTestId("amt");
  expect(classesOf("amt")).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  expect(JSON.stringify(rendered.props.style ?? {})).not.toMatch(/#[0-9a-fA-F]{3,8}/);
});
