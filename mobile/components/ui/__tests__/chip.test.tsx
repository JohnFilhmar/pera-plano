import { render, screen } from "@testing-library/react-native";
import { Pressable } from "react-native";

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

// ---------------------------------------------------------------------------
// selected — Gap 1: selection state is invisible to assistive tech without it
// ---------------------------------------------------------------------------

test("selected drives accessibilityState.selected; a chip that never passes it is unchanged from today", () => {
  // Asserted on the exact node `testID` names, which is the real Pressable —
  // not a NativeWind wrapper: this file's own `stylesOf`/className assertions
  // above already depend on `getByTestId("c")` being the real styled node,
  // and accessibilityState/hitSlop are plain sibling props on that same JSX
  // element in chip.tsx, not something a className-focused interop would
  // relocate.
  //
  // Read as `.accessibilityState.selected`, not a deep-equal on the whole
  // object: React Native's own `Pressable` normalizes `accessibilityState`
  // on the host node to a fixed five-key shape (busy/checked/disabled/
  // expanded/selected) regardless of what is passed in — pinning the other
  // four keys here would couple this test to that RN-internal shape rather
  // than to Chip's own contract.
  render(<Chip testID="c" label="This month" onPress={() => {}} selected />);
  expect(screen.getByTestId("c").props.accessibilityState.selected).toBe(true);
  screen.unmount();

  render(<Chip testID="c" label="This month" onPress={() => {}} selected={false} />);
  expect(screen.getByTestId("c").props.accessibilityState.selected).toBe(false);
  screen.unmount();

  // No `selected` at all — the "as before" case. `.selected` reads
  // `undefined` here exactly as it always has, whether or not chip.tsx's own
  // JSX writes an `accessibilityState` prop at all — confirmed empirically
  // against the pre-`selected` component while writing this test.
  render(<Chip testID="c" label="This month" onPress={() => {}} />);
  expect(screen.getByTestId("c").props.accessibilityState.selected).toBeUndefined();
});

/** Normalizes RN's `hitSlop` (a single number, or a partial Insets object)
 *  into four numbers — does not assume chip.tsx's current choice of shape. */
function hitSlopInsets(testID: string): { top: number; bottom: number; left: number; right: number } {
  const hitSlop = screen.getByTestId(testID).props.hitSlop;
  const side = (key: "top" | "bottom" | "left" | "right") =>
    typeof hitSlop === "number" ? hitSlop : (hitSlop?.[key] ?? 0);
  return { top: side("top"), bottom: side("bottom"), left: side("left"), right: side("right") };
}

test("a pressable chip carries a hitSlop that reaches 44x44 vertically, for both the solid/soft and outline painted heights", () => {
  // Vertical is the axis `list_row.tsx`'s 44pt floor is actually about, and
  // the one this Jest render (no real layout pass) can compute exactly,
  // content-independent: `py-1` (4px + 4px) around `text-micro`'s 14px
  // line-height (tailwind.config.ts's `fontSize.micro`) paints a SOLID/SOFT
  // pill 22px tall; OUTLINE adds its `border` utility's 1px top + 1px
  // bottom, painting 24px tall. Both are checked — chip.tsx's own
  // `CHIP_HIT_SLOP` comment states both, and a hitSlop tuned for only one of
  // them would be exactly the kind of gap a single-fill test would miss.
  render(<Chip testID="solid" label="Bills" onPress={() => {}} />);
  const solid = hitSlopInsets("solid");
  expect(22 + solid.top + solid.bottom).toBeGreaterThanOrEqual(44);
  screen.unmount();

  render(<Chip testID="outline" label="Bills" fill="outline" onPress={() => {}} />);
  const outline = hitSlopInsets("outline");
  expect(24 + outline.top + outline.bottom).toBeGreaterThanOrEqual(44);
});

test("hitSlop's horizontal component is capped at half the app's chip-row gap, so neighbouring chips' touch regions meet rather than overlap", () => {
  // Fix round 1 (review of commit 387bcd6): a uniform hitSlop reached past a
  // chip's own painted pill and into the NEXT chip's, because every real
  // chip row in this app wraps its chips in `gap-2` (8px) — verified
  // directly against limit_form.tsx, due_rule_picker.tsx, filter_bar.tsx,
  // income_form.tsx, goal_form.tsx, income_quick_form.tsx,
  // quick_wallet_list.tsx and captured_list.tsx while writing this fix, not
  // assumed. Two adjacent Pressables' responder regions overlapping means a
  // mis-tap can silently apply the WRONG filter or picker value — worse than
  // a slightly-small target, which a user notices and retries. This test
  // pins the guard: if `left`/`right` are ever widened back past half the
  // gap, two neighbours' regions overlap again and this must go red.
  const ROW_GAP = 8;
  render(<Chip testID="c" label="Bills" onPress={() => {}} />);
  const { left, right } = hitSlopInsets("c");
  expect(left).toBeLessThanOrEqual(ROW_GAP / 2);
  expect(right).toBeLessThanOrEqual(ROW_GAP / 2);
  // Still a real target, not zeroed out chasing the overlap fix.
  expect(left).toBeGreaterThan(0);
  expect(right).toBeGreaterThan(0);
});

test("a static chip carries neither accessibilityState nor hitSlop, and stays a plain View", () => {
  // `selected` passed with NO `onPress` — the one call site this shape
  // actually occurs at is components/onboarding/quick_wallet_list.tsx's type
  // row, whose `onPress` is conditionally `undefined` while `selected` is
  // always passed. Nothing here should throw, and nothing should attach.
  render(<Chip testID="c" label="Groceries" selected />);
  const node = screen.getByTestId("c");

  expect(node.props.accessibilityState).toBeUndefined();
  expect(node.props.hitSlop).toBeUndefined();
  // The host node itself is a `View`, never a `Pressable` — confirmed by
  // type, not merely inferred from an absent prop. `node.type` is the raw
  // host-primitive name here ("View"), one level below the `View` component
  // reference react-native exports, so it is compared as a string rather
  // than by reference to that export — dumped via `screen.toJSON()` while
  // writing this test to confirm the shape: `{ type: "View", props:
  // { testID, className }, children: [{ type: "Text", ... }] }`, nothing
  // Pressable-shaped anywhere in it.
  expect(node.type).toBe("View");
  expect(screen.UNSAFE_queryAllByType(Pressable)).toHaveLength(0);
});
