export const palette = {
  brand: "#15803D",        "brand-dark": "#22C55E",
  "brand-soft": "#DCFCE7", "brand-soft-dark": "#14261C",
  bg: "#F7FAF7",           "bg-dark": "#0B1210",
  surface: "#FFFFFF",      "surface-dark": "#111A16",
  fg: "#10201A",           "fg-dark": "#E8F0EC",
  "fg-2": "#5B6E64",       "fg-2-dark": "#9BB0A6",
  danger: "#DC2626",       "danger-dark": "#F87171",
  warn: "#D97706",         "warn-dark": "#FBBF24",
  "ph-blue": "#0038A8",    "ph-blue-dark": "#4D7CDB",
  "ph-red": "#CE1126",     "ph-red-dark": "#E4566A",
  "ph-yellow": "#FCD116",  "ph-yellow-dark": "#FCD116",

  // -------------------------------------------------------------------------
  // CHART-ONLY DATA-VISUALISATION RAMP. NOT semantic — keep it that way.
  // Every token above this line carries a MEANING: `brand` reads as "good",
  // `danger` as "wrong", `warn` as "be careful". A donut/pie slice carries
  // none of those — it means only "this category, not the one beside it" —
  // so `chart-1`..`chart-8` (each with a `-dark` variant, same convention as
  // every semantic pair above) live in their own block and must never be
  // reused to paint a status, and no semantic token above may be repurposed
  // as a chart colour either. `components/reports/donut_chart.tsx` is the
  // only reader; its own header explains the deterministic id→colour hash
  // that indexes into this ramp.
  //
  // Chosen owner-approved 2026-08-16 (M3b chart-colours task) to replace the
  // old approach of hashing into 6 borrowed semantic tokens (of which
  // `danger` and `ph-red` read as near-identical reds in practice, leaving
  // ~5 usable slots against 15 seeded categories — frequent collisions).
  //
  // HOW THE EIGHT WERE PICKED (full reasoning in the task report):
  //   - Hue sweeps teal -> cyan -> blue -> indigo -> violet -> purple ->
  //     magenta -> rose (roughly H172 to H325), deliberately staying OFF the
  //     red/orange/green arcs `danger` (~H0/H353), `warn` (~H32) and `brand`
  //     (~H142) occupy, with a >=20-degree hue buffer from each. No hue here
  //     reads as red or green, so rule "never put a red and a green next to
  //     each other in the ramp order" is satisfied by construction.
  //   - The teal-to-rose arc avoids the red-green axis on purpose: that axis
  //     is exactly what collapses under deuteranopia/protanopia, so hues
  //     built from the blue/purple side of the wheel (the same choice
  //     ColorBrewer's "safe" qualitative sets and the Okabe-Ito CUD palette
  //     make) stay distinguishable when red-green perception does not.
  //   - Lightness ALSO zig-zags (~38% / ~50% light-mode L, alternating down
  //     each ramp slot) so two adjacent slices differ by lightness alone,
  //     not hue alone — the fallback signal for anyone whose hue perception
  //     fails entirely on a given pair.
  //   - Dark variants keep the same hue and go lighter (+16 to +20 points of
  //     L, matching how `brand`->`brand-dark` and the other pairs above
  //     step up) and slightly less saturated, for legibility against
  //     `bg-dark` #0B1210 / `surface-dark` #111A16 the same way the light
  //     variants are tuned for `bg` #F7FAF7 / `surface` #FFFFFF.
  //   - Verification was manual HSL-space arithmetic (converting every
  //     semantic token to HSL and checking degree gaps), NOT an actual
  //     colour-blindness simulator — nobody ran this ramp through a Coblis/
  //     DevTools deuteranopia emulation before shipping it. That is the
  //     rigorous next step before treating this as fully verified.
  "chart-1": "#22A08F", "chart-1-dark": "#4FCFBE",
  "chart-2": "#33A3CC", "chart-2-dark": "#7FBFD7",
  "chart-3": "#2250A0", "chart-3-dark": "#4F7ECF",
  "chart-4": "#393EC6", "chart-4-dark": "#8386D2",
  "chart-5": "#583399", "chart-5-dark": "#8867C1",
  "chart-6": "#9E4ABF", "chart-6-dark": "#BC8DCE",
  "chart-7": "#9E2E95", "chart-7-dark": "#C662BE",
  "chart-8": "#BF4088", "chart-8-dark": "#CD84AD",
} as const;
