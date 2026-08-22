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
