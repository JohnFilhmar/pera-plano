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
        "ph-blue": { DEFAULT: palette["ph-blue"], dark: palette["ph-blue-dark"] },
        "ph-red": { DEFAULT: palette["ph-red"], dark: palette["ph-red-dark"] },
        "ph-yellow": { DEFAULT: palette["ph-yellow"], dark: palette["ph-yellow-dark"] },
      },
    },
  },
  plugins: [
    // React Native does not synthesise weight for a family registered through
    // expo-font: `Inter_600SemiBold` is a FAMILY NAME, not a weight of `Inter`,
    // so `fontWeight: "600"` is inert on Android. Tailwind's own font-weight
    // utilities therefore did nothing here — every `font-semibold` in the app
    // rendered at 400. Overriding them to emit `fontFamily` makes all 166
    // existing call sites correct without renaming any of them.
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
