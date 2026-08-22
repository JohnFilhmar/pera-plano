import { contrastRatio, softBackground } from "@/lib/ui/contrast";
import { palette } from "@/constants/colors";
import { SOFT_ALPHA } from "../chip";

/**
 * A soft chip is ink on a tint of itself, laid over the page background. The
 * tint is translucent, so the colour actually under the ink is the tint
 * composited onto `bg` — not the tint alone. Compose it here the same way the
 * device does, then measure.
 */
function composite(tokenHex: string, alpha: number, backdropHex: string): string {
  const parse = (hex: string) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const [tr, tg, tb] = parse(tokenHex);
  const [br, bg, bb] = parse(backdropHex);
  const mix = (t: number, b: number) => Math.round(t * alpha + b * (1 - alpha));
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(mix(tr, br))}${hex(mix(tg, bg))}${hex(mix(tb, bb))}`;
}

const AA = 4.5;

test.each([
  ["brand light", palette.brand, palette.brand, palette.bg],
  ["brand dark", palette["brand-dark"], palette["brand-dark"], palette["bg-dark"]],
  ["danger light", palette.danger, palette.danger, palette.bg],
  ["danger dark", palette["danger-dark"], palette["danger-dark"], palette["bg-dark"]],
  ["warn light", palette["warn-ink"], palette.warn, palette.bg],
  ["warn dark", palette["warn-ink-dark"], palette["warn-dark"], palette["bg-dark"]],
])("soft chip %s clears WCAG AA", (_label, ink, tint, backdrop) => {
  const surface = composite(tint, SOFT_ALPHA, backdrop);
  expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(AA);
});

test("soft warn uses warn-ink, not warn — warn on its own tint fails AA", () => {
  const surface = composite(palette.warn, SOFT_ALPHA, palette.bg);
  expect(contrastRatio(palette.warn, surface)).toBeLessThan(AA);
  expect(contrastRatio(palette["warn-ink"], surface)).toBeGreaterThanOrEqual(AA);
});

test("softBackground is the value the component actually renders", () => {
  expect(softBackground(palette.warn, SOFT_ALPHA)).toContain("rgba(");
});
