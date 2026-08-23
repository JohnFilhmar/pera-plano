import { render, screen } from "@testing-library/react-native";

import { Button } from "../button";

function classesOf(testID: string): string {
  return String(screen.getByTestId(testID).props.className ?? "");
}

test("outline-destructive is a bordered surface, not a red fill", () => {
  render(<Button testID="b" title="Wipe everything" variant="outline-destructive" onPress={() => {}} />);
  const classes = classesOf("b");
  expect(classes).toContain("border-danger");
  expect(classes).toContain("bg-surface");
  expect(classes).not.toContain("bg-danger");
});

test("destructive is still a solid fill, so existing call sites are unchanged", () => {
  render(<Button testID="b" title="Archive" variant="destructive" onPress={() => {}} />);
  expect(classesOf("b")).toContain("bg-danger");
});

test("every variant is a pill", () => {
  for (const variant of ["primary", "secondary", "ghost", "destructive", "outline-destructive"] as const) {
    render(<Button testID={`b-${variant}`} title="x" variant={variant} onPress={() => {}} />);
    expect(classesOf(`b-${variant}`)).toContain("rounded-full");
  }
});

test("a disabled button reads as disabled to assistive tech and looks it", () => {
  render(<Button testID="b" title="Save" onPress={() => {}} disabled />);
  expect(screen.getByTestId("b").props.accessibilityState).toMatchObject({ disabled: true });
  expect(classesOf("b")).toContain("opacity-40");
});

test("iconOnly requires an icon at the type level", () => {
  // `@ts-expect-error` IS the enforcement here: `npm run typecheck` fails the
  // moment `icon` stops being required whenever `iconOnly` is `true` (see the
  // discriminated `ButtonProps` in ../button.tsx). Before that type existed,
  // this exact call compiled clean and rendered a blank-but-tappable 44x44
  // pill — no icon, no label, live `onPress` underneath nothing on screen.
  render(
    // @ts-expect-error - iconOnly: true requires icon.
    <Button testID="b" title="Delete" onPress={() => {}} iconOnly />,
  );
  screen.getByTestId("b");
});

// Design F7's sweep: `secondary`'s fill is `bg-brand-soft` (VARIANT_BG), an
// opaque token the bare `brand` tone only clears WCAG AA against at a bare
// 4.567:1 (constants/colors.ts) — the identical fragile pairing
// components/gates/plus_gate.tsx already measured and moved off of.
// `ghost`'s label stays the bare `brand` deliberately: its fill is
// `bg-transparent`, not a soft tint, so the ink-token rule does not apply to
// it — asserted here as the contrasting case, not merely assumed safe.
test("secondary's label and icon ink with brand-ink — brand-soft has no headroom for the bare tone", () => {
  render(<Button testID="b" title="Skip" variant="secondary" onPress={() => {}} />);
  expect(String(screen.getByText("Skip").props.className)).toContain("text-brand-ink");
});

test("ghost keeps the bare brand tone — its fill is transparent, not brand-soft", () => {
  render(<Button testID="b" title="Skip" variant="ghost" onPress={() => {}} />);
  const classes = String(screen.getByText("Skip").props.className);
  expect(classes).toContain("text-brand");
  expect(classes).not.toContain("text-brand-ink");
});

test("lg is taller than md", () => {
  // Two renders in one test: `screen` tracks only the most recently rendered
  // tree (primitives.test.tsx's destructive-variant loop hits the same
  // thing), so each size is asserted before the next render replaces it.
  render(<Button testID="md" title="x" onPress={() => {}} />);
  expect(classesOf("md")).toContain("py-2.5");
  screen.unmount();

  render(<Button testID="lg" title="x" size="lg" onPress={() => {}} />);
  expect(classesOf("lg")).toContain("py-3.5");
});
