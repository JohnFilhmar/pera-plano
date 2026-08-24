export const palette = {
  brand: "#15803D",        "brand-dark": "#22C55E",
  "brand-soft": "#DCFCE7", "brand-soft-dark": "#14261C",
  bg: "#F7FAF7",           "bg-dark": "#0B1210",
  surface: "#FFFFFF",      "surface-dark": "#111A16",
  fg: "#10201A",           "fg-dark": "#E8F0EC",
  "fg-2": "#5B6E64",       "fg-2-dark": "#9BB0A6",
  danger: "#DC2626",       "danger-dark": "#F87171",
  warn: "#D97706",         "warn-dark": "#FBBF24",
  line: "#E3EBE5",         "line-dark": "#22302A",
  chip: "#EDF3EE",         "chip-dark": "#18231E",

  // SOFT-CHIP INK for `brand`, `danger`, AND `warn` — three tokens, one job,
  // and NEVER a fill. A soft chip is semantic-colour text on a 12-14% tint of
  // that same colour, composited over `bg` #F7FAF7 (`rgba(217,119,6,.14)` +
  // `var(--wn)` for "due today" on the 00 Component sheet). The design's
  // original rule was simpler than this: no separate ink token at all, just
  // the base tone at full strength as its own ink. That rule fails AA for
  // every tone it was tried on, not only `warn` — at the shipped
  // `SOFT_ALPHA` (chip.tsx, 0.14), ink-on-its-own-tint measures:
  //   - `brand`  #15803D on its own 14% tint over `bg`: 3.96:1
  //   - `danger` #DC2626 on its own 14% tint over `bg`: 3.69:1
  //   - `warn`   #D97706 on its own 14% tint over `bg`: 2.63:1 — the worst
  //     of the three, because amber is the lightest of the three hues and
  //     has the least luminance contrast against `bg` to begin with, before
  //     any tint dilutes it further.
  // All three sit under AA's 4.5:1 floor for normal text (WCAG 2.1 SC 1.4.3).
  // components/ui/__tests__/chip_contrast.test.ts asserts all three (plus
  // both dark rows), so none of this can regress silently the way the
  // figures below once did.
  //
  // The first fix tried, for `warn` alone, was `#B45309` — the same hue two
  // steps darker. It shipped, and this file's comment used to claim it
  // cleared 4.5:1. It does not: it measures 4.14:1, still under the bar.
  // Naming it here so nobody re-proposes it: one step darker is not enough
  // headroom once the tint is composited back onto `bg`.
  //
  // Alpha cannot rescue any of the three either. `warn`'s ceiling — contrast
  // with ZERO visible tint, ink painted straight on `bg`, the best case
  // physically possible — is 3.03:1, already under 4.5 before any tint
  // dilutes it further, so no alpha helps `warn` at all. `brand` (4.77:1)
  // and `danger` (4.59:1) technically clear 4.5 at that same zero-tint
  // limit, but zero tint is not a soft chip, it is ink on an invisible
  // background; walking alpha back up toward anything a user would actually
  // call "tinted" drops both back under 4.5 almost immediately — brand
  // around alpha≈0.045, danger around alpha≈0.015 — nowhere near the 12-14%
  // the design calls for, and far below the level `SOFT_ALPHA`'s own comment
  // (chip.tsx) says 0.14 was chosen to clear: visible against `surface`
  // white. There is no usable alpha at which any of the three read AA on
  // their own colour. The ink has to change, not the alpha.
  //
  // The shipped fix darkens each tone by one Tailwind 800-weight step,
  // chosen together rather than one at a time so the three read as one
  // family instead of three ad-hoc picks:
  //   - `brand-ink`  #166534 on brand's 14% tint:  5.63:1 — clears AA.
  //   - `danger-ink` #991B1B on danger's 14% tint:  6.36:1 — clears AA.
  //   - `warn-ink`   #92400E on warn's 14% tint:    5.85:1 — clears AA.
  //
  // These are INK ONLY. Never reach for `brand-ink` / `danger-ink` /
  // `warn-ink` as a fill, a border, or an icon colour on a SOLID background —
  // they exist for exactly one job, text sitting on that hue's own soft
  // tint, and they are tuned for contrast against that composited tint
  // specifically, not against `surface`, `bg`, or a solid fill of the base
  // tone.
  //
  // Dark mode needs no equivalent for any of the three. Every dark tone
  // already clears AA comfortably on its own tint — `warn-dark` measures
  // 8.66:1 against its own 14% tint over `bg-dark`, `brand-dark` 6.68:1, and
  // `danger-dark` 5.74:1 — because the dark-mode fills were already picked
  // bright enough to read against a near-black page, and that same
  // brightness is what makes each legible on a translucent tint of itself
  // too. Darkening any of them further for a soft chip would fight that
  // design, not help it, so `*-ink-dark` below is an alias of the existing
  // bright token, not a new colour.
  "brand-ink": "#166534",  "brand-ink-dark": "#22C55E",
  "danger-ink": "#991B1B", "danger-ink-dark": "#F87171",
  "warn-ink": "#92400E",   "warn-ink-dark": "#FBBF24",
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

  // -------------------------------------------------------------------------
  // ON-BRAND FOREGROUND. The colour that sits ON TOP of a `brand`/`brand-dark`
  // (or `danger`/`danger-dark`) FILL — a filled control's label/icon, e.g.
  // `components/ui/button.tsx`'s primary and destructive variants. This is a
  // different idea from `surface`, which means "a page/card BACKGROUND", and
  // it earns its own token rather than borrowing `surface`'s.
  //
  // Device-testing fix (2026-08-18, Task 8): `VARIANT_FG.primary` read
  // `text-surface dark:text-surface-dark` before this token existed. In LIGHT
  // mode that is white-on-`brand` — a readable pairing, but readable BY
  // ACCIDENT, because `surface` (a background colour) happens to be white,
  // which is also a colour that reads on `brand`. In DARK mode the same
  // borrowed token resolves to `surface-dark` (#111A16, near-black — chosen
  // to sit UNDER `fg-dark` text, not to sit ON a fill) painted onto
  // `brand-dark` (#22C55E, a BRIGHT accent green picked to pop off a near-
  // black background, not to be painted over). The two tokens' reasons for
  // being the colour they are have nothing to do with each other; the fact
  // that borrowing one produced a legible result was luck, not design, and
  // the next time either `surface` or `brand` moves for its own reasons the
  // pairing breaks silently. `on-brand`/`on-brand-dark` names the actual
  // relationship ("the ink for a brand-filled control") so it can be tuned on
  // its own terms.
  //
  // VALUES. `on-brand` (#FFFFFF) and `on-brand-dark` (#111A16) happen to equal
  // `surface`/`surface-dark` today — the physical colours a light fill and a
  // bright fill each need for legible ink both already exist in the palette,
  // so this token points at them by VALUE by choice, not by aliasing the
  // `surface` KEY. If a future redesign moves `surface` for background
  // reasons, `on-brand` does not move with it.
  //
  // CONTRAST (WCAG relative-luminance formula, verified with a small Node
  // script — see the device-testing Task 8 report for the exact numbers):
  //   - `on-brand` (#FFFFFF) on `brand` (#15803D):            5.02:1 — passes
  //     AA for normal text (>=4.5:1).
  //   - `on-brand-dark` (#111A16) on `brand-dark` (#22C55E):  7.79:1 — passes
  //     AAA (>=7:1).
  //   - Also the pairing `VARIANT_FG.destructive` repoints here:
  //     `on-brand` on `danger` (#DC2626):                     4.83:1 — passes
  //     AA for normal text.
  //     `on-brand-dark` on `danger-dark` (#F87171):           6.42:1 — passes
  //     AA, just under AAA.
  "on-brand": "#FFFFFF", "on-brand-dark": "#111A16",
} as const;
