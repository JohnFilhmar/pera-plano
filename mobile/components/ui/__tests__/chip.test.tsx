import { render, screen } from "@testing-library/react-native";

import { Chip } from "../chip";

function stylesOf(testID: string): Record<string, unknown> {
  const style = screen.getByTestId(testID).props.style;
  return Array.isArray(style) ? Object.assign({}, ...style) : (style ?? {});
}

test("solid is the default fill, so every existing call site is unchanged", () => {
  render(<Chip testID="c" label="Bills" tone="brand" />);
  const containerClasses = String(screen.getByTestId("c").props.className);
  expect(containerClasses).toContain("bg-brand");
  // Geometry too, not only colour: this branch changed it app-wide (padding
  // px-2 py-0.5 -> px-2.5 py-1, label text-xs -> text-micro), and a test
  // titled "every existing call site is unchanged" that checks only a
  // colour class is not actually backing that claim.
  expect(containerClasses).toContain("rounded-full");
  expect(containerClasses).toContain("px-2.5");
  expect(containerClasses).toContain("py-1");
  expect(String(screen.getByTestId("c-label").props.className)).toContain("text-micro");
});

test("a soft chip paints a translucent tint, not the solid token", () => {
  render(<Chip testID="c" label="due today" tone="warn" fill="soft" />);
  expect(String(stylesOf("c").backgroundColor)).toContain("rgba(217, 119, 6");
});

test("soft warn inks with warn-ink, never warn", () => {
  render(<Chip testID="c" label="due today" tone="warn" fill="soft" />);
  expect(String(screen.getByTestId("c-label").props.className)).toContain("text-warn-ink");
});

test("soft brand inks with brand-ink, never brand", () => {
  render(<Chip testID="c" label="Catches: GCash" tone="brand" fill="soft" />);
  expect(String(screen.getByTestId("c-label").props.className)).toContain("text-brand-ink");
});

test("soft danger inks with danger-ink, never danger", () => {
  render(<Chip testID="c" label="overdue 2d" tone="danger" fill="soft" />);
  expect(String(screen.getByTestId("c-label").props.className)).toContain("text-danger-ink");
});

test("an outline chip has a border and no fill", () => {
  render(<Chip testID="c" label="SOON" tone="neutral" fill="outline" />);
  const classes = String(screen.getByTestId("c").props.className);
  expect(classes).toContain("border");
  expect(classes).toContain("border-line");
  expect(classes).toContain("bg-chip");
});

test("soon ignores fill entirely and stays solid grey", () => {
  render(<Chip testID="c" label="SOON" tone="soon" fill="soft" />);
  const classes = String(screen.getByTestId("c").props.className);
  expect(classes).toContain("bg-fg-2");
  expect(stylesOf("c").backgroundColor).toBeUndefined();
});

test("neutral ignores soft fill and stays solid, rather than rendering transparent", () => {
  // `SOFT_TINT`/`SOFT_INK` have no `neutral` entry — `neutral` is the only
  // unfilled tone by design — so `tone="neutral" fill="soft"` used to paint
  // no background and no border at all: label text on a fully transparent
  // pill.
  render(<Chip testID="c" label="Groceries" tone="neutral" fill="soft" />);
  const classes = String(screen.getByTestId("c").props.className);
  expect(classes).toContain("bg-bg");
  expect(stylesOf("c").backgroundColor).toBeUndefined();
});
