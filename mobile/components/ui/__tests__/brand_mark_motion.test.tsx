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
  LOOP_WING_FLAP,
  LOOP_WING_FLAP_MS,
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
 * opacity on separate keyTimes tracks; `loading` runs the 3.2s flight path
 * and the 1.1s wing flap, which the source also gives their own clocks.
 */
const DRIVERS_PER_VARIANT: Record<(typeof ANIMATED_VARIANTS)[number], number> = {
  idle: 2,
  launch: 2,
  loading: 2,
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
  //
  // Every row is asserted, not sampled. This variant carries 147 of the
  // designer's numbers — spot-checking the ends and the ±180° seam would let a
  // typo at index 12 through, and a single wrong `y` is invisible in motion.
  expect(LOOP_PATH).toHaveLength(49);
  expect(LOOP_PATH).toEqual([
    { x: 12.0, y: 5.4, deg: 1.7 },
    { x: 12.8, y: 5.4, deg: 5.4 },
    { x: 13.5, y: 5.5, deg: 11.4 },
    { x: 14.2, y: 5.7, deg: 18.0 },
    { x: 14.9, y: 6.0, deg: 25.2 },
    { x: 15.6, y: 6.4, deg: 32.9 },
    { x: 16.2, y: 6.8, deg: 41.0 },
    { x: 16.8, y: 7.4, deg: 49.3 },
    { x: 17.2, y: 8.0, deg: 57.7 },
    { x: 17.6, y: 8.7, deg: 66.2 },
    { x: 17.8, y: 9.4, deg: 74.9 },
    { x: 18.0, y: 10.1, deg: 83.6 },
    { x: 18.0, y: 10.9, deg: 92.7 },
    { x: 17.9, y: 11.6, deg: 102.2 },
    { x: 17.7, y: 12.4, deg: 111.9 },
    { x: 17.3, y: 13.0, deg: 120.2 },
    { x: 16.9, y: 13.7, deg: 127.8 },
    { x: 16.4, y: 14.2, deg: 135.0 },
    { x: 15.8, y: 14.7, deg: 141.7 },
    { x: 15.2, y: 15.2, deg: 148.0 },
    { x: 14.5, y: 15.5, deg: 154.0 },
    { x: 13.8, y: 15.8, deg: 159.7 },
    { x: 13.1, y: 16.1, deg: 165.1 },
    { x: 12.4, y: 16.2, deg: 170.5 },
    { x: 11.6, y: 16.3, deg: 175.8 },
    { x: 10.9, y: 16.3, deg: -178.7 },
    { x: 10.1, y: 16.3, deg: -173.0 },
    { x: 9.4, y: 16.1, deg: -166.8 },
    { x: 8.6, y: 15.9, deg: -159.4 },
    { x: 7.9, y: 15.6, deg: -151.0 },
    { x: 7.3, y: 15.2, deg: -141.7 },
    { x: 6.8, y: 14.7, deg: -131.5 },
    { x: 6.3, y: 14.1, deg: -120.9 },
    { x: 6.0, y: 13.4, deg: -110.2 },
    { x: 5.8, y: 12.6, deg: -99.8 },
    { x: 5.7, y: 11.9, deg: -89.9 },
    { x: 5.8, y: 11.1, deg: -80.9 },
    { x: 6.0, y: 10.4, deg: -72.9 },
    { x: 6.2, y: 9.7, deg: -66.7 },
    { x: 6.6, y: 9.0, deg: -61.2 },
    { x: 7.0, y: 8.4, deg: -55.8 },
    { x: 7.4, y: 7.8, deg: -50.2 },
    { x: 7.9, y: 7.2, deg: -44.4 },
    { x: 8.5, y: 6.7, deg: -38.3 },
    { x: 9.1, y: 6.3, deg: -31.7 },
    { x: 9.8, y: 5.9, deg: -24.6 },
    { x: 10.5, y: 5.6, deg: -16.9 },
    { x: 11.2, y: 5.5, deg: -8.6 },
    { x: 12.0, y: 5.4, deg: -2.9 },
  ]);
  expect(LOOP_MS).toBe(3200);

  // The seam worth naming: the heading list crosses the ±180° branch cut
  // between these two rows. Both sides stay literal above;
  // `brand_mark.tsx` unwraps them for playback.
  expect(LOOP_PATH[24].deg).toBe(175.8);
  expect(LOOP_PATH[25].deg).toBe(-178.7);
});

test("transcribes the wing flap from the source SVG", () => {
  // assets/brand/peraplano-idle-loop.svg, the innermost <g> around the two
  // plane paths:
  //   type="scale" values="1 1;1 0.4;1 1;1 0.85;1 1" dur="1.1s"
  // The x factor is 1 throughout, so this is a Y-only squash of the plane
  // BODY — the wing beat. It runs on its own 1.1s clock, unrelated to the
  // 3.2s circuit, which is what keeps the flap from looking geared to the turn.
  expect(LOOP_WING_FLAP).toEqual([1, 0.4, 1, 0.85, 1]);
  expect(LOOP_WING_FLAP_MS).toBe(1100);
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
