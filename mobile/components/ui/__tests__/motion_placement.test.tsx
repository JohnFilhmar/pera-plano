// components/ui/__tests__/motion_placement.test.tsx — task-7-brief.md Step 1,
// REWRITTEN. The brief's own draft asserted `screen.getByTestId("e-mark").props.variant`,
// which can never pass: `BrandMark` (components/ui/brand_mark.tsx:145-155)
// BRANCHES on `variant` into one of four sub-components, each of which forwards
// only `size`/`className`/`testID` onward — `variant` itself never reaches a
// host node's props. Its own suggested fallback ("assert on the testID being
// present instead") would make this a vacuous test: it would pass whether the
// mark animates, sits still, or ignores its `variant` prop entirely.
//
// THE DISCRIMINATOR, from brand_mark.test.tsx:44-48 and reused exactly as
// brand_mark_motion.test.tsx uses it: the static branch renders the imported
// `.svg` directly, which arrives under test_support/svg_mock.tsx as a
// prop-forwarding node — so `width`/`height` land in PROPS. Every animated
// branch wraps the mark in Reanimated boxes that carry size in `style`
// instead. A `width` PROP is proof the mark did not animate; its absence is
// proof it did. That is what `isStaticMark` below reads.
//
// THE HARNESS, copied from brand_mark_motion.test.tsx rather than invented:
// `AccessibilityInfo.isReduceMotionEnabled` is spied to resolve `false` by
// default, `addEventListener("reduceMotionChanged", ...)` is faked so a test
// can flip the setting mid-flight, and every "animated" assertion is guarded
// by a `waitFor` that first confirms the mark actually left its static first
// frame — otherwise "it's still static" would pass for the wrong reason (the
// async read never resolving) as easily as for the right one.
//
// SCOPE: `EmptyState` and `LoadingSkeleton` only — the two components this
// file's own name and the brief's Step 1 both centre on, and the two
// task-7-brief.md's "Before you commit" section calls out by name as
// shared primitives with the widest blast radius. The four success-beat
// placements (splash handoff, onboarding done, goal reached, limit created,
// first auto-capture) are one-off wiring in already-covered screens/components
// rather than reusable primitives; `BrandMark`'s own reduce-motion CONTRACT —
// the thing worth fault-injecting — does not change per call site, and is
// already exhaustively covered in brand_mark_motion.test.tsx.
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import { EmptyState } from "../empty_state";
import { LoadingSkeleton } from "../loading_skeleton";

let removeReduceMotionListener: jest.Mock;
let emitReduceMotionChange: (enabled: boolean) => void;

beforeEach(() => {
  removeReduceMotionListener = jest.fn();
  emitReduceMotionChange = () => {
    throw new Error("no reduceMotionChanged listener was registered");
  };

  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
  const fakeAddEventListener = (event: string, listener: (enabled: boolean) => void) => {
    if (event === "reduceMotionChanged") {
      emitReduceMotionChange = listener;
    }
    return { remove: removeReduceMotionListener };
  };
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation(fakeAddEventListener as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** See this file's header — the only honest way to tell the two branches apart. */
function isStaticMark(node: { props: Record<string, unknown> }): boolean {
  return typeof node.props.width === "number";
}

// ---------------------------------------------------------------------------
// EmptyState's default disc
// ---------------------------------------------------------------------------
describe("EmptyState's default mark", () => {
  test("renders a mark at the placement's testID", () => {
    render(<EmptyState testID="e" title="Nothing yet" body="It'll show up here." />);
    screen.getByTestId("e-mark");
  });

  test("with reduce motion off, the mark is the animated idle drift (no width prop)", async () => {
    render(<EmptyState testID="e" title="Nothing yet" body="It'll show up here." />);

    await waitFor(() => {
      expect(isStaticMark(screen.getByTestId("e-mark"))).toBe(false);
    });
  });

  test("with reduce motion on, the same disc degrades to the static mark (width prop present)", async () => {
    render(<EmptyState testID="e" title="Nothing yet" body="It'll show up here." />);

    // Guard against a vacuous pass: confirm it was actually animating first,
    // or the assertion below would prove nothing.
    await waitFor(() => {
      expect(isStaticMark(screen.getByTestId("e-mark"))).toBe(false);
    });

    act(() => {
      emitReduceMotionChange(true);
    });

    expect(isStaticMark(screen.getByTestId("e-mark"))).toBe(true);
  });

  // EmptyState's choice between the default mark and a caller-supplied icon
  // is a DIFFERENT component's contract than the mark's own animation — see
  // "EmptyState defaults to the drifting BrandMark, not a lucide glyph" in
  // components/ui/__tests__/primitives.test.tsx, updated alongside this file.
});

// ---------------------------------------------------------------------------
// LoadingSkeleton's loop
// ---------------------------------------------------------------------------
describe("LoadingSkeleton's mark", () => {
  test("renders a mark at the placement's testID, above the placeholder rows", () => {
    render(<LoadingSkeleton testID="s" rows={2} />);
    screen.getByTestId("s-mark");
  });

  test("with reduce motion off, the mark carries the loop (no width prop)", async () => {
    render(<LoadingSkeleton testID="s" rows={2} />);

    await waitFor(() => {
      expect(isStaticMark(screen.getByTestId("s-mark"))).toBe(false);
    });
  });

  test("with reduce motion on, the loop degrades to the static mark (width prop present)", async () => {
    render(<LoadingSkeleton testID="s" rows={2} />);

    await waitFor(() => {
      expect(isStaticMark(screen.getByTestId("s-mark"))).toBe(false);
    });

    act(() => {
      emitReduceMotionChange(true);
    });

    expect(isStaticMark(screen.getByTestId("s-mark"))).toBe(true);
  });
});
