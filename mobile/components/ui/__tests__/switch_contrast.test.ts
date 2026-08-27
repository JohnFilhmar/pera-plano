// components/ui/__tests__/switch_contrast.test.ts — the two states of a
// `Switch` have to be TELLABLE APART, in both themes.
//
// The bug this pins was reported from a device: with React Native's default
// switch colours, the on and off states differ by so little that a user cannot
// say which one they are looking at. Prose in a component header cannot fail
// CI — same reasoning as chip_contrast.test.ts, whose sibling this is.
//
// THRESHOLDS. These are UI-component colours, not text, so the bar is WCAG 2.1
// SC 1.4.11 Non-text Contrast (3:1), not SC 1.4.3's 4.5:1. Two thresholds are
// asserted for different reasons:
//   - STATE_SEPARATION (3:1) between the off track and the on track. This is
//     the "which state am I in" signal and the one the reported bug failed.
//   - THUMB_ON_TRACK (3:1) between the thumb and the track under it, so the
//     thumb's POSITION stays visible as a second, independent signal for
//     anyone who cannot resolve the track hues.
import { contrastRatio } from "@/lib/ui/contrast";
import { palette } from "@/constants/colors";

import { SWITCH_COLORS } from "../switch";

const NON_TEXT_AA = 3;

test.each([
  ["light", SWITCH_COLORS.light],
  ["dark", SWITCH_COLORS.dark],
])("%s: the off track and the on track are distinguishable", (_theme, colors) => {
  expect(contrastRatio(colors.trackOff, colors.trackOn)).toBeGreaterThanOrEqual(NON_TEXT_AA);
});

test.each([
  ["light off", SWITCH_COLORS.light.thumbOff, SWITCH_COLORS.light.trackOff],
  ["light on", SWITCH_COLORS.light.thumbOn, SWITCH_COLORS.light.trackOn],
  ["dark off", SWITCH_COLORS.dark.thumbOff, SWITCH_COLORS.dark.trackOff],
  ["dark on", SWITCH_COLORS.dark.thumbOn, SWITCH_COLORS.dark.trackOn],
])("%s: the thumb reads against its own track", (_label, thumb, track) => {
  expect(contrastRatio(thumb, track)).toBeGreaterThanOrEqual(NON_TEXT_AA);
});

test.each([
  ["light", SWITCH_COLORS.light],
  ["dark", SWITCH_COLORS.dark],
])("%s: the thumb itself changes, so the state has a second signal", (_theme, colors) => {
  // Not just "both thumbs are legible on their own track" — the thumb has to
  // CHANGE between the two states. A dark thumb on a light track flipping to a
  // light thumb on a dark track means the state is readable from the thumb
  // alone, which at switch size carries further than the track hue does.
  expect(contrastRatio(colors.thumbOff, colors.thumbOn)).toBeGreaterThanOrEqual(NON_TEXT_AA);
});

test("the obvious fg-2/brand pairing is rejected — it measures ~1:1", () => {
  // `fg-2` #5B6E64 and `brand` #15803D differ in saturation, barely in
  // luminance. Picking them as the off/on tracks would look like a deliberate
  // house-colour choice and reproduce the exact reported bug. Pinned so the
  // rejection survives whoever next reads "grey track, green track" and
  // reaches for the two obvious tokens.
  expect(contrastRatio(palette["fg-2"], palette.brand)).toBeLessThan(NON_TEXT_AA);
});
