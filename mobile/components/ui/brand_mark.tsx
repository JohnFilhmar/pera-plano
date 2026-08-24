// components/ui/brand_mark.tsx — task-1-brief.md, extended by task-4-brief.md.
//
// The PeraPlano paper-airplane brand mark (docs/11 DESIGN LANGUAGE), rendered
// from `mobile/assets/brand/peraplano-logo-static.svg` — a copy of the
// canonical file at the repo root, `assets/brand/peraplano-logo-static.svg`
// (see that directory's README for why `mobile/` holds a copy rather than
// reaching out to it).
//
// -------------------------------------------------------------------------
// WHY THE MOTION IS WRITTEN HERE INSTEAD OF IMPORTED
// -------------------------------------------------------------------------
// The designer delivered four animated marks. All four animate in SMIL, and
// `react-native-svg` does not implement SMIL: it draws the first frame and
// reports nothing, so an imported animated file is a frozen plane with no
// error to explain it (assets/brand/README.md). The motion therefore has to be
// re-authored on top of Reanimated, and the keyframes have to be transcribed
// rather than re-felt — they live in `brand_mark_motion.ts`, which also
// records which delivered files are deliberately NOT ported and why.
//
// -------------------------------------------------------------------------
// WHICH ARTWORK MOVES: the static SVG, not the layered one
// -------------------------------------------------------------------------
// `assets/brand/peraplano-logo-layered.svg` carries stable ids (`background`,
// `trail`, `airplane_body`) and docs/10-web-design-prompt.md names it the
// native-animation source. On the web those ids are addressable. In React
// Native they are not: `react-native-svg-transformer` compiles a `.svg` into
// ONE opaque component, and nothing in JS can reach a `<g id="trail">` inside
// it. The layered file's only advantage does not survive the toolchain — and
// pulling it into `mobile/assets/brand/` would be an asset change task 4 is
// told not to make. So every variant animates the mark Task 1 already wired,
// as a rigid body, exactly the way the SMIL files animate their own outer
// `<g>` elements.
//
// That works because the mark IS a coherent rigid body: its nose points at
// -45° (up and to the right) and its dashed trail runs anti-parallel behind
// it, so rotating the whole thing about its centre keeps the trail where a
// trail belongs.
//
// -------------------------------------------------------------------------
// REDUCED MOTION IS A GATE, NOT A GARNISH
// -------------------------------------------------------------------------
// `idle` and `loading` repeat forever. An infinite animation the user asked
// the OS to suppress is an accessibility defect and a battery cost, so every
// animated variant degrades to the plain static mark when reduce-motion is on
// — which is also what the SMIL files do in a browser that refuses animation.
//
// This deliberately does NOT use Reanimated's `useReducedMotion()`. That hook
// samples the setting once at app start and documents that changing the
// setting will not re-render anything; a user who turns reduce-motion on to
// escape a spinner would keep the spinner until they restarted the app.
// `AccessibilityInfo` gives both the current value and a live subscription.
//
// While the setting is still being read the mark renders static: an unknown
// answer is treated as "don't move", never as "move anyway".
import { cssInterop } from "nativewind";
import { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import type { ViewStyle } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { EasingFunction, EasingFunctionFactory } from "react-native-reanimated";

import Logo from "@/assets/brand/peraplano-logo-static.svg";

import {
  IDLE_DRIFT,
  IDLE_DRIFT_MS,
  IDLE_ROTATE_DEG,
  IDLE_ROTATE_MS,
  LAUNCH_EASE,
  LAUNCH_KEYFRAMES,
  LAUNCH_MS,
  LAUNCH_OPACITY_KEYFRAMES,
  LOOP_MARK_SCALE,
  LOOP_MS,
  LOOP_PATH,
  LOOP_WING_FLAP,
  LOOP_WING_FLAP_MS,
  SMOOTH_SPLINE,
} from "./brand_mark_motion";

// The generated SVG component isn't a core RN primitive, so `className` does
// nothing on it until registered with cssInterop — the same reason
// button.tsx registers it for lucide icons and for ActivityIndicator.
cssInterop(Logo, { className: { target: "style" } });

const DEFAULT_SIZE = 48;

/** Every SMIL translate in `brand_mark_motion.ts` is in the files' own `viewBox="0 0 24 24"` units. */
const VIEW_BOX = 24;

/**
 * Degrees that align this mark with the orientation the loop file draws its
 * own plane in.
 *
 * Derived, not tuned. `peraplano-idle-loop.svg` draws its plane re-centred
 * and re-oriented: apex `14.86 -0.07`, tips `-4.68 -8.25` and `-3.72 10.11`,
 * so its nose sits at atan2(-1.00, 19.06) = -3.0°. The shared mark's nose —
 * apex `22 2`, tips `2 9` and `15 22` — sits at atan2(-13.5, 13.5) = -45.0°.
 * Pointing this mark where that one points means adding
 * (-3.0) - (-45.0) = 42°.
 *
 * APPLIED LAST IN THE TRANSFORM CHAIN, NOT FOLDED INTO THE HEADING, and that
 * is load-bearing. It could be folded in while the only other operations were
 * a rotate and a UNIFORM scale, which commute. The wing flap is a non-uniform
 * `scaleY`, which does not: the squash has to happen in the frame where the
 * mark is already aligned nose-along-+x, exactly as the source applies it
 * inside its own rotate. Folding the 42° back into the heading would tilt the
 * squash axis 42° off the wings.
 */
const LOOP_HEADING_OFFSET = 42;

export type BrandMarkVariant = "static" | "idle" | "launch" | "loading";

export type BrandMarkProps = {
  /** Square edge in dp. Default 48. */
  size?: number;
  /** Which delivered mark to play. Default `"static"`. */
  variant?: BrandMarkVariant;
  /** `launch` only: any change to this value replays the one-shot. */
  playToken?: number;
  className?: string;
  testID?: string;
};

export function BrandMark({
  size = DEFAULT_SIZE,
  variant = "static",
  playToken,
  className,
  testID,
}: BrandMarkProps) {
  const reduceMotion = useReduceMotion(variant !== "static");

  // `!== false` and not `!reduceMotion`: `null` means the OS hasn't answered
  // yet, and the safe answer to "should this move?" while unknown is no.
  if (variant === "static" || reduceMotion !== false) {
    return <Logo width={size} height={size} className={className} testID={testID} />;
  }

  if (variant === "idle") {
    return <IdleMark size={size} className={className} testID={testID} />;
  }
  if (variant === "launch") {
    return <LaunchMark size={size} className={className} testID={testID} playToken={playToken} />;
  }
  return <LoopMark size={size} className={className} testID={testID} />;
}

/**
 * The device's reduce-motion setting: `true`, `false`, or `null` while it is
 * still being read. `enabled` is false for the static variant, which has no
 * motion to suppress and therefore no reason to hold an OS subscription.
 */
function useReduceMotion(enabled: boolean): boolean | null {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let subscribed = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (subscribed) {
          setReduceMotion(on);
        }
      })
      .catch(() => {
        // Leave it unknown. The static mark is the safe answer, and a brand
        // glyph is not worth surfacing an accessibility-query failure over.
      });

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => {
      if (subscribed) {
        setReduceMotion(on);
      }
    });

    return () => {
      subscribed = false;
      subscription.remove();
    };
  }, [enabled]);

  return enabled ? reduceMotion : null;
}

type AnimatedMarkProps = {
  size: number;
  className?: string;
  testID?: string;
};

// Precomputed at module scope: these are constant for the life of the app and
// are captured by the style worklets, so rebuilding them per render would copy
// 49-entry arrays to the UI thread for nothing.
const SMOOTH_EASE = Easing.bezier(...SMOOTH_SPLINE);

const DRIFT_STEPS = IDLE_DRIFT.map((_, index) => index);
const DRIFT_TIMES = uniformKeyTimes(IDLE_DRIFT.length);
const DRIFT_X = IDLE_DRIFT.map((point) => point.x);
const DRIFT_Y = IDLE_DRIFT.map((point) => point.y);

const WOBBLE_STEPS = IDLE_ROTATE_DEG.map((_, index) => index);
const WOBBLE_TIMES = uniformKeyTimes(IDLE_ROTATE_DEG.length);
const WOBBLE_DEG = [...IDLE_ROTATE_DEG];

const LAUNCH_STEPS = LAUNCH_KEYFRAMES.map((_, index) => index);
const LAUNCH_TIMES = LAUNCH_KEYFRAMES.map((frame) => frame.t);
const LAUNCH_X = LAUNCH_KEYFRAMES.map((frame) => frame.x);
const LAUNCH_Y = LAUNCH_KEYFRAMES.map((frame) => frame.y);
const LAUNCH_EASINGS = LAUNCH_EASE.map((spline) => Easing.bezier(...spline));

const FADE_STEPS = LAUNCH_OPACITY_KEYFRAMES.map((_, index) => index);
const FADE_TIMES = LAUNCH_OPACITY_KEYFRAMES.map((frame) => frame.t);
const FADE_VALUES = LAUNCH_OPACITY_KEYFRAMES.map((frame) => frame.opacity);

const LOOP_STEPS = LOOP_PATH.map((_, index) => index);
const LOOP_TIMES = uniformKeyTimes(LOOP_PATH.length);
const LOOP_X = LOOP_PATH.map((point) => point.x);
const LOOP_Y = LOOP_PATH.map((point) => point.y);
const LOOP_HEADINGS = unwrapDegrees(LOOP_PATH.map((point) => point.deg));

const FLAP_STEPS = LOOP_WING_FLAP.map((_, index) => index);
const FLAP_TIMES = uniformKeyTimes(LOOP_WING_FLAP.length);
const FLAP_SCALE_Y = [...LOOP_WING_FLAP];

/**
 * `peraplano-idle-logo.svg`: a slow drift on one clock and a slower wobble on
 * another. Two shared values rather than one because the source runs them at
 * 3.4s and 5.2s — beating against each other is what stops the idle mark
 * looking like a metronome.
 */
function IdleMark({ size, className, testID }: AnimatedMarkProps) {
  const drift = useSharedValue(0);
  const wobble = useSharedValue(0);

  useEffect(() => {
    drift.value = withRepeat(
      keyframeTimeline(DRIFT_TIMES, IDLE_DRIFT_MS, () => SMOOTH_EASE),
      -1,
    );
    wobble.value = withRepeat(
      keyframeTimeline(WOBBLE_TIMES, IDLE_ROTATE_MS, () => SMOOTH_EASE),
      -1,
    );
    return () => {
      cancelAnimation(drift);
      cancelAnimation(wobble);
    };
  }, [drift, wobble]);

  const driftStyle = useAnimatedStyle(() => {
    const unit = size / VIEW_BOX;
    return {
      transform: [
        { translateX: interpolate(drift.value, DRIFT_STEPS, DRIFT_X) * unit },
        { translateY: interpolate(drift.value, DRIFT_STEPS, DRIFT_Y) * unit },
      ],
    };
  });

  const wobbleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(wobble.value, WOBBLE_STEPS, WOBBLE_DEG)}deg` }],
  }));

  return (
    <View style={boxStyle(size)} testID={testID}>
      <Animated.View style={[StyleSheet.absoluteFill, driftStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, wobbleStyle]}>
          <Logo width={size} height={size} className={className} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/**
 * `peraplano-launch.svg`: one shot, then freeze. Translate and opacity are
 * separate shared values because the source gives them separate `keyTimes` —
 * see `brand_mark_motion.ts`.
 *
 * `fill="freeze"` needs no special handling: the last keyframe of both tracks
 * is the resting state (translate `0 0`, opacity 1), so a finished launch IS
 * the static mark. Nothing snaps back and nothing is left invisible.
 */
function LaunchMark({
  size,
  className,
  testID,
  playToken,
}: AnimatedMarkProps & { playToken?: number }) {
  const move = useSharedValue(0);
  const fade = useSharedValue(0);

  // `playToken` is the only replay trigger — mirroring the source README's own
  // web trick of re-requesting the file with a cache-busting query. Size or
  // className changing must NOT re-fire the take-off, so neither belongs here.
  useEffect(() => {
    // Rewind first. A frozen launch leaves both drivers parked on their LAST
    // keyframe index, and `withSequence` animates from wherever the value
    // already is — so without this a replay would crawl backwards from the end
    // instead of taking off again.
    move.value = 0;
    fade.value = 0;
    move.value = keyframeTimeline(LAUNCH_TIMES, LAUNCH_MS, (segment) => LAUNCH_EASINGS[segment]);
    fade.value = keyframeTimeline(FADE_TIMES, LAUNCH_MS, () => Easing.linear);
    return () => {
      cancelAnimation(move);
      cancelAnimation(fade);
    };
  }, [move, fade, playToken]);

  const launchStyle = useAnimatedStyle(() => {
    const unit = size / VIEW_BOX;
    return {
      opacity: interpolate(fade.value, FADE_STEPS, FADE_VALUES),
      transform: [
        { translateX: interpolate(move.value, LAUNCH_STEPS, LAUNCH_X) * unit },
        { translateY: interpolate(move.value, LAUNCH_STEPS, LAUNCH_Y) * unit },
      ],
    };
  });

  return (
    <View style={boxStyle(size)} testID={testID}>
      <Animated.View style={[StyleSheet.absoluteFill, launchStyle]}>
        <Logo width={size} height={size} className={className} />
      </Animated.View>
    </View>
  );
}

/**
 * `peraplano-idle-loop.svg`: the mark flies a closed circuit forever, banking
 * into each turn and beating its wings as it goes.
 *
 * Two shared values, because the source gives the two motions two clocks: the
 * circuit is 3.2s and the wing flap is 1.1s. Position, heading and the
 * source's `scale(0.32)` all read off the flight driver; only the squash
 * reads off the flap.
 */
function LoopMark({ size, className, testID }: AnimatedMarkProps) {
  const flight = useSharedValue(0);
  const flap = useSharedValue(0);

  useEffect(() => {
    flight.value = withRepeat(
      keyframeTimeline(LOOP_TIMES, LOOP_MS, () => Easing.linear),
      -1,
    );
    flap.value = withRepeat(
      keyframeTimeline(FLAP_TIMES, LOOP_WING_FLAP_MS, () => SMOOTH_EASE),
      -1,
    );
    return () => {
      cancelAnimation(flight);
      cancelAnimation(flap);
    };
  }, [flight, flap]);

  const flightStyle = useAnimatedStyle(() => {
    const unit = size / VIEW_BOX;
    return {
      // Read outermost-first, the same order the source nests its groups:
      // translate to the path point, turn onto the heading, shrink, beat the
      // wings, then the fixed 42° that aligns this mark with the plane the
      // loop file draws. The last two do NOT commute — see LOOP_HEADING_OFFSET.
      transform: [
        // The source translates a point and draws the plane around it; here the
        // mark is a box, so its CENTRE has to land on that point.
        { translateX: interpolate(flight.value, LOOP_STEPS, LOOP_X) * unit - size / 2 },
        { translateY: interpolate(flight.value, LOOP_STEPS, LOOP_Y) * unit - size / 2 },
        { rotate: `${interpolate(flight.value, LOOP_STEPS, LOOP_HEADINGS)}deg` },
        { scale: LOOP_MARK_SCALE },
        { scaleY: interpolate(flap.value, FLAP_STEPS, FLAP_SCALE_Y) },
        { rotate: `${LOOP_HEADING_OFFSET}deg` },
      ],
    };
  });

  return (
    <View style={boxStyle(size)} testID={testID}>
      <Animated.View style={[StyleSheet.absoluteFill, flightStyle]}>
        <Logo width={size} height={size} className={className} />
      </Animated.View>
    </View>
  );
}

/**
 * A fixed box for the mark to move inside, so an animated variant occupies
 * exactly as much layout as the static one. `overflow: "hidden"` reproduces
 * the SVG viewBox's own clipping — without it `launch` would draw a plane a
 * full box-width outside its bounds, over whatever sits next to it.
 */
function boxStyle(size: number): ViewStyle {
  return { width: size, height: size, overflow: "hidden" };
}

/**
 * Turns a SMIL `keyTimes` track into a Reanimated animation that walks a
 * shared value 0 -> 1 -> ... -> n-1, one `withTiming` per segment.
 *
 * The shared value is a KEYFRAME INDEX, not a 0..1 progress, and that is the
 * point: because each segment eases its own step of the index, an
 * `interpolate(index, [0..n-1], values)` in the style worklet reproduces the
 * source's per-segment easing exactly. A single progress value would force one
 * curve across the whole track, which is precisely the flattening the brief
 * calls a defect.
 *
 * Safe to wrap in `withRepeat(..., -1)`: `withRepeat` restarts its inner
 * animation from the value it held when the repeat began (0), not from where
 * the sequence ended.
 */
function keyframeTimeline(
  keyTimes: readonly number[],
  totalMs: number,
  easingAt: (segment: number) => EasingFunction | EasingFunctionFactory,
): number {
  const steps = keyTimes.slice(1).map((time, segment) =>
    withTiming(segment + 1, {
      duration: (time - keyTimes[segment]) * totalMs,
      easing: easingAt(segment),
    }),
  );
  return withSequence(...steps);
}

/** `[0, 1/(n-1), ..., 1]` — SMIL's default spacing when a track omits `keyTimes`. */
function uniformKeyTimes(frames: number): number[] {
  return Array.from({ length: frames }, (_, index) => index / (frames - 1));
}

/**
 * Makes a heading list continuous across the ±180° branch cut.
 *
 * `peraplano-idle-loop.svg` stores headings as signed degrees, so one full
 * circuit reads `1.7 … 175.8, -178.7 … -2.9`. Interpolating that literally —
 * which is also what SMIL does — spins the plane -354.5° inside one 67ms
 * segment: a visible whip once every 3.2s on a spinner that never stops. The
 * transcription stays literal in `brand_mark_motion.ts`; the wrap is undone
 * here, at playback, because it is an artefact of how an angle is written down
 * and not something the designer drew.
 *
 * Exported only so the suite can assert it: it is the one piece of real logic
 * in this port, a sign slip in `turns` would silently double-spin the plane,
 * and nothing about the rendered tree at rest would reveal it.
 */
export function unwrapDegrees(degrees: readonly number[]): number[] {
  let turns = 0;
  return degrees.map((deg, index) => {
    if (index > 0) {
      const delta = deg - degrees[index - 1];
      if (delta > 180) {
        turns -= 360;
      } else if (delta < -180) {
        turns += 360;
      }
    }
    return deg + turns;
  });
}
