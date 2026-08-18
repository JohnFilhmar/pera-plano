// components/ui/brand_mark_motion.ts — task-4-brief.md.
//
// The designer's brand motion, transcribed out of SMIL into plain data.
//
// WHY THIS FILE EXISTS AT ALL. The animated brand deliverables in
// `assets/brand/` are authored in SMIL (`<animate>`, `<animateTransform>`).
// `react-native-svg` does not implement SMIL — it parses the file, draws the
// first frame, and says nothing. So importing `peraplano-idle-logo.svg` on the
// phone gets you a frozen paper plane and no error to explain it
// (assets/brand/README.md has the full story). The only way to have the motion
// on device is to re-author it, and the only way to keep it the DESIGNER's
// motion rather than a lookalike is to copy the numbers across verbatim.
//
// EVERY CONSTANT BELOW IS A HAND-COPY, NOT A CHOICE. Each carries the source
// file and the SMIL attribute it came from. If the artwork is redrawn, these
// change with it; nothing here should ever be "tuned to feel better" in
// isolation, because the feel is what was delivered.
// `__tests__/brand_mark_motion.test.tsx` asserts the literal values so a
// silent retune fails CI instead of shipping.
//
// DATA ONLY. No React, no Reanimated, no easing objects — `brand_mark.tsx`
// turns these into animations. Keeping the split means the transcription can
// be diffed against the SVGs without reading any playback code.
//
// ---------------------------------------------------------------------------
// THREE VARIANTS, AND THE TWO THAT ARE DELIBERATELY NOT HERE
// ---------------------------------------------------------------------------
// Ported: `peraplano-idle-logo.svg` (idle), `peraplano-launch.svg` (launch),
// `peraplano-idle-loop.svg` (loading).
//
// NOT ported, and not a gap — please don't re-open these:
//   - `peraplano-bg-planes.svg` — 1600x900, 43 KB, seven independent plane
//     routes. It is a marketing hero for a wide web page; on a phone it is
//     expensive to run and has no surface to live on.
//   - `nav/*.svg` — an 8-direction pagination set. Onboarding already paginates
//     through `components/onboarding/step_progress.tsx`, and nothing in the app
//     has 8-way navigation, so there is nothing for them to drive.
//
// ---------------------------------------------------------------------------
// ONE SHAPE DEVIATION FROM THE BRIEF'S SKETCH, ON PURPOSE
// ---------------------------------------------------------------------------
// The brief sketched `LAUNCH_KEYFRAMES` as `{ t, x, y, opacity }[]`. The source
// file cannot be expressed that way: its translate track and its opacity track
// run on DIFFERENT `keyTimes` (`0;0.16;0.56;0.6;0.64;1` against
// `0;0.56;0.58;0.63;0.72;1`). Merging them onto one timeline means resampling
// one of them, and resampling the opacity track destroys the thing it exists
// for — the hard 0.56 -> 0.58 blink as the plane leaves frame and the 0.63 ->
// 0.72 snap as it comes back. So the two tracks stay two arrays:
// `LAUNCH_KEYFRAMES` (translate) and `LAUNCH_OPACITY_KEYFRAMES` (opacity).
// Rule 1 — transcribe, do not invent — outranks the interface sketch.

/** A SMIL `keySplines` entry: the four control-point coordinates of a cubic bezier. */
export type CubicBezier = readonly [number, number, number, number];

/** A point on the idle drift, in viewBox (0..24) units. */
export type DriftPoint = { readonly x: number; readonly y: number };

/** One `keyTimes`/`values` pair from the launch translate track. `t` is 0..1 of `LAUNCH_MS`. */
export type LaunchKeyframe = { readonly t: number; readonly x: number; readonly y: number };

/** One `keyTimes`/`values` pair from the launch opacity track. Its own time base — see header. */
export type LaunchOpacityKeyframe = { readonly t: number; readonly opacity: number };

/** A sample of the loading flight: position in viewBox units plus the heading drawn there. */
export type LoopPoint = { readonly x: number; readonly y: number; readonly deg: number };

/** A trailing spark: centre and radius in viewBox units, plus its `begin` stagger. */
export type TrailDot = {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly delayMs: number;
};

/**
 * The easing shared by every segment of both idle tracks.
 * `peraplano-idle-logo.svg`, `keySplines="0.4 0 0.6 1"` on both
 * `<animateTransform>` elements (`calcMode="spline"`, so this is a real
 * ease-in-out — reading it as linear is the classic way to lose the feel).
 */
export const SMOOTH_SPLINE: CubicBezier = [0.4, 0, 0.6, 1];

/**
 * `peraplano-idle-logo.svg`, outer `<g>`:
 * `type="translate" values="0 0;0.55 -0.45;0 0;-0.35 0.3;0 0"`.
 * No `keyTimes`, so the four segments are evenly spaced. Units are viewBox
 * units (the file's viewBox is `0 0 24 24`), NOT dp.
 */
export const IDLE_DRIFT: readonly DriftPoint[] = [
  { x: 0, y: 0 },
  { x: 0.55, y: -0.45 },
  { x: 0, y: 0 },
  { x: -0.35, y: 0.3 },
  { x: 0, y: 0 },
];

/** `peraplano-idle-logo.svg`, outer `<g>`: `dur="3.4s" repeatCount="indefinite"`. */
export const IDLE_DRIFT_MS = 3400;

/**
 * `peraplano-idle-logo.svg`, inner `<g>`:
 * `type="rotate" values="-1.5 12 12;2 12 12;-1.5 12 12"`.
 * The `12 12` is the rotation centre — the centre of the 24x24 viewBox, which
 * is where a React Native view rotates by default, so only the angle survives
 * the transcription.
 */
export const IDLE_ROTATE_DEG: readonly number[] = [-1.5, 2, -1.5];

/** `peraplano-idle-logo.svg`, inner `<g>`: `dur="5.2s" repeatCount="indefinite"`. */
export const IDLE_ROTATE_MS = 5200;

/**
 * `peraplano-launch.svg`, outer `<g>`:
 * `type="translate" values="0 0;-1.4 1.1;24 -18.5;24 -18.5;-7 5.4;0 0"`
 * `keyTimes="0;0.16;0.56;0.6;0.64;1"`.
 * Dip, climb out of frame, hold, overshoot back in, settle. The last frame is
 * `0 0` — with `fill="freeze"` that is why a finished launch is exactly the
 * static mark and not a plane parked somewhere odd.
 */
export const LAUNCH_KEYFRAMES: readonly LaunchKeyframe[] = [
  { t: 0, x: 0, y: 0 },
  { t: 0.16, x: -1.4, y: 1.1 },
  { t: 0.56, x: 24, y: -18.5 },
  { t: 0.6, x: 24, y: -18.5 },
  { t: 0.64, x: -7, y: 5.4 },
  { t: 1, x: 0, y: 0 },
];

/**
 * `peraplano-launch.svg`, the translate track's
 * `keySplines="0.4 0 0.6 1;0.25 0.1 0.2 1;0 0 1 1;0 0 1 1;0.16 0.9 0.2 1"`.
 * FIVE entries for FIVE segments, and they are not interchangeable: the
 * take-off segment accelerates hard, the two `0 0 1 1` segments are linear
 * (that is the off-screen hold), and the return uses a strong overshoot curve.
 * Flattening these to one shared easing is exactly the "looks about right"
 * failure this file exists to prevent.
 */
export const LAUNCH_EASE: readonly CubicBezier[] = [
  [0.4, 0, 0.6, 1],
  [0.25, 0.1, 0.2, 1],
  [0, 0, 1, 1],
  [0, 0, 1, 1],
  [0.16, 0.9, 0.2, 1],
];

/**
 * `peraplano-launch.svg`, outer `<g>`:
 * `attributeName="opacity" values="1;1;0;0;1;1" keyTimes="0;0.56;0.58;0.63;0.72;1"`.
 * Its own time base — see this file's header for why it is a second array.
 * No `calcMode`, so SMIL's default applies and every segment is linear.
 */
export const LAUNCH_OPACITY_KEYFRAMES: readonly LaunchOpacityKeyframe[] = [
  { t: 0, opacity: 1 },
  { t: 0.56, opacity: 1 },
  { t: 0.58, opacity: 0 },
  { t: 0.63, opacity: 0 },
  { t: 0.72, opacity: 1 },
  { t: 1, opacity: 1 },
];

/** `peraplano-launch.svg`: `dur="1.15s" begin="0s" fill="freeze"` — a one shot. */
export const LAUNCH_MS = 1150;

/**
 * `peraplano-idle-loop.svg`: the flight path, one closed circuit.
 *
 * TWO SMIL attributes fused into one array. `x`/`y` come from the moving
 * `<g>`'s `type="translate"` list (49 entries, viewBox units) and `deg` from
 * the nested `<g>`'s `type="rotate"` list (49 entries) — paired index for
 * index, because in the file they are two independent lists that only line up
 * because they were authored together. Keeping them fused here makes a dropped
 * entry a structural error rather than a silent heading drift, which is what
 * `pairs every loop path point with a heading` guards.
 *
 * `calcMode="linear"` on both, so the 48 segments are evenly timed and unease.
 *
 * NOTE ON `deg`: the heading crosses the ±180° branch cut between index 24
 * (175.8) and index 25 (-178.7). The values stay LITERAL here.
 * `brand_mark.tsx` unwraps them into a continuous series before playback —
 * see its `unwrapDegrees`.
 */
export const LOOP_PATH: readonly LoopPoint[] = [
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
];

/** `peraplano-idle-loop.svg`: `dur="3.2s" repeatCount="indefinite"` on both lists. */
export const LOOP_MS = 3200;

/**
 * `peraplano-idle-loop.svg`: `transform="scale(0.32)"` on the group that
 * carries the plane around the path. The plane is drawn small while the path
 * itself spans most of the viewBox.
 */
export const LOOP_MARK_SCALE = 0.32;

/**
 * `peraplano-idle-logo.svg`: the four trailing `<circle>`s — `cx`/`cy`/`r` in
 * viewBox units, `delayMs` from the `begin` on their `<animate>` children
 * (0.00s / 0.34s / 0.68s / 1.02s against a 1.36s cycle).
 *
 * NOT RENDERED TODAY, and that is a decision rather than an oversight.
 * `brand_mark.tsx` animates the whole delivered mark, and that mark
 * (`peraplano-logo-static.svg`) already draws its trail as a baked dashed
 * stroke. Emitting these sparks on top of it would put two trails on one
 * plane — an invention the designer never drew. They are transcribed and kept
 * because the numbers are only recoverable from the SVG, and re-deriving them
 * later is exactly the error-prone step this file removes; the day a layered
 * asset lands and the trail becomes addressable, they are ready.
 */
export const TRAIL_DOTS: readonly TrailDot[] = [
  { cx: 9.2, cy: 14.4, r: 1.15, delayMs: 0 },
  { cx: 7, cy: 16.1, r: 0.95, delayMs: 340 },
  { cx: 4.8, cy: 17.8, r: 0.75, delayMs: 680 },
  { cx: 2.6, cy: 19.5, r: 0.55, delayMs: 1020 },
];
