// components/review/__tests__/review_queue_entry.test.tsx — whole-branch
// review design finding F7. This component had no dedicated test file before
// this fix; the cases below cover the contrast regression the fix closes,
// anchored on a positive render assertion first (a guard built only of
// negative assertions passes against a component that renders nothing).
import { render, screen } from "@testing-library/react-native";
import { ChevronRight } from "lucide-react-native";

import { ReviewQueueEntry, reviewQueueEntrySubtitle } from "../review_queue_entry";

test("renders the count as its label — the positive case every other assertion here builds on", () => {
  render(<ReviewQueueEntry count={3} onPress={() => {}} />);
  expect(screen.getByText("3 need a quick check")).toBeTruthy();
});

test("renders nothing for a zero, undefined, or non-finite count", () => {
  const { unmount } = render(<ReviewQueueEntry count={0} onPress={() => {}} />);
  expect(screen.queryByTestId("review-queue-entry")).toBeNull();
  unmount();

  render(<ReviewQueueEntry count={undefined} onPress={() => {}} />);
  expect(screen.queryByTestId("review-queue-entry")).toBeNull();
});

test("reviewQueueEntrySubtitle is singular for exactly one", () => {
  expect(reviewQueueEntrySubtitle(1)).toBe("1 needs a quick check");
  expect(reviewQueueEntrySubtitle(2)).toBe("2 need a quick check");
});

// Design F7 regression: this banner's `bg-brand-soft` fill needs `brand-ink`,
// not the bare `brand` two new files each independently reintroduced —
// `components/gates/plus_gate.tsx` already measured that exact pairing at a
// bare 4.567:1 (constants/colors.ts) and moved to `brand-ink` (6.49:1) for
// real headroom. lib/ui/__tests__/contrast.test.ts pins the numbers; this
// pins that the component actually uses the token that carries them.
test("the label inks with brand-ink, not the bare brand tone the bg-brand-soft fill has no headroom against", () => {
  render(<ReviewQueueEntry count={3} onPress={() => {}} />);
  const label = screen.getByText("3 need a quick check");
  expect(String(label.props.className)).toContain("text-brand-ink");
});

// The chevron is registered via `cssInterop` (registerIcon), which inserts a
// wrapper that consumes `className` before it reaches the real `ChevronRight`
// element — asserting on `ChevronRight` itself would read `{ ref, size }`
// only. Walking up to `.parent` reads the node NativeWind actually resolves
// colour on, the same technique `components/ui/__tests__/error_state.test.tsx`
// uses for the identical trap.
test("the chevron inks with brand-ink too, on the node that actually renders its colour", () => {
  render(<ReviewQueueEntry count={3} onPress={() => {}} />);
  const icon = screen.UNSAFE_getByType(ChevronRight);
  expect(String(icon.parent?.props.className)).toContain("text-brand-ink");
});

test("carries the count as its accessibility label, not a generic one", () => {
  render(<ReviewQueueEntry count={5} onPress={() => {}} />);
  expect(screen.getByTestId("review-queue-entry").props.accessibilityLabel).toBe(
    "5 need a quick check",
  );
});
