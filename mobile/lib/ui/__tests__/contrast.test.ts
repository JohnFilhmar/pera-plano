import { palette } from "@/constants/colors";

import { contrastRatio, softBackground } from "../contrast";

test("contrastRatio matches known WCAG pairs", () => {
  expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
  expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 2);
  expect(contrastRatio("#FFFFFF", "#15803D")).toBeCloseTo(5.02, 1);
});

test("contrastRatio is symmetric", () => {
  expect(contrastRatio("#DC2626", "#F7FAF7")).toBeCloseTo(
    contrastRatio("#F7FAF7", "#DC2626"),
    5,
  );
});

test("softBackground returns rgba at the requested alpha", () => {
  expect(softBackground("#D97706", 0.14)).toBe("rgba(217, 119, 6, 0.14)");
  expect(softBackground("#DC2626", 0.12)).toBe("rgba(220, 38, 38, 0.12)");
});

const AA = 4.5;

/**
 * `brand-soft` is `constants/colors.ts`'s one OPAQUE soft token (#DCFCE7) —
 * unlike `chip.tsx`'s alpha-composited soft tint (`components/ui/
 * __tests__/chip_contrast.test.ts`), it needs no compositing step; the ink
 * sits directly on the flat colour a `bg-brand-soft` className paints.
 *
 * `brand` alone on it measures 4.567:1 — numerically over WCAG AA's 4.5:1
 * floor, but by only 0.067, which is why `components/gates/plus_gate.tsx`
 * moved to `brand-ink` instead of trusting that margin, and why
 * `review_queue_entry.tsx`, `how_it_works.tsx` and `button.tsx`'s `secondary`
 * variant all had to follow once each independently reached the same number.
 * Pinned here as the one place all four call sites' contrast claim can be
 * verified against the real palette values, so a future palette tweak that
 * moves either token fails this test instead of silently dropping one of
 * them below AA.
 */
test("brand-soft's own ink is brand-ink, not the bare brand tone — brand alone has no headroom", () => {
  expect(contrastRatio(palette.brand, palette["brand-soft"])).toBeCloseTo(4.567, 3);
  expect(contrastRatio(palette.brand, palette["brand-soft"])).toBeGreaterThanOrEqual(AA);
  expect(contrastRatio(palette["brand-ink"], palette["brand-soft"])).toBeGreaterThanOrEqual(AA);
  // Real headroom, not another hair's-width pass.
  expect(contrastRatio(palette["brand-ink"], palette["brand-soft"])).toBeGreaterThan(6);
});

test("dark mode's brand-soft pairing is comfortable either way — brand-ink-dark aliases brand-dark", () => {
  expect(palette["brand-ink-dark"]).toBe(palette["brand-dark"]);
  expect(
    contrastRatio(palette["brand-dark"], palette["brand-soft-dark"]),
  ).toBeGreaterThanOrEqual(AA);
});
