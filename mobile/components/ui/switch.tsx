// components/ui/switch.tsx — the on/off switch every settings-style row uses.
//
// WHY THIS EXISTS. Four screens rendered React Native's `Switch` bare, with no
// colour props at all (Privacy's master pause and per-provider rows, Settings'
// quiet-hours and telemetry rows, and the limit form's Rollover row). A bare
// `Switch` paints itself from the PLATFORM's default palette, which knows
// nothing about `constants/colors.ts`: on Android the off track and the on
// track are two tints of the same grey separated mostly by alpha, so on a
// device the two states read as the same control twice — the thumb slides, but
// nothing changes colour enough to say WHICH state you are in. It is worse in
// dark mode, where the default track is a near-black on a near-black card.
// Reported on-device 2026-08-27: "can't tell the difference between the 2
// colours, both light and dark theme."
//
// `Switch` is one of the few React Native components NativeWind cannot style —
// `trackColor`/`thumbColor` take literal colours, not classes — so the tokens
// have to be READ from the palette rather than applied as classes, the same way
// `components/goals/progress_ring.tsx` reads `brand-soft` for an SVG `stroke`.
// That is why this wrapper exists at all instead of a `className`.
//
// THE STATES ARE INVERTED, NOT SHADED. Off is a quiet track under a dark thumb;
// on is a `brand` track under a light thumb. Both halves flip together, so the
// two states differ by track hue AND by thumb lightness — a user who misses one
// signal still has the other. Shading one colour into a paler version of itself
// is exactly the failure being fixed here, so it is not an option.
//
// A NOTE ON WHY OFF IS NOT `fg-2`. The obvious "grey track / green track" pair
// is `fg-2` off and `brand` on. Those two measure 1.08:1 against each other —
// #5B6E64 and #15803D have almost the same relative luminance, differing only
// in saturation. That pairing would have shipped the reported bug again in
// house colours. `switch_contrast.test.ts` pins the shipped pairs and that
// rejected one so nobody re-proposes it.
//
// WHICH THEME SIGNAL THIS READS. NativeWind's own `useColorScheme`, not
// `useTheme()` from contexts/theme_context.tsx — deliberately, and it is worth
// saying why, because `components/goals/progress_ring.tsx` (the other component
// that has to read a colour rather than apply a class) reads `useTheme()`.
// `ThemeProvider` DRIVES NativeWind: its second effect calls
// `colorScheme.set(preference === "auto" ? "system" : preference)`, and every
// `dark:` class in the app resolves from that. A switch sits inside a `Card`
// and beside `Text` that are painted by those classes, so reading the same
// resolved scheme they read is what keeps it in step with its own row — via
// `useTheme()` it would be reading the upstream preference and re-deriving
// "auto" against the system scheme itself, a second opinion about a question
// NativeWind has already answered. It also means a `Switch` renders anywhere,
// provider or not, instead of throwing — the two screen tests that render one
// have no `ThemeProvider` today, and needing one is not something this
// component should impose on them.
import { useColorScheme } from "nativewind";
import { Switch as RNSwitch, type SwitchProps as RNSwitchProps } from "react-native";

import { palette } from "@/constants/colors";

/**
 * The colour props this component owns. A caller may not pass them — the whole
 * point is that every switch in the app is the same two states — so they are
 * omitted from the public props rather than merged with a caller's value.
 */
export type SwitchProps = Omit<
  RNSwitchProps,
  "trackColor" | "thumbColor" | "ios_backgroundColor"
>;

type SwitchTheme = {
  trackOff: string;
  trackOn: string;
  thumbOff: string;
  thumbOn: string;
};

export const SWITCH_COLORS: Record<"light" | "dark", SwitchTheme> = {
  light: {
    trackOff: palette.line,
    trackOn: palette.brand,
    thumbOff: palette["fg-2"],
    thumbOn: palette["on-brand"],
  },
  dark: {
    trackOff: palette["line-dark"],
    trackOn: palette["brand-dark"],
    thumbOff: palette["fg-2-dark"],
    thumbOn: palette["on-brand-dark"],
  },
};

/**
 * Disabled switches are still readable — the same two states, dimmed. The dim
 * is a style, not a fourth set of colours, because a disabled switch has to
 * keep saying which state it is in: Privacy's master pause disables itself
 * while the write is in flight, and that is precisely the moment a user is
 * looking at it to see whether the tap took.
 */
export const SWITCH_DISABLED_OPACITY = 0.5;

export function Switch({ value, disabled = false, style, ...rest }: SwitchProps) {
  const { colorScheme } = useColorScheme();
  const colors = SWITCH_COLORS[colorScheme === "dark" ? "dark" : "light"];

  return (
    <RNSwitch
      {...rest}
      value={value}
      disabled={disabled}
      trackColor={{ false: colors.trackOff, true: colors.trackOn }}
      thumbColor={value === true ? colors.thumbOn : colors.thumbOff}
      // iOS draws the off track from its own prop, not from `trackColor.false`.
      ios_backgroundColor={colors.trackOff}
      style={[{ opacity: disabled ? SWITCH_DISABLED_OPACITY : 1 }, style]}
    />
  );
}
