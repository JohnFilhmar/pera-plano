import fs from "fs";
import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
import { palette } from "./constants/colors";

const root = fs.realpathSync(__dirname).replace(/\\/g, "/");

export default {
  content: [
    `${root}/app/**/*.{js,jsx,ts,tsx}`,
    `${root}/components/**/*.{js,jsx,ts,tsx}`,
  ],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter_400Regular"] },
      fontSize: {
        hero: ["40px", { lineHeight: "40px" }],
        title: ["20px", { lineHeight: "26px" }],
        section: ["15px", { lineHeight: "20px" }],
        body: ["14px", { lineHeight: "20px" }],
        row: ["13px", { lineHeight: "18px" }],
        secondary: ["12px", { lineHeight: "16px" }],
        micro: ["11px", { lineHeight: "14px" }],
        badge: ["10px", { lineHeight: "12px" }],
      },
      colors: {
        bg: { DEFAULT: palette.bg, dark: palette["bg-dark"] },
        surface: { DEFAULT: palette.surface, dark: palette["surface-dark"] },
        fg: {
          DEFAULT: palette.fg,
          dark: palette["fg-dark"],
          "2": palette["fg-2"],
          "2-dark": palette["fg-2-dark"],
        },
        brand: {
          DEFAULT: palette.brand,
          dark: palette["brand-dark"],
          soft: palette["brand-soft"],
          "soft-dark": palette["brand-soft-dark"],
        },
        "on-brand": { DEFAULT: palette["on-brand"], dark: palette["on-brand-dark"] },
        danger: { DEFAULT: palette.danger, dark: palette["danger-dark"] },
        warn: { DEFAULT: palette.warn, dark: palette["warn-dark"] },
        line: { DEFAULT: palette.line, dark: palette["line-dark"] },
        chip: { DEFAULT: palette.chip, dark: palette["chip-dark"] },
        "warn-ink": { DEFAULT: palette["warn-ink"], dark: palette["warn-ink-dark"] },
        "ph-blue": { DEFAULT: palette["ph-blue"], dark: palette["ph-blue-dark"] },
        "ph-red": { DEFAULT: palette["ph-red"], dark: palette["ph-red-dark"] },
        "ph-yellow": { DEFAULT: palette["ph-yellow"], dark: palette["ph-yellow-dark"] },
      },
    },
  },
  // Tailwind's core font-weight utilities are switched OFF, not merely
  // overridden. `addUtilities` below reuses the same class names, but it only
  // sets `fontFamily` — it never sets `fontWeight`, so the core rule is not
  // contested, it simply survives as a second declaration block for the same
  // selector. NativeWind merges those at the property level, which would leave
  // every weight class resolving to BOTH a numeric weight and a family.
  //
  // That is inert on Android against a single-face family and would stay inert
  // for as long as this app ships Android-only. Disabling the core plugin makes
  // the mechanism match what its name claims instead of relying on a platform
  // quirk to stay harmless — and stops a future variable-font Inter from having
  // two sources of truth for weight.
  //
  // `font-thin`, `font-extralight`, `font-light` and `font-black` disappear with
  // it. No loaded Inter face backs any of them and none has a call site.
  corePlugins: { fontWeight: false },
  plugins: [
    // Core font-weight utilities are switched off above, so these class names
    // are redefined here to select a family — not overridden in place, since
    // the core rule they used to emit no longer exists to contest.
    // `expo-font` registers one family name per file, so `Inter_600SemiBold`
    // is a FAMILY NAME, not a weight of `Inter`, which is why
    // `fontWeight: "600"` was inert on Android in the first place — every
    // `font-semibold` in the app rendered at 400. Renaming the loaded fonts
    // instead of redefining these classes was not an option either: Tailwind
    // emits both `font-{family}` and `font-{weight}` under the same `font-`
    // prefix, so a family named `semibold` would collide with the weight
    // utility of the same name. Redefining `.font-semibold` (and its
    // siblings) to emit `fontFamily` sidesteps both problems and leaves all
    // 166 existing call sites correct without renaming any of them.
    plugin(({ addUtilities }) => {
      addUtilities({
        ".font-normal": { fontFamily: "Inter_400Regular" },
        ".font-medium": { fontFamily: "Inter_500Medium" },
        ".font-semibold": { fontFamily: "Inter_600SemiBold" },
        ".font-bold": { fontFamily: "Inter_700Bold" },
        ".font-extrabold": { fontFamily: "Inter_800ExtraBold" },
      });
    }),
  ],
} satisfies Config;
