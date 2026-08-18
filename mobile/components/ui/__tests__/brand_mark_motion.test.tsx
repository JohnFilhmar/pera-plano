// components/ui/__tests__/brand_mark_motion.test.tsx — task-4-brief.md.
//
// Two jobs, and they are different in kind.
//
// 1. TRANSCRIPTION. `brand_mark_motion.ts` is a hand-copy of numbers that live
//    in `assets/brand/*.svg`. A typo there is invisible: the mark still moves,
//    just not the way the designer drew it. So these tests assert the LITERAL
//    values. They are deliberately redundant with the source — that redundancy
//    is the whole point, because it makes a silent retune fail CI instead of
//    shipping.
//
// 2. BEHAVIOUR. Reduced motion and teardown are correctness, not polish: an
//    infinite `withRepeat` that outlives its screen keeps the JS thread awake,
//    and an animation the user asked the OS to suppress is an accessibility
//    defect. Both are asserted through real collaborators (AccessibilityInfo,
//    Reanimated) rather than assumed.
//
// WHY THE REANIMATED MOCK BELOW IS A SPY, NOT A STUB: every entry wraps the
// REAL implementation (`jest.fn(actual.x)`), so the component under test runs
// against real Reanimated and only gains a call record. Stubbing these out
// would make the suite pass against a component that never animates at all.
import { act, render, screen, waitFor } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { cancelAnimation, withSequence } from "react-native-reanimated";

import { BrandMark, unwrapDegrees } from "../brand_mark";
import {
  IDLE_DRIFT,
  IDLE_DRIFT_MS,
  IDLE_ROTATE_DEG,
  IDLE_ROTATE_MS,
  LAUNCH_EASE,
  LAUNCH_KEYFRAMES,
  LAUNCH_MS,
  LAUNCH_OPACITY_KEYFRAMES,
  LOOP_MS,
  LOOP_PATH,
  TRAIL_DOTS,
} from "../brand_mark_motion";

jest.mock("react-native-reanimated", () => {
  const actual = jest.requireActual("react-native-reanimated");
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    cancelAnimation: jest.fn(actual.cancelAnimation),
    withSequence: jest.fn(actual.withSequence),
  };
});

const ANIMATED_VARIANTS = ["idle", "launch", "loading"] as const;

/**
 * Number of shared values each animated variant drives — and therefore the
 * number of `cancelAnimation` calls its unmount owes. `idle` runs drift and
 * wobble on separate SMIL clocks (3.4s vs 5.2s); `launch` runs translate and
 * opacity on separate keyTimes tracks; `loading` runs one path clock.
 */
const DRIVERS_PER_VARIANT: Record<(typeof ANIMATED_VARIANTS)[number], number> = {
  idle: 2,
  launch: 2,
  loading: 1,
};

let removeReduceMotionListener: jest.Mock;
let emitReduceMotionChange: (enabled: boolean) => void;

beforeEach(() => {
  jest.mocked(cancelAnimation).mockClear();
  jest.mocked(withSequence).mockClear();

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
  // React Native types `addEventListener` as an overload set returning a full
  // `EmitterSubscription`. `BrandMark` only ever calls `.remove()` on what it
  // gets back, so the stub above is complete for what is under test — the cast
  // covers the fields deliberately not built, not any behaviour.
  jest
    .spyOn(AccessibilityInfo, "addEventListener")
    .mockImplementation(fakeAddEventListener as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * True when the node is the plain static mark. The static branch renders the
 * imported `.svg` (a prop-forwarding `View` under `test_support/svg_mock.tsx`,
 * so `width`/`height` arrive as PROPS); every animated branch renders a
 * Reanimated-wrapped box that carries its size in `style`. That difference is
 * the only honest discriminator available, since both draw the same artwork.
 */
function isStaticMark(node: { props: Record<string, unknown> }): boolean {
  return typeof node.props.width === "number";
}

test("renders the static mark for every animated variant when reduced motion is enabled", async () => {
  for (const variant of ANIMATED_VARIANTS) {
    const view = render(<BrandMark variant={variant} testID="mark" />);

    // Guard against a vacuous pass: with reduce-motion OFF the variant must
    // actually be animating, otherwise the assertion below proves nothing.
    await waitFor(() => {
      expect(isStaticMark(screen.getByTestId("mark"))).toBe(false);
    });

    act(() => {
      emitReduceMotionChange(true);
    });

    expect(isStaticMark(screen.getByTestId("mark"))).toBe(true);
    view.unmount();
  }
});

test("unsubscribes from the reduced-motion listener on unmount", async () => {
  const view = render(<BrandMark variant="idle" testID="mark" />);
  await waitFor(() => {
    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledWith(
      "reduceMotionChanged",
      expect.any(Function),
    );
  });
  expect(removeReduceMotionListener).not.toHaveBeenCalled();

  view.unmount();

  expect(removeReduceMotionListener).toHaveBeenCalledTimes(1);
});

test("cancels its animations on unmount", async () => {
  for (const variant of ANIMATED_VARIANTS) {
    jest.mocked(cancelAnimation).mockClear();

    const view = render(<BrandMark variant={variant} testID="mark" />);
    await waitFor(() => {
      expect(isStaticMark(screen.getByTestId("mark"))).toBe(false);
    });
    expect(cancelAnimation).not.toHaveBeenCalled();

    view.unmount();

    expect(cancelAnimation).toHaveBeenCalledTimes(DRIVERS_PER_VARIANT[variant]);
  }
});

test("replays the launch animation when playToken changes", async () => {
  const view = render(<BrandMark variant="launch" playToken={1} testID="mark" />);
  await waitFor(() => {
    expect(withSequence).toHaveBeenCalledTimes(DRIVERS_PER_VARIANT.launch);
  });

  view.rerender(<BrandMark variant="launch" playToken={2} testID="mark" />);

  expect(withSequence).toHaveBeenCalledTimes(DRIVERS_PER_VARIANT.launch * 2);
});

test("does not replay the launch animation when an unrelated prop changes", async () => {
  const view = render(<BrandMark variant="launch" playToken={1} size={48} testID="mark" />);
  await waitFor(() => {
    expect(withSequence).toHaveBeenCalledTimes(DRIVERS_PER_VARIANT.launch);
  });

  view.rerender(<BrandMark variant="launch" playToken={1} size={96} testID="mark" />);

  expect(withSequence).toHaveBeenCalledTimes(DRIVERS_PER_VARIANT.launch);
});

test("transcribes the idle drift keyframes from the source SVG", () => {
  // assets/brand/peraplano-idle-logo.svg, outer <g>:
  //   type="translate" values="0 0;0.55 -0.45;0 0;-0.35 0.3;0 0" dur="3.4s"
  expect(IDLE_DRIFT).toEqual([
    { x: 0, y: 0 },
    { x: 0.55, y: -0.45 },
    { x: 0, y: 0 },
    { x: -0.35, y: 0.3 },
    { x: 0, y: 0 },
  ]);
  expect(IDLE_DRIFT_MS).toBe(3400);

  // …and the inner <g>:
  //   type="rotate" values="-1.5 12 12;2 12 12;-1.5 12 12" dur="5.2s"
  expect(IDLE_ROTATE_DEG).toEqual([-1.5, 2, -1.5]);
  expect(IDLE_ROTATE_MS).toBe(5200);
});

test("transcribes the launch keyframes and the trail dots from the source SVGs", () => {
  // assets/brand/peraplano-launch.svg, outer <g> translate track:
  //   values="0 0;-1.4 1.1;24 -18.5;24 -18.5;-7 5.4;0 0"
  //   keyTimes="0;0.16;0.56;0.6;0.64;1" dur="1.15s" fill="freeze"
  expect(LAUNCH_KEYFRAMES).toEqual([
    { t: 0, x: 0, y: 0 },
    { t: 0.16, x: -1.4, y: 1.1 },
    { t: 0.56, x: 24, y: -18.5 },
    { t: 0.6, x: 24, y: -18.5 },
    { t: 0.64, x: -7, y: 5.4 },
    { t: 1, x: 0, y: 0 },
  ]);
  expect(LAUNCH_MS).toBe(1150);

  //   keySplines="0.4 0 0.6 1;0.25 0.1 0.2 1;0 0 1 1;0 0 1 1;0.16 0.9 0.2 1"
  expect(LAUNCH_EASE).toEqual([
    [0.4, 0, 0.6, 1],
    [0.25, 0.1, 0.2, 1],
    [0, 0, 1, 1],
    [0, 0, 1, 1],
    [0.16, 0.9, 0.2, 1],
  ]);

  // …and the separately-timed opacity track:
  //   values="1;1;0;0;1;1" keyTimes="0;0.56;0.58;0.63;0.72;1"
  expect(LAUNCH_OPACITY_KEYFRAMES).toEqual([
    { t: 0, opacity: 1 },
    { t: 0.56, opacity: 1 },
    { t: 0.58, opacity: 0 },
    { t: 0.63, opacity: 0 },
    { t: 0.72, opacity: 1 },
    { t: 1, opacity: 1 },
  ]);

  // assets/brand/peraplano-idle-logo.svg, the four trailing <circle>s —
  // cx/cy/r plus the `begin` stagger on their <animate> children.
  expect(TRAIL_DOTS).toEqual([
    { cx: 9.2, cy: 14.4, r: 1.15, delayMs: 0 },
    { cx: 7, cy: 16.1, r: 0.95, delayMs: 340 },
    { cx: 4.8, cy: 17.8, r: 0.75, delayMs: 680 },
    { cx: 2.6, cy: 19.5, r: 0.55, delayMs: 1020 },
  ]);
});

test("pairs every loop path point with a heading", () => {
  // assets/brand/peraplano-idle-loop.svg holds the flight path as TWO separate
  // SMIL attributes — a 49-entry `type="translate"` list and a 49-entry
  // `type="rotate"` list, paired index-for-index. Dropping or doubling one
  // entry on either side is silent at runtime (the plane just flies with the
  // wrong heading), so the pairing itself is the thing under test.
  expect(LOOP_PATH).toHaveLength(49);
  for (const point of LOOP_PATH) {
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
    expect(Number.isFinite(point.deg)).toBe(true);
  }

  expect(LOOP_MS).toBe(3200);
  expect(LOOP_PATH[0]).toEqual({ x: 12, y: 5.4, deg: 1.7 });
  expect(LOOP_PATH[48]).toEqual({ x: 12, y: 5.4, deg: -2.9 });

  // The one place the transcription is easy to "correct" by accident: the
  // designer's heading list crosses the ±180° branch cut here. Both sides stay
  // literal; `brand_mark.tsx` unwraps them for playback.
  expect(LOOP_PATH[24]).toEqual({ x: 11.6, y: 16.3, deg: 175.8 });
  expect(LOOP_PATH[25]).toEqual({ x: 10.9, y: 16.3, deg: -178.7 });
});

test("unwraps the loop headings into one continuous turn", () => {
  // The literal list is what the SVG says; playback needs it continuous, or
  // the plane whips -354.5° through a single 67ms segment every 3.2s.
  expect(unwrapDegrees([170, 175.8, -178.7, -173])).toEqual([170, 175.8, 181.3, 187]);
  expect(unwrapDegrees([-170, -175.8, 178.7, 173])).toEqual([-170, -175.8, -181.3, -187]);
  expect(unwrapDegrees([1.7, 5.4, 11.4])).toEqual([1.7, 5.4, 11.4]);

  const unwrapped = unwrapDegrees(LOOP_PATH.map((point) => point.deg));
  expect(unwrapped).toHaveLength(LOOP_PATH.length);
  for (let index = 1; index < unwrapped.length; index += 1) {
    expect(unwrapped[index]).toBeGreaterThan(unwrapped[index - 1]);
  }
  // One circuit, and only one: 1.7° in, 357.1° out.
  expect(unwrapped[0]).toBeCloseTo(1.7, 5);
  expect(unwrapped[unwrapped.length - 1]).toBeCloseTo(357.1, 5);
});
