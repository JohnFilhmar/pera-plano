import fs from "fs";
import type { Config } from "tailwindcss";
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
  plugins: [],
} satisfies Config;
