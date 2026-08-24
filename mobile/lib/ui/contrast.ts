// lib/ui/contrast.ts — WCAG relative-luminance arithmetic, and the alpha rule
// the design uses for soft chips.
//
// WHY THIS IS A MODULE AND NOT A COMMENT. constants/colors.ts already carries
// hand-computed contrast figures in prose, and its own header records that a
// previous set of those figures was WRONG and shipped. Prose cannot fail CI.
// This file exists so components/ui/__tests__/chip_contrast.test.ts can assert
// the numbers instead of asserting that somebody checked them.

type Rgb = { r: number; g: number; b: number };

function parseHex(hex: string): Rgb {
  const value = hex.replace("#", "");
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function channelLuminance(channel: number): number {
  const proportion = channel / 255;
  return proportion <= 0.03928
    ? proportion / 12.92
    : ((proportion + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** WCAG 2.1 contrast ratio, 1..21. Order-independent. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The design's soft-chip rule: background is the semantic token at 12-14%
 * alpha (`rgba(217,119,6,.14)` for "due today", `rgba(220,38,38,.12)` for
 * "overdue 2d" on the 00 Component sheet). Text stays the token at full
 * strength — except `warn`, which needs `warn-ink`; see constants/colors.ts.
 */
export function softBackground(hex: string, alpha: number): string {
  const { r, g, b } = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
