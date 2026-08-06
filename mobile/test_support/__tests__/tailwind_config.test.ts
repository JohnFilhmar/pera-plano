import { palette } from "@/constants/colors";
import config from "../../tailwind.config";

type ColorScale = Record<string, string>;

test("content globs are absolute real paths (junction-safe)", () => {
  const globs = config.content as string[];
  expect(globs.length).toBeGreaterThan(0);
  for (const glob of globs) {
    // POSIX absolute or Windows drive-letter absolute with forward slashes.
    expect(glob.startsWith("/") || /^[A-Za-z]:\//.test(glob)).toBe(true);
  }
});

test("every palette token is mapped into the tailwind color scales", () => {
  const colors = (config.theme?.extend?.colors ?? {}) as Record<string, ColorScale>;
  expect(colors.bg.DEFAULT).toBe(palette.bg);
  expect(colors.bg.dark).toBe(palette["bg-dark"]);
  expect(colors.surface.DEFAULT).toBe(palette.surface);
  expect(colors.surface.dark).toBe(palette["surface-dark"]);
  expect(colors.fg.DEFAULT).toBe(palette.fg);
  expect(colors.fg.dark).toBe(palette["fg-dark"]);
  expect(colors.fg["2"]).toBe(palette["fg-2"]);
  expect(colors.fg["2-dark"]).toBe(palette["fg-2-dark"]);
  expect(colors.brand.DEFAULT).toBe(palette.brand);
  expect(colors.brand.dark).toBe(palette["brand-dark"]);
  expect(colors.brand.soft).toBe(palette["brand-soft"]);
  expect(colors.brand["soft-dark"]).toBe(palette["brand-soft-dark"]);
  expect(colors.danger.DEFAULT).toBe(palette.danger);
  expect(colors.danger.dark).toBe(palette["danger-dark"]);
  expect(colors.warn.DEFAULT).toBe(palette.warn);
  expect(colors.warn.dark).toBe(palette["warn-dark"]);
  expect(colors["ph-blue"].DEFAULT).toBe(palette["ph-blue"]);
  expect(colors["ph-blue"].dark).toBe(palette["ph-blue-dark"]);
  expect(colors["ph-red"].DEFAULT).toBe(palette["ph-red"]);
  expect(colors["ph-red"].dark).toBe(palette["ph-red-dark"]);
  expect(colors["ph-yellow"].DEFAULT).toBe(palette["ph-yellow"]);
  expect(colors["ph-yellow"].dark).toBe(palette["ph-yellow-dark"]);
});

test("nativewind preset and Inter font family are wired", () => {
  expect(config.presets?.length).toBe(1);
  const fonts = (config.theme?.extend?.fontFamily ?? {}) as Record<string, string[]>;
  expect(fonts.sans).toEqual(["Inter_400Regular"]);
});
