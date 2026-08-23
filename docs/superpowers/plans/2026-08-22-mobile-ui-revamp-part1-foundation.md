# Mobile UI Revamp — Part 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the design system the other two parts consume — real font weights, two new tokens, and the atoms from the design's 00 Component sheet — so that every screen improves before any screen is touched.

**Architecture:** Bottom-up. Fonts first, alone, because adding weights shifts glyph metrics on every screen at once and that shift must be attributable to one commit. Then tokens, then atoms. Nothing in this part opens a screen file except `app/(tabs)/_layout.tsx` (tab bar) and `app/_layout.tsx` (font loading).

**Tech Stack:** Expo 54 · React Native 0.81.5 · expo-router 6 · NativeWind 4.2.6 · Tailwind 3.4.19 · lucide-react-native · react-native-svg 15.12.1 · Reanimated 4.1.1 · jest-expo + @testing-library/react-native

**Spec:** `docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md`

## Global Constraints

- **`testID`s are preserved.** No existing `testID` is renamed or removed anywhere in this revamp. Adding new ones is fine.
- **Tokens are the only colour source.** No literal hex in a component. Two authorised exceptions, both outside `components/`, both with their reasoning written into the file:
  - **Soft-chip inks** in `constants/colors.ts` — `brand-ink` `#166534`, `danger-ink` `#991B1B`, `warn-ink` `#92400E`. These are tokens; they are listed here because they are new. *(This line originally named `#B45309` as the single new hex. That value measured 4.13:1 and failed AA, and the problem turned out to affect all three tones, not just amber — see Task 2's `warn-ink` step below and `constants/colors.ts`'s own SOFT-CHIP INK comment for the measured history. Task 2's body named the wrong task here too; the figures below had not been corrected the way this line was.)*
  - **Provider identity colours** in `constants/providers.ts` — 13 brand colours plus one grey fallback, as literal hex. They are deliberately NOT in `palette`: a provider colour identifies a company and must never signal a state.
- **`chart-1..8` is non-semantic.** Never paint a status with a chart colour, never paint a chart slice with a semantic one. `components/reports/donut_chart.tsx` is its only reader.
- **`soon` grey never moves.** `SoonGate` renders `Chip` with `tone="soon"`. Grey means "not built"; brand green means "needs Plus". A chip that picks the wrong one makes a promise the app will not keep.
- **Naming:** files and functions `snake_case`; React components and their files `PascalCase`; types/interfaces `PascalCase`; constants `UPPER_SNAKE_CASE`. Match the surrounding file when it already differs.
- **Comments:** this codebase writes long explanatory headers on non-obvious decisions. Follow that. Do not add comments that restate the code.
- **Money:** `₱`, centavos always, tabular figures, true minus `−` (U+2212) not a hyphen. `formatCentavos` in `components/ui/amount_text.tsx` already owns this.
- **Commands:** `npm test` (jest --ci) · `npm run typecheck` (tsc --noEmit) · `npm run android` (expo run:android) — all from `mobile/`.

## Spec amendments discovered while planning

Three corrections to the spec, applied in Task 0. They are recorded here because the spec was committed before these files were read.

1. **The Transactions tab badge already exists.** `app/(tabs)/_layout.tsx` sets `badged: true` and renders `ReviewCountBadge`. Spec §5.1 and D6 list it as new. Only the **FAB** is new. The badge does need a colour change — it is `bg-brand` (green) today, and the design draws it red.
2. **`elevation` cannot be a `palette` token.** `constants/__tests__/colors.test.ts` asserts every light token has a `-dark` sibling and that every value is a hex string. Dark-mode elevation becomes a `line-dark` hairline on `Card` instead. **Two** new token pairs (`line`, `chip`), not three.
3. **Font weights need a Tailwind plugin, not a rename.** `font-semibold` appears 149 times, `font-medium` 14, `font-bold` 3 — 166 usages across 76 files. Task 1 overrides those utilities to emit `fontFamily` rather than renaming call sites.

---

### Task 0: Record the three spec amendments

**Files:**
- Modify: `docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing in code. This exists so the spec and the plan do not disagree, since both are committed and both will be read.

- [ ] **Step 1: Fix the tab-badge claim in §5.1**

In §5.1, replace `Bills strip restyled. FAB added.` with:

```markdown
Bills strip restyled. FAB added. The Transactions tab badge already exists
(`app/(tabs)/_layout.tsx` sets `badged: true` and renders `ReviewCountBadge`); it is
recoloured from `bg-brand` to `bg-danger` to match the board, not built from scratch.
```

- [ ] **Step 2: Fix the token count in §3.1**

In §3.1, delete the `elevation` row from the token table and replace the table's trailing sentence with:

```markdown
Dark-mode elevation is **not** a token. `constants/__tests__/colors.test.ts` asserts every
`palette` key has a `-dark` sibling and holds a hex string, and a shadow string is neither.
`Card` keeps `shadow-sm` in light and gains a `dark:border dark:border-line-dark` hairline
instead — a drop shadow on `#0B1210` is invisible regardless.
```

- [ ] **Step 3: Add the font-weight mechanism to §7 R1**

Append to R1's **Resolution** paragraph:

```markdown
The weights are wired through a Tailwind plugin that overrides `font-normal` /
`font-medium` / `font-semibold` / `font-bold` / `font-extrabold` to emit `fontFamily`
rather than `fontWeight`. React Native does not synthesise weight for a single-weight
registered family, so `fontWeight` is inert on Android; overriding the utilities keeps all
166 existing call sites working and makes them render the correct weight for the first
time, with no codemod across 76 files.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md
git commit -m "docs: correct three spec claims found while planning part 1"
```

---

### Task 1: Real Inter weights

**Files:**
- Modify: `mobile/app/_layout.tsx:50` (import), `mobile/app/_layout.tsx:382` (`useFonts`)
- Modify: `mobile/tailwind.config.ts`
- Create: `mobile/test_support/__tests__/font_weights.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the classes `font-normal`, `font-medium`, `font-semibold`, `font-bold`, `font-extrabold` now resolve to `fontFamily: "Inter_400Regular" | "Inter_500Medium" | "Inter_600SemiBold" | "Inter_700Bold" | "Inter_800ExtraBold"`. Also the `fontSize` scale `text-hero | text-title | text-section | text-body | text-row | text-secondary | text-micro | text-badge`, used by every later task.

**Why a plugin instead of renaming.** `expo-font` registers one family name per file, so `Inter_600SemiBold` is a *family*, not a weight of `Inter`. Setting `fontWeight: "600"` on Android against a single-weight family does nothing. Tailwind emits both `font-{family}` and `font-{weight}` under the same `font-` prefix, so adding families named `semibold` would collide with the weight utilities. Overriding the weight utilities to emit `fontFamily` sidesteps both problems and leaves 166 call sites untouched.

- [ ] **Step 1: Write the failing test**

Create `mobile/test_support/__tests__/font_weights.test.ts`:

```ts
import config from "../../tailwind.config";

type FontUtilities = Record<string, { fontFamily: string }>;

function collectAddedUtilities(): FontUtilities {
  const collected: FontUtilities = {};
  for (const entry of config.plugins ?? []) {
    const handler = (entry as { handler?: (api: unknown) => void }).handler;
    if (handler === undefined) continue;
    handler({
      addUtilities: (utilities: FontUtilities) => Object.assign(collected, utilities),
    });
  }
  return collected;
}

test("every weight utility resolves to a real Inter family, not a fontWeight", () => {
  const utilities = collectAddedUtilities();
  expect(utilities[".font-normal"]).toEqual({ fontFamily: "Inter_400Regular" });
  expect(utilities[".font-medium"]).toEqual({ fontFamily: "Inter_500Medium" });
  expect(utilities[".font-semibold"]).toEqual({ fontFamily: "Inter_600SemiBold" });
  expect(utilities[".font-bold"]).toEqual({ fontFamily: "Inter_700Bold" });
  expect(utilities[".font-extrabold"]).toEqual({ fontFamily: "Inter_800ExtraBold" });
});

test("no weight utility emits fontWeight, which Android ignores for a loaded family", () => {
  for (const style of Object.values(collectAddedUtilities())) {
    expect(style).not.toHaveProperty("fontWeight");
  }
});

test("the design's type scale is present and sized as the spec's table states", () => {
  const sizes = config.theme?.extend?.fontSize as Record<string, [string, { lineHeight: string }]>;
  expect(sizes.hero[0]).toBe("40px");
  expect(sizes.title[0]).toBe("20px");
  expect(sizes.section[0]).toBe("15px");
  expect(sizes.body[0]).toBe("14px");
  expect(sizes.row[0]).toBe("13px");
  expect(sizes.secondary[0]).toBe("12px");
  expect(sizes.micro[0]).toBe("11px");
  expect(sizes.badge[0]).toBe("10px");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- font_weights`
Expected: FAIL — `config.plugins` is `[]`, so `collectAddedUtilities()` returns `{}` and `utilities[".font-normal"]` is `undefined`.

- [ ] **Step 3: Load the four new faces**

In `mobile/app/_layout.tsx`, replace the import on line 50:

```ts
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from "@expo-google-fonts/inter";
```

and the call on line 382:

```ts
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
```

- [ ] **Step 4: Add the plugin and the type scale**

In `mobile/tailwind.config.ts`, add the import at the top:

```ts
import plugin from "tailwindcss/plugin";
```

Add `fontSize` inside `theme.extend`, beside the existing `fontFamily` and `colors`:

```ts
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
```

Replace `plugins: []` with:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- font_weights`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test` then `npm run typecheck`
Expected: both clean. If `tsc` objects to `config.theme?.extend?.fontSize` in the test, cast through `as Record<string, unknown>` in the test only — never loosen `tailwind.config.ts`'s own `satisfies Config`.

- [ ] **Step 7: Build to the A54 and audit truncation**

Run: `npm run android`

Walk all five tab roots and confirm on the device, not the emulator:

1. Tab bar — "Transactions" is the longest label. It must not clip or ellipsise at 360dp.
2. Every `Button` — labels must not wrap. The longest today are "Send a test notification" and "Delete source notifications now".
3. Every `ListRow` — `title` and `subtitle` are `numberOfLines={1}`. Confirm nothing that fit before now truncates.
4. `components/ui/amount_text.tsx` at `size="hero"` — the hero figure must not wrap at `₱1,000,000.00`.

Fix anything that clips **inside this commit**, so the metric shift stays attributable to it.

**If the plugin does not take effect on device** (text still renders at 400): NativeWind's postcss pipeline did not pick up `addUtilities`. Fall back to explicit families — add `"sans-medium" | "sans-semibold" | "sans-bold" | "sans-extrabold"` to `theme.extend.fontFamily`, then run the codemod from `mobile/`:

```bash
grep -rlE 'font-(medium|semibold|bold|extrabold)' app components \
  | xargs sed -i -E 's/\bfont-(medium|semibold|bold|extrabold)\b/font-sans-\1/g'
```

Then re-run `npm test` and fix the assertions in `components/ui/__tests__/` that match on `font-semibold`.

- [ ] **Step 8: Commit**

```bash
git add mobile/app/_layout.tsx mobile/tailwind.config.ts mobile/test_support/__tests__/font_weights.test.ts
git commit -m "feat(ui): load real Inter weights and the design's type scale"
```

---

### Task 2: Tokens and the soft-tone rule

**Files:**
- Modify: `mobile/constants/colors.ts`
- Modify: `mobile/tailwind.config.ts`
- Modify: `mobile/constants/__tests__/colors.test.ts`
- Create: `mobile/lib/ui/contrast.ts`
- Create: `mobile/lib/ui/__tests__/contrast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `palette.line` / `palette["line-dark"]`, `palette.chip` / `palette["chip-dark"]`, `palette["warn-ink"]` / `palette["warn-ink-dark"]` — used by Tasks 3–9.
  - `contrastRatio(foreground: string, background: string): number` — hex in, WCAG ratio out. Used by Task 3's contrast test.
  - `softBackground(hex: string, alpha: number): string` — returns `rgba(r, g, b, a)`. Used by `Chip`'s soft fill.

**Why `warn-ink` exists.** `warn` `#D97706` on a 14% tint of itself fails AA at the 11sp the design sets "due today" in — the true figure is 2.63:1, not the "~3.6:1" this paragraph originally claimed. `#B45309` is NOT the value that ships: it measures 4.13:1, still under the 4.5:1 floor, and the same failure turned out to hit `brand` (3.96:1) and `danger` (3.69:1) too, not only `warn`. The value that ships is `constants/colors.ts`'s own SOFT-CHIP INK block (`warn-ink` `#92400E`, alongside `brand-ink` and `danger-ink`) — read the figure there and verify it with `lib/ui/contrast.ts` rather than copying a number out of this paragraph. This exact mistake, hand-computed and wrong, is why that rule exists (spec R6).

- [ ] **Step 1: Write the failing contrast test**

Create `mobile/lib/ui/__tests__/contrast.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- contrast`
Expected: FAIL — `Cannot find module '../contrast'`.

- [ ] **Step 3: Implement the contrast helpers**

Create `mobile/lib/ui/contrast.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- contrast`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing token test**

Append to `mobile/constants/__tests__/colors.test.ts`:

```ts
test("the design's line and chip surfaces are verbatim", () => {
  expect(palette.line).toBe("#E3EBE5");
  expect(palette["line-dark"]).toBe("#22302A");
  expect(palette.chip).toBe("#EDF3EE");
  expect(palette["chip-dark"]).toBe("#18231E");
});

test("warn-ink is darker than warn, and exists only as soft-chip ink", () => {
  expect(palette["warn-ink"]).toBe("#92400E");
  expect(palette["warn-ink-dark"]).toBe("#FBBF24");
});
```

**This step's own value has already been wrong once.** `#92400E` above is the value that ships — not `#B45309`, which this step originally specified and which measures 4.13:1, under the 4.5:1 floor. The shipped `constants/__tests__/colors.test.ts` also does not keep this as its own standalone test: it bundles this assertion with `brand-ink` and `danger-ink` into one `"brand-ink, danger-ink, and warn-ink are darker than their base tone..."` test, because the AA failure this step frames as warn-only turned out to hit all three tones (see Step 7 below).

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- colors`
Expected: FAIL — `expect(undefined).toBe("#E3EBE5")`.

- [ ] **Step 7: Add the tokens**

In `mobile/constants/colors.ts`, add immediately after the `warn` line in the top block:

```ts
  line: "#E3EBE5",         "line-dark": "#22302A",
  chip: "#EDF3EE",         "chip-dark": "#18231E",

  // SOFT-CHIP INK. Never a fill. The design's soft chips are semantic-colour
  // text on a 12-14% tint of that same colour (`rgba(217,119,6,.14)` +
  // `var(--wn)` for "due today" on the 00 Component sheet). That pairing
  // FAILS AA for every tone it was tried on, not only `warn`: #D97706 on its
  // own 14% tint over `bg` #F7FAF7 measures 2.63:1, `brand` #15803D measures
  // 3.96:1, `danger` #DC2626 measures 3.69:1 — all under the 4.5:1 floor, and
  // "due today" is precisely the chip that has to be read on a phone
  // outdoors.
  //
  // DO NOT HAND-COMPUTE A REPLACEMENT VALUE HERE. This block already shipped
  // one wrong fix — `#B45309`, believed to be "the same hue two steps darker"
  // and to clear 4.5:1 at that. It measures 4.13:1 and does not clear.
  // `components/ui/__tests__/chip_contrast.test.ts` and
  // `constants/__tests__/colors.test.ts` assert the shipped figure below so
  // it cannot regress silently again — verify with `lib/ui/contrast.ts`,
  // don't copy a number out of a comment (spec R6).
  //
  // Dark mode keeps `warn-dark` unchanged: amber on a dark tint is already
  // well clear of AA, and darkening it there would make it harder to read,
  // not easier.
  "warn-ink": "#92400E",   "warn-ink-dark": "#FBBF24",
```

- [ ] **Step 8: Expose the tokens to Tailwind**

In `mobile/tailwind.config.ts`, add inside `theme.extend.colors`:

```ts
        line: { DEFAULT: palette.line, dark: palette["line-dark"] },
        chip: { DEFAULT: palette.chip, dark: palette["chip-dark"] },
        "warn-ink": { DEFAULT: palette["warn-ink"], dark: palette["warn-ink-dark"] },
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -- colors` then `npm test` then `npm run typecheck`
Expected: all pass. The pre-existing "every light token has a -dark sibling" test must still pass — all three new keys have siblings.

- [ ] **Step 10: Commit**

```bash
git add mobile/constants/colors.ts mobile/constants/__tests__/colors.test.ts mobile/tailwind.config.ts mobile/lib/ui/contrast.ts mobile/lib/ui/__tests__/contrast.test.ts
git commit -m "feat(ui): add line, chip and warn-ink tokens with contrast arithmetic"
```

---

### Task 3: Chip fill variants

**Files:**
- Modify: `mobile/components/ui/chip.tsx`
- Create: `mobile/components/ui/__tests__/chip_contrast.test.ts`
- Create: `mobile/components/ui/__tests__/chip.test.tsx`

**Interfaces:**
- Consumes: `palette`, `contrastRatio`, `softBackground` from Task 2.
- Produces: `Chip` gains `fill?: "solid" | "soft" | "outline"`, default `"solid"`. `ChipTone` is unchanged: `"neutral" | "brand" | "warn" | "danger" | "soon"`. `SOFT_ALPHA` is exported for the contrast test.

**The `soon` rule.** `tone="soon"` ignores `fill` entirely and always renders the existing solid grey. `components/gates/soon_gate.tsx` renders this component, and grey-versus-green is the app's "not built" versus "needs Plus" contract.

- [ ] **Step 1: Write the failing contrast test**

Create `mobile/components/ui/__tests__/chip_contrast.test.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing behaviour test**

Create `mobile/components/ui/__tests__/chip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { Chip } from "../chip";

function stylesOf(testID: string): Record<string, unknown> {
  const style = screen.getByTestId(testID).props.style;
  return Array.isArray(style) ? Object.assign({}, ...style) : (style ?? {});
}

test("solid is the default fill, so every existing call site is unchanged", () => {
  render(<Chip testID="c" label="Bills" tone="brand" />);
  expect(String(screen.getByTestId("c").props.className)).toContain("bg-brand");
});

test("a soft chip paints a translucent tint, not the solid token", () => {
  render(<Chip testID="c" label="due today" tone="warn" fill="soft" />);
  expect(String(stylesOf("c").backgroundColor)).toContain("rgba(217, 119, 6");
});

test("soft warn inks with warn-ink, never warn", () => {
  render(<Chip testID="c" label="due today" tone="warn" fill="soft" />);
  expect(String(screen.getByTestId("c-label").props.className)).toContain("text-warn-ink");
});

test("an outline chip has a border and no fill", () => {
  render(<Chip testID="c" label="SOON" tone="neutral" fill="outline" />);
  const classes = String(screen.getByTestId("c").props.className);
  expect(classes).toContain("border");
  expect(classes).toContain("border-line");
  expect(classes).toContain("bg-chip");
});

test("soon ignores fill entirely and stays solid grey", () => {
  render(<Chip testID="c" label="SOON" tone="soon" fill="soft" />);
  const classes = String(screen.getByTestId("c").props.className);
  expect(classes).toContain("bg-fg-2");
  expect(stylesOf("c").backgroundColor).toBeUndefined();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- chip`
Expected: FAIL — `SOFT_ALPHA` is not exported, and `Chip` has no `fill` prop.

- [ ] **Step 4: Implement the fill variants**

In `mobile/components/ui/chip.tsx`, add above `TONE_BG`:

```tsx
import { palette } from "@/constants/colors";
import { softBackground } from "@/lib/ui/contrast";

export type ChipFill = "solid" | "soft" | "outline";

/**
 * The design's soft chips sit at 12-14% (`rgba(217,119,6,.14)` for "due
 * today", `rgba(220,38,38,.12)` for "overdue 2d"). One value is used for all
 * of them rather than per-tone, because a chip row with two different alphas
 * reads as a rendering bug. 0.14 is the higher of the two, chosen so the
 * chip is still visible against `surface` white.
 */
export const SOFT_ALPHA = 0.14;

const SOFT_TINT: Partial<Record<ChipTone, { light: string; dark: string }>> = {
  brand: { light: palette.brand, dark: palette["brand-dark"] },
  warn: { light: palette.warn, dark: palette["warn-dark"] },
  danger: { light: palette.danger, dark: palette["danger-dark"] },
};

const SOFT_INK: Partial<Record<ChipTone, string>> = {
  brand: "text-brand dark:text-brand-dark",
  // NOT `text-warn`: see constants/colors.ts on `warn-ink`.
  warn: "text-warn-ink dark:text-warn-ink-dark",
  danger: "text-danger dark:text-danger-dark",
};
```

Add `fill` to `ChipProps`:

```tsx
export type ChipProps = {
  label: string;
  tone?: ChipTone;
  fill?: ChipFill;
  onPress?: () => void;
  testID?: string;
};
```

Then in the component body, before building the class string:

```tsx
  // `soon` is deliberately exempt. SoonGate renders this component, and the
  // grey-versus-green contract (docs/11 "TWO GATING STATES") is what tells a
  // user "not built yet" apart from "built, needs Plus". A soft `soon` chip
  // would blur the two.
  const effectiveFill: ChipFill = tone === "soon" ? "solid" : fill;
  const tint = effectiveFill === "soft" ? SOFT_TINT[tone] : undefined;
  const isDark = false; // see note below

  const containerClass =
    effectiveFill === "outline"
      ? "rounded-full border border-line bg-chip px-2.5 py-1 dark:border-line-dark dark:bg-chip-dark"
      : effectiveFill === "soft"
        ? "rounded-full px-2.5 py-1"
        : `rounded-full px-2.5 py-1 ${TONE_BG[tone]}`;

  const labelClass =
    effectiveFill === "solid"
      ? TONE_TEXT[tone]
      : effectiveFill === "outline"
        ? "text-fg-2 dark:text-fg-2-dark"
        : (SOFT_INK[tone] ?? "text-fg-2 dark:text-fg-2-dark");
```

Render the container with both `className` and, for soft only, an inline `backgroundColor`:

```tsx
    <View
      testID={testID}
      className={containerClass}
      style={tint === undefined ? undefined : { backgroundColor: softBackground(tint.light, SOFT_ALPHA) }}
    >
      <Text testID={testID === undefined ? undefined : `${testID}-label`} className={`text-micro font-semibold ${labelClass}`}>
        {label}
      </Text>
    </View>
```

**On the `isDark` placeholder above:** delete that line. NativeWind cannot express a translucent `dark:` background through `className`, so the dark tint comes from `useTheme()` instead. Import it and pick the tint:

```tsx
import { useTheme } from "@/contexts/theme_context";
// inside the component:
  const { resolved } = useTheme();
  const tintHex = tint === undefined ? undefined : (resolved === "dark" ? tint.dark : tint.light);
```

and use `tintHex` in the `style` prop.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- chip`
Expected: PASS. If the `ThemeProvider` is missing in the test render, wrap with the helper already used by `components/settings/__tests__/` — check that directory for the existing pattern rather than inventing one.

- [ ] **Step 6: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean. `components/gates/__tests__/gates.test.tsx` must still pass untouched — `soon` behaviour did not change.

- [ ] **Step 7: Commit**

```bash
git add mobile/components/ui/chip.tsx mobile/components/ui/__tests__/chip.test.tsx mobile/components/ui/__tests__/chip_contrast.test.ts
git commit -m "feat(ui): add soft and outline chip fills with an AA contrast gate"
```

---

### Task 4: Button variants and sizes

**Files:**
- Modify: `mobile/components/ui/button.tsx`
- Create: `mobile/components/ui/__tests__/button.test.tsx`

**Interfaces:**
- Consumes: Task 1's type scale.
- Produces: `ButtonVariant` gains `"outline-destructive"`. `ButtonProps` gains `size?: "md" | "lg"` (default `"md"`) and `iconOnly?: boolean`. Radius is `rounded-full` on every variant.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/ui/__tests__/button.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { Button } from "../button";

function classesOf(testID: string): string {
  return String(screen.getByTestId(testID).props.className ?? "");
}

test("outline-destructive is a bordered surface, not a red fill", () => {
  render(<Button testID="b" title="Wipe everything" variant="outline-destructive" onPress={() => {}} />);
  const classes = classesOf("b");
  expect(classes).toContain("border-danger");
  expect(classes).toContain("bg-surface");
  expect(classes).not.toContain("bg-danger");
});

test("destructive is still a solid fill, so existing call sites are unchanged", () => {
  render(<Button testID="b" title="Archive" variant="destructive" onPress={() => {}} />);
  expect(classesOf("b")).toContain("bg-danger");
});

test("every variant is a pill", () => {
  for (const variant of ["primary", "secondary", "ghost", "destructive", "outline-destructive"] as const) {
    render(<Button testID={`b-${variant}`} title="x" variant={variant} onPress={() => {}} />);
    expect(classesOf(`b-${variant}`)).toContain("rounded-full");
  }
});

test("a disabled button reads as disabled to assistive tech and looks it", () => {
  render(<Button testID="b" title="Save" onPress={() => {}} disabled />);
  expect(screen.getByTestId("b").props.accessibilityState).toMatchObject({ disabled: true });
  expect(classesOf("b")).toContain("opacity-40");
});

test("lg is taller than md", () => {
  render(<Button testID="md" title="x" onPress={() => {}} />);
  render(<Button testID="lg" title="x" size="lg" onPress={() => {}} />);
  expect(classesOf("md")).toContain("py-2.5");
  expect(classesOf("lg")).toContain("py-3.5");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- button`
Expected: FAIL — `"outline-destructive"` is not assignable to `ButtonVariant`.

- [ ] **Step 3: Implement**

In `mobile/components/ui/button.tsx`:

```tsx
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "destructive"
  | "outline-destructive";

export type ButtonSize = "md" | "lg";

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: "bg-brand dark:bg-brand-dark",
  secondary: "bg-brand-soft dark:bg-brand-soft-dark",
  ghost: "bg-transparent",
  destructive: "bg-danger dark:bg-danger-dark",
  // The design's "Wipe everything": surface fill, danger border, danger ink.
  // A destructive action the user should be able to READ calmly before
  // pressing gets an outline; one they are confirming gets the fill.
  "outline-destructive": "bg-surface border border-danger dark:bg-surface-dark dark:border-danger-dark",
};

const VARIANT_FG: Record<ButtonVariant, string> = {
  primary: "text-on-brand dark:text-on-brand-dark",
  secondary: "text-brand dark:text-brand-dark",
  ghost: "text-brand dark:text-brand-dark",
  destructive: "text-on-brand dark:text-on-brand-dark",
  "outline-destructive": "text-danger dark:text-danger-dark",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  md: "px-5 py-2.5",
  lg: "px-5 py-3.5",
};
```

Add `size` and `iconOnly` to `ButtonProps`, default `size = "md"`, and build the container class as:

```tsx
  const containerClass = [
    "min-h-[44px] flex-row items-center justify-center gap-2 rounded-full",
    iconOnly ? "aspect-square px-0" : SIZE_CLASS[size],
    VARIANT_BG[variant],
    disabled || loading ? "opacity-40" : "",
  ]
    .filter(Boolean)
    .join(" ");
```

and the label class as `` `text-body font-semibold ${VARIANT_FG[variant]}` ``. Keep `accessibilityState={{ disabled: disabled || loading }}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- button`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean. Any test asserting the old `rounded-xl` on a button is updated here, not later.

- [ ] **Step 6: Commit**

```bash
git add mobile/components/ui/button.tsx mobile/components/ui/__tests__/button.test.tsx
git commit -m "feat(ui): add outline-destructive, sizes and icon-only to Button"
```

---

### Task 5: Card dark hairline

**Files:**
- Modify: `mobile/components/ui/card.tsx`
- Create: `mobile/components/ui/__tests__/card.test.tsx`

**Interfaces:**
- Consumes: `line` token from Task 2.
- Produces: `Card` unchanged in API. `default` gains a dark-mode hairline; `flat` gains neither shadow nor hairline.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/ui/__tests__/card.test.tsx`:

```tsx
import { Text } from "react-native";
import { render, screen } from "@testing-library/react-native";

import { Card } from "../card";

function classesOf(testID: string): string {
  return String(screen.getByTestId(testID).props.className ?? "");
}

test("a default card is a shadow in light and a hairline in dark", () => {
  render(<Card testID="c"><Text>x</Text></Card>);
  const classes = classesOf("c");
  expect(classes).toContain("shadow-sm");
  expect(classes).toContain("dark:border");
  expect(classes).toContain("dark:border-line-dark");
});

test("a flat card has neither — a nested card must not read as depth", () => {
  render(<Card testID="c" variant="flat"><Text>x</Text></Card>);
  const classes = classesOf("c");
  expect(classes).not.toContain("shadow-sm");
  expect(classes).not.toContain("dark:border-line-dark");
});

test("radius and padding still match the design's card", () => {
  render(<Card testID="c"><Text>x</Text></Card>);
  expect(classesOf("c")).toContain("rounded-2xl");
  expect(classesOf("c")).toContain("p-4");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- card`
Expected: FAIL — no `dark:border-line-dark` in the rendered className.

- [ ] **Step 3: Implement**

In `mobile/components/ui/card.tsx`, replace `VARIANT_CLASS`:

```tsx
/**
 * `default` is a drop shadow in light and a HAIRLINE in dark. A shadow on
 * `bg-dark` #0B1210 is invisible — there is no lighter ground for it to fall
 * on — so dark mode separates a card from the page with a 1px `line-dark`
 * edge instead. The design's own token block does the same thing: its `--shd`
 * is `0 1px 3px rgba(16,32,26,.07)` in light and `0 0 0 1px rgba(255,255,255,.04)`
 * in dark, which is a border written as a shadow.
 *
 * `flat` is the same card with both removed — for a card nested inside another
 * card or a sheet, where a second elevation reads as a bug rather than depth.
 * It is deliberately NOT a different colour: two card colours would compete
 * with the tone system Chip already owns.
 */
const VARIANT_CLASS: Record<CardVariant, string> = {
  default: "shadow-sm dark:border dark:border-line-dark",
  flat: "",
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- card` then `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/components/ui/card.tsx mobile/components/ui/__tests__/card.test.tsx
git commit -m "feat(ui): give Card a dark-mode hairline in place of an invisible shadow"
```

---

### Task 6: ProviderBadge

**Files:**
- Create: `mobile/components/ui/provider_badge.tsx`
- Create: `mobile/components/ui/__tests__/provider_badge.test.tsx`
- Modify: `mobile/constants/providers.ts`
- Modify: `mobile/constants/__tests__/providers.test.ts`

**Interfaces:**
- Consumes: `PROVIDER_LABELS` (already in `constants/providers.ts`).
- Produces:
  - `PROVIDER_BADGE: Record<string, { color: string; letter: string }>` and `providerBadge(providerKey: string): { color: string; letter: string }` in `constants/providers.ts`.
  - `<ProviderBadge providerKey={string} size?: number testID?: string />` in `components/ui/provider_badge.tsx`.

**Coloured initials, not logos.** The design draws a 14dp rounded square with the provider's brand colour and a white 800-weight initial. No provider artwork is bundled, so there is no trademark surface.

- [ ] **Step 1: Write the failing constants test**

Append to `mobile/constants/__tests__/providers.test.ts`:

```ts
import { PROVIDER_BADGE, PROVIDER_LABELS, providerBadge } from "../providers";

test("every labelled provider has a badge", () => {
  for (const key of Object.keys(PROVIDER_LABELS)) {
    expect(PROVIDER_BADGE[key]).toBeDefined();
  }
});

test("every badge letter is a single uppercase character", () => {
  for (const badge of Object.values(PROVIDER_BADGE)) {
    expect(badge.letter).toMatch(/^[A-Z]$/);
  }
});

test("every badge colour is a six-digit hex", () => {
  for (const badge of Object.values(PROVIDER_BADGE)) {
    expect(badge.color).toMatch(/^#[0-9A-F]{6}$/);
  }
});

test("an unknown provider falls back to its own initial, never to blank", () => {
  expect(providerBadge("chipmunk-bank")).toEqual({ color: "#5B6E64", letter: "C" });
});

test("an empty key still yields a letter rather than an empty badge", () => {
  expect(providerBadge("").letter).toBe("?");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- providers`
Expected: FAIL — `PROVIDER_BADGE` is not exported.

- [ ] **Step 3: Implement the badge map**

Append to `mobile/constants/providers.ts`:

```ts
/**
 * Colour + initial per provider, for the 14dp rounded square the design draws
 * beside every wallet row and every provider-picker tile (00 Component sheet's
 * "GCash" chip; 04 Wallets' list).
 *
 * COLOURED INITIALS, NOT LOGOS, ON PURPOSE. No provider artwork is bundled
 * with the app. A letter on a brand-adjacent colour is recognisable at 14dp,
 * costs nothing to ship, and creates no trademark surface — which matters for
 * an app that names thirteen banks and e-wallets it has no relationship with.
 *
 * These colours are for identification only. None of them may be used as a
 * status: they are not in `palette` for exactly that reason.
 */
export const PROVIDER_BADGE: Record<string, { color: string; letter: string }> = {
  gcash: { color: "#0038A8", letter: "G" },
  maya: { color: "#12B76A", letter: "M" },
  bpi: { color: "#B32017", letter: "B" },
  bdo: { color: "#0B2B63", letter: "B" },
  unionbank: { color: "#E36C0A", letter: "U" },
  metrobank: { color: "#0A3D91", letter: "M" },
  seabank: { color: "#F4511E", letter: "S" },
  gotyme: { color: "#00B5AD", letter: "G" },
  cimb: { color: "#A6192E", letter: "C" },
  landbank: { color: "#00713C", letter: "L" },
  shopeepay: { color: "#EE4D2D", letter: "S" },
  grabpay: { color: "#00B14F", letter: "G" },
  sms_relay: { color: "#5B6E64", letter: "S" },
};

const UNKNOWN_PROVIDER_COLOR = "#5B6E64";

/**
 * Badge for a provider key, falling back the same way `providerLabel` does:
 * the ruleset is remote-updatable and can name a provider this file has never
 * heard of. A grey square with the key's own initial is worse than the real
 * badge and much better than a blank square.
 */
export function providerBadge(providerKey: string): { color: string; letter: string } {
  const known = PROVIDER_BADGE[providerKey];
  if (known !== undefined) return known;
  const initial = providerKey.trim().charAt(0).toUpperCase();
  return { color: UNKNOWN_PROVIDER_COLOR, letter: initial === "" ? "?" : initial };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- providers`
Expected: PASS.

- [ ] **Step 5: Write the failing component test**

Create `mobile/components/ui/__tests__/provider_badge.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { ProviderBadge } from "../provider_badge";

test("a known provider renders its letter on its colour", () => {
  render(<ProviderBadge testID="b" providerKey="gcash" />);
  expect(screen.getByTestId("b-letter")).toHaveTextContent("G");
  const style = screen.getByTestId("b").props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  expect(flat.backgroundColor).toBe("#0038A8");
});

test("an unknown provider still renders a badge", () => {
  render(<ProviderBadge testID="b" providerKey="chipmunk-bank" />);
  expect(screen.getByTestId("b-letter")).toHaveTextContent("C");
});

test("the badge is square at whatever size it is given", () => {
  render(<ProviderBadge testID="b" providerKey="maya" size={28} />);
  const style = screen.getByTestId("b").props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  expect(flat.width).toBe(28);
  expect(flat.height).toBe(28);
});

test("the badge is labelled for assistive tech with the provider's real name", () => {
  render(<ProviderBadge testID="b" providerKey="gcash" />);
  expect(screen.getByTestId("b").props.accessibilityLabel).toBe("GCash");
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- provider_badge`
Expected: FAIL — `Cannot find module '../provider_badge'`.

- [ ] **Step 7: Implement the component**

Create `mobile/components/ui/provider_badge.tsx`:

```tsx
// components/ui/provider_badge.tsx — the 14dp identity square the design puts
// beside every wallet row, matcher chip and provider tile.
//
// The colour comes from `constants/providers.ts` rather than `palette`,
// because a provider colour identifies a company and never signals a state.
// Keeping it out of the token file is what stops someone painting a warning
// GCash-blue six months from now.
import { Text, View } from "react-native";

import { providerBadge, providerLabel } from "@/constants/providers";

export type ProviderBadgeProps = {
  providerKey: string;
  size?: number;
  testID?: string;
};

export function ProviderBadge({ providerKey, size = 14, testID }: ProviderBadgeProps) {
  const { color, letter } = providerBadge(providerKey);

  return (
    <View
      testID={testID}
      accessibilityLabel={providerLabel(providerKey)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size / 2.8),
        backgroundColor: color,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        testID={testID === undefined ? undefined : `${testID}-letter`}
        allowFontScaling={false}
        style={{ fontSize: Math.round(size * 0.57), lineHeight: size, color: "#FFFFFF" }}
        className="font-extrabold"
      >
        {letter}
      </Text>
    </View>
  );
}
```

**On `allowFontScaling={false}`:** this is a fixed-size identity mark, not text. At a large system font scale a scaling letter overflows a 14dp square and clips. It is the only place in this revamp where font scaling is disabled.

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- provider_badge` then `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add mobile/components/ui/provider_badge.tsx mobile/components/ui/__tests__/provider_badge.test.tsx mobile/constants/providers.ts mobile/constants/__tests__/providers.test.ts
git commit -m "feat(ui): add ProviderBadge and the provider colour map"
```

---

### Task 7: SegmentedControl

**Files:**
- Create: `mobile/components/ui/segmented_control.tsx`
- Create: `mobile/components/ui/__tests__/segmented_control.test.tsx`

**Interfaces:**
- Consumes: `chip` and `line` tokens (Task 2), type scale (Task 1).
- Produces:

```ts
export type Segment<T extends string> = { value: T; label: string };
export type SegmentedControlProps<T extends string> = {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
  testID?: string;
};
```

Four later screens consume this: Plan's four panels (Part 2 Task 4), manual entry's Expense/Income/Transfer, income cadence, and Amount-₱-versus-%-of-income.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/ui/__tests__/segmented_control.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { SegmentedControl } from "../segmented_control";

const SEGMENTS = [
  { value: "limits", label: "Limits" },
  { value: "goals", label: "Goals" },
  { value: "utang", label: "Utang" },
  { value: "bills", label: "Bills" },
] as const;

test("every segment renders its label", () => {
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="limits" onChange={() => {}} />);
  for (const segment of SEGMENTS) {
    screen.getByText(segment.label);
  }
});

test("the selected segment is filled and announced as selected", () => {
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="goals" onChange={() => {}} />);
  expect(screen.getByTestId("s-goals").props.accessibilityState).toMatchObject({ selected: true });
  expect(String(screen.getByTestId("s-goals").props.className)).toContain("bg-brand");
  expect(screen.getByTestId("s-limits").props.accessibilityState).toMatchObject({ selected: false });
});

test("pressing a segment reports its value", () => {
  const onChange = jest.fn();
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="limits" onChange={onChange} />);
  fireEvent.press(screen.getByTestId("s-utang"));
  expect(onChange).toHaveBeenCalledWith("utang");
});

test("pressing the already-selected segment does not fire onChange", () => {
  const onChange = jest.fn();
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="limits" onChange={onChange} />);
  fireEvent.press(screen.getByTestId("s-limits"));
  expect(onChange).not.toHaveBeenCalled();
});

test("each segment clears the 44dp touch target", () => {
  render(<SegmentedControl testID="s" segments={SEGMENTS} value="limits" onChange={() => {}} />);
  expect(String(screen.getByTestId("s-limits").props.className)).toContain("min-h-[44px]");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- segmented_control`
Expected: FAIL — `Cannot find module '../segmented_control'`.

- [ ] **Step 3: Implement**

Create `mobile/components/ui/segmented_control.tsx`:

```tsx
// components/ui/segmented_control.tsx — the pill row the design uses wherever
// one of a few mutually exclusive views is on screen: Plan's four panels,
// manual entry's Expense/Income/Transfer, the income cadence picker, and the
// Amount-versus-%-of-income toggle on both limit forms.
//
// Four screens hand-rolled this before it existed, with four different
// paddings and two different selected treatments. One component is the point.
//
// NOT A TAB BAR. It changes what a screen shows; it never navigates. Plan
// keeps real routes underneath (see the revamp spec R4) precisely so that
// pressing a segment can stay a state change.
import { Pressable, Text, View } from "react-native";

export type Segment<T extends string> = { value: T; label: string };

export type SegmentedControlProps<T extends string> = {
  segments: ReadonlyArray<Segment<T>>;
  value: T;
  onChange: (value: T) => void;
  testID?: string;
};

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  testID,
}: SegmentedControlProps<T>) {
  return (
    <View testID={testID} className="flex-row gap-2">
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <Pressable
            key={segment.value}
            testID={testID === undefined ? undefined : `${testID}-${segment.value}`}
            onPress={() => {
              if (!selected) onChange(segment.value);
            }}
            // "radio", not "button": this is one-of-N, the same semantic
            // `cadence_picker.tsx` and `category_picker.tsx` already use
            // `"radio"` for. (This step originally prescribed `"button"`,
            // which announces four unrelated actions instead of a set of
            // mutually exclusive options — corrected after a review found
            // it, since this is one of the four screens this component
            // replaces.)
            accessibilityRole="radio"
            accessibilityLabel={segment.label}
            accessibilityState={{ selected }}
            className={`min-h-[44px] flex-1 items-center justify-center rounded-full px-3 ${
              selected ? "bg-brand dark:bg-brand-dark" : "bg-chip dark:bg-chip-dark"
            }`}
          >
            <Text
              numberOfLines={1}
              className={`text-row font-semibold ${
                selected
                  ? "text-on-brand dark:text-on-brand-dark"
                  : "text-fg-2 dark:text-fg-2-dark"
              }`}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- segmented_control`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/components/ui/segmented_control.tsx mobile/components/ui/__tests__/segmented_control.test.tsx
git commit -m "feat(ui): add SegmentedControl"
```

---

### Task 8: StatTile, MiniBars, ShareBar and Fab

**Files:**
- Create: `mobile/components/ui/stat_tile.tsx`
- Create: `mobile/components/ui/mini_bars.tsx`
- Create: `mobile/components/ui/share_bar.tsx`
- Create: `mobile/components/ui/fab.tsx`
- Create: `mobile/components/ui/__tests__/stat_tile.test.tsx`
- Create: `mobile/components/ui/__tests__/mini_bars.test.tsx`
- Create: `mobile/components/ui/__tests__/share_bar.test.tsx`
- Create: `mobile/components/ui/__tests__/fab.test.tsx`

**Interfaces:**
- Consumes: `AmountText` / `Centavos`, tokens from Task 2.
- Produces:

```ts
// stat_tile.tsx
export type StatTileProps = { label: string; amount: Centavos; tone?: "neutral" | "brand" | "warn" | "danger"; testID?: string };

// mini_bars.tsx
export type MiniBarsProps = { values: readonly number[]; barClassName: string; labelClassName: string; startLabel?: string; endLabel?: string; testID?: string };

// share_bar.tsx
export type Share = { id: string; label: string; value: number; color: string };
export type ShareBarProps = { shares: readonly Share[]; testID?: string };

// fab.tsx
export type FabProps = { onPress: () => void; icon?: IconComponent; accessibilityLabel: string; testID?: string };
```

`MiniBars` takes plain numbers, not `Centavos`, because it only needs relative heights — Part 2's `useDailySpend(7)` feeds it.

- [ ] **Step 1: Write the failing tests**

Create `mobile/components/ui/__tests__/mini_bars.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { MiniBars } from "../mini_bars";

function heightOf(testID: string): number {
  const style = screen.getByTestId(testID).props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  return flat.height as number;
}

test("the tallest value fills the track and the others scale against it", () => {
  render(<MiniBars testID="b" values={[10, 20, 40]} barClassName="bg-on-brand/40" labelClassName="text-on-brand/70" />);
  expect(heightOf("b-bar-2")).toBeGreaterThan(heightOf("b-bar-1"));
  expect(heightOf("b-bar-1")).toBeGreaterThan(heightOf("b-bar-0"));
});

test("all-zero values render visible stubs, not an invisible row", () => {
  render(<MiniBars testID="b" values={[0, 0, 0]} barClassName="bg-on-brand/40" labelClassName="text-on-brand/70" />);
  for (const index of [0, 1, 2]) {
    expect(heightOf(`b-bar-${index}`)).toBeGreaterThan(0);
  }
});

test("a single value does not divide by zero", () => {
  render(<MiniBars testID="b" values={[7]} barClassName="bg-on-brand/40" labelClassName="text-on-brand/70" />);
  expect(heightOf("b-bar-0")).toBeGreaterThan(0);
});

test("end labels render when given, in the ink the caller chose", () => {
  render(<MiniBars testID="b" values={[1, 2]} barClassName="bg-fg/30" labelClassName="text-fg/70" startLabel="Mon" endLabel="Sun" />);
  screen.getByText("Mon");
  screen.getByText("Sun");
  expect(String(screen.getByText("Mon").props.className)).toContain("text-fg/70");
});

test("the chart is one accessible summary, not seven unlabelled views", () => {
  render(<MiniBars testID="b" values={[1, 2]} barClassName="bg-on-brand/40" labelClassName="text-on-brand/70" startLabel="Mon" endLabel="Sun" />);
  expect(screen.getByTestId("b").props.accessibilityLabel).toContain("Mon");
});
```

Create `mobile/components/ui/__tests__/share_bar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { ShareBar } from "../share_bar";

const SHARES = [
  { id: "gcash", label: "GCash", value: 60, color: "#0038A8" },
  { id: "maya", label: "Maya", value: 17, color: "#12B76A" },
  { id: "cash", label: "Cash", value: 23, color: "#15803D" },
];

test("each share renders a segment and a legend entry with its percentage", () => {
  render(<ShareBar testID="s" shares={SHARES} />);
  screen.getByTestId("s-seg-gcash");
  screen.getByText("GCash 60%");
});

test("percentages are computed from the total, not assumed to be percentages", () => {
  render(<ShareBar testID="s" shares={[
    { id: "a", label: "A", value: 1, color: "#000000" },
    { id: "b", label: "B", value: 3, color: "#111111" },
  ]} />);
  screen.getByText("A 25%");
  screen.getByText("B 75%");
});

test("a zero total renders nothing rather than dividing by zero", () => {
  render(<ShareBar testID="s" shares={[{ id: "a", label: "A", value: 0, color: "#000000" }]} />);
  expect(screen.queryByTestId("s-seg-a")).toBeNull();
});
```

Create `mobile/components/ui/__tests__/stat_tile.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { StatTile } from "../stat_tile";

test("a tile shows its label and its formatted amount", () => {
  render(<StatTile testID="t" label="Balance" amount={539000} />);
  screen.getByText("Balance");
  expect(screen.getByTestId("t")).toHaveTextContent("₱5,390.00");
});

test("tone colours the amount, never the label", () => {
  render(<StatTile testID="t" label="Spent so far" amount={1031200} tone="danger" />);
  expect(String(screen.getByTestId("t-amount").props.className)).toContain("text-danger");
  expect(String(screen.getByTestId("t-label").props.className)).toContain("text-fg-2");
});
```

Create `mobile/components/ui/__tests__/fab.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { Fab } from "../fab";

test("pressing the fab calls onPress", () => {
  const onPress = jest.fn();
  render(<Fab testID="f" onPress={onPress} accessibilityLabel="Add a transaction" />);
  fireEvent.press(screen.getByTestId("f"));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("the fab is labelled — an unlabelled icon button is unusable with a screen reader", () => {
  render(<Fab testID="f" onPress={() => {}} accessibilityLabel="Add a transaction" />);
  expect(screen.getByTestId("f").props.accessibilityLabel).toBe("Add a transaction");
  expect(screen.getByTestId("f").props.accessibilityRole).toBe("button");
});

test("the fab clears the 56dp Material touch target", () => {
  render(<Fab testID="f" onPress={() => {}} accessibilityLabel="Add" />);
  const style = screen.getByTestId("f").props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  expect(flat.width).toBeGreaterThanOrEqual(56);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- stat_tile mini_bars share_bar fab`
Expected: FAIL, four `Cannot find module` errors.

- [ ] **Step 3: Implement `mini_bars.tsx`**

```tsx
// components/ui/mini_bars.tsx — the seven-day bar strip inside the Home hero.
//
// TAKES PLAIN NUMBERS, NOT Centavos. It draws relative heights and nothing
// else — no axis, no value labels, no currency. Typing it to Centavos would
// imply it knows about money, and the next caller with a non-money series
// would either lie about the type or copy the file.
import { Text, View } from "react-native";

export type MiniBarsProps = {
  values: readonly number[];
  /**
   * THE CALLER OWNS THE INK, and this is not laziness. These bars ride on the
   * Home hero's coloured fill, and which ink is legible on that fill depends
   * on the fill: white clears AA on `brand` (5.02:1) and `danger` (4.83:1) but
   * only reaches 3.2:1 on `warn`, so the amber hero takes DARK ink instead —
   * the same exception `components/ui/chip.tsx` already documents for amber.
   * A tone map inside this component would have to encode the hero's state
   * machine to get that right, and would then be wrong the first time anything
   * else drew a bar strip.
   */
  barClassName: string;
  labelClassName: string;
  startLabel?: string;
  endLabel?: string;
  testID?: string;
};

const TRACK_HEIGHT = 44;
/** A zero day is still a day. A 0dp bar reads as a rendering failure. */
const MIN_BAR_HEIGHT = 3;

export function MiniBars({
  values,
  barClassName,
  labelClassName,
  startLabel,
  endLabel,
  testID,
}: MiniBarsProps) {
  const peak = Math.max(...values, 0);

  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={
        startLabel === undefined || endLabel === undefined
          ? "Spending for the period"
          : `Spending, ${startLabel} to ${endLabel}`
      }
    >
      <View className="flex-row items-end gap-1" style={{ height: TRACK_HEIGHT }}>
        {values.map((value, index) => (
          <View
            key={index}
            testID={testID === undefined ? undefined : `${testID}-bar-${index}`}
            className={`flex-1 rounded-sm ${barClassName}`}
            style={{
              height:
                peak <= 0
                  ? MIN_BAR_HEIGHT
                  : Math.max(MIN_BAR_HEIGHT, Math.round((value / peak) * TRACK_HEIGHT)),
            }}
          />
        ))}
      </View>
      {startLabel === undefined && endLabel === undefined ? null : (
        <View className="mt-1 flex-row justify-between">
          <Text className={`text-badge font-semibold ${labelClassName}`}>{startLabel}</Text>
          <Text className={`text-badge font-semibold ${labelClassName}`}>{endLabel}</Text>
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 4: Implement `share_bar.tsx`**

```tsx
// components/ui/share_bar.tsx — the stacked split bar and legend above the
// Wallets total ("GCash 60% · Maya 17% · BPI 5% · Cash 18%").
//
// Colours arrive as values, not tokens: the caller is Wallets, and a wallet's
// colour is its PROVIDER's colour (constants/providers.ts), which is identity
// rather than status. This component must not reach for `palette` itself.
import { Text, View } from "react-native";

export type Share = { id: string; label: string; value: number; color: string };

export type ShareBarProps = {
  shares: readonly Share[];
  testID?: string;
};

export function ShareBar({ shares, testID }: ShareBarProps) {
  const total = shares.reduce((sum, share) => sum + share.value, 0);
  if (total <= 0) return null;

  const withPercent = shares.map((share) => ({
    ...share,
    percent: Math.round((share.value / total) * 100),
  }));

  return (
    <View testID={testID}>
      <View className="h-2 flex-row overflow-hidden rounded-full">
        {withPercent.map((share) => (
          <View
            key={share.id}
            testID={testID === undefined ? undefined : `${testID}-seg-${share.id}`}
            style={{ flex: share.value, backgroundColor: share.color }}
          />
        ))}
      </View>
      <View className="mt-2 flex-row flex-wrap gap-x-3 gap-y-1">
        {withPercent.map((share) => (
          <View key={share.id} className="flex-row items-center gap-1.5">
            <View className="h-2 w-2 rounded-full" style={{ backgroundColor: share.color }} />
            <Text className="text-micro font-medium text-fg-2 dark:text-fg-2-dark">
              {`${share.label} ${share.percent}%`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Implement `stat_tile.tsx`**

```tsx
// components/ui/stat_tile.tsx — one of the three tiles under the Home hero
// (Balance · Spent so far · Saved).
import { Text, View } from "react-native";

import type { Centavos } from "@/types/domain";
import { AmountText } from "./amount_text";
import { Card } from "./card";

export type StatTileTone = "neutral" | "brand" | "warn" | "danger";

export type StatTileProps = {
  label: string;
  amount: Centavos;
  tone?: StatTileTone;
  testID?: string;
};

const TONE_CLASS: Record<StatTileTone, string> = {
  neutral: "text-fg dark:text-fg-dark",
  brand: "text-brand dark:text-brand-dark",
  warn: "text-warn dark:text-warn-dark",
  danger: "text-danger dark:text-danger-dark",
};

export function StatTile({ label, amount, tone = "neutral", testID }: StatTileProps) {
  return (
    <View testID={testID} className="flex-1">
      <Card variant="default">
        <Text
          testID={testID === undefined ? undefined : `${testID}-label`}
          numberOfLines={1}
          className="text-micro font-medium text-fg-2 dark:text-fg-2-dark"
        >
          {label}
        </Text>
        <Text
          testID={testID === undefined ? undefined : `${testID}-amount`}
          numberOfLines={1}
          className={`mt-0.5 text-section font-bold ${TONE_CLASS[tone]}`}
        >
          <AmountText amount={amount} size="md" />
        </Text>
      </Card>
    </View>
  );
}
```

If `AmountText` nested inside a `Text` fails the `toHaveTextContent` assertion, render `formatCentavos(amount)` directly instead and import it from `./amount_text` — do not change `AmountText`'s own API to suit this tile.

- [ ] **Step 6: Implement `fab.tsx`**

```tsx
// components/ui/fab.tsx — the green + button on Home and Transactions.
//
// 56dp, Material's floating-action size. Sits above the tab bar, so callers
// place it with `absolute bottom-*` INSIDE the screen, not in the tab layout:
// only two of five tabs have one.
import { Plus } from "lucide-react-native";
import { Pressable } from "react-native";

import { registerIcon } from "./button";
import type { IconComponent } from "./button";

export type FabProps = {
  onPress: () => void;
  icon?: IconComponent;
  accessibilityLabel: string;
  testID?: string;
};

const FAB_SIZE = 56;

export function Fab({ onPress, icon = Plus, accessibilityLabel, testID }: FabProps) {
  const Icon = registerIcon(icon);

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="items-center justify-center rounded-full bg-brand shadow-sm dark:bg-brand-dark"
      style={{ width: FAB_SIZE, height: FAB_SIZE }}
    >
      <Icon size={24} className="text-on-brand dark:text-on-brand-dark" />
    </Pressable>
  );
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test -- stat_tile mini_bars share_bar fab`
Expected: PASS, 13 tests.

- [ ] **Step 8: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add mobile/components/ui/stat_tile.tsx mobile/components/ui/mini_bars.tsx mobile/components/ui/share_bar.tsx mobile/components/ui/fab.tsx mobile/components/ui/__tests__/
git commit -m "feat(ui): add StatTile, MiniBars, ShareBar and Fab"
```

---

### Task 9: Restyle the shared atoms and the tab badge

**Files:**
- Modify: `mobile/components/ui/list_row.tsx`
- Modify: `mobile/components/ui/amount_text.tsx`
- Modify: `mobile/components/ui/empty_state.tsx`
- Modify: `mobile/components/ui/section_header.tsx`
- Modify: `mobile/components/review/review_badge.tsx`
- Modify: `mobile/components/ui/__tests__/amount_text.test.tsx`
- Create: `mobile/components/ui/__tests__/list_row.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: no API changes. Every prop, every `testID` is preserved. This task is class strings only, plus one colour change on `ReviewBadge`.

**This is the task that makes the other screens improve for free.** Nothing here opens a screen file.

- [ ] **Step 1: Write the failing ListRow test**

Create `mobile/components/ui/__tests__/list_row.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { ListRow } from "../list_row";

function classesOf(testID: string): string {
  return String(screen.getByTestId(testID).props.className ?? "");
}

test("a row keeps its 44dp minimum touch target", () => {
  render(<ListRow testID="r" title="Jollibee — Naga" onPress={() => {}} />);
  expect(classesOf("r")).toContain("min-h-[44px]");
});

test("title and subtitle use the design's row and secondary sizes", () => {
  render(<ListRow testID="r" title="Jollibee — Naga" subtitle="Food & drink · GCash" />);
  screen.getByText("Jollibee — Naga");
  screen.getByText("Food & drink · GCash");
});

test("a destructive row inks its title in danger, not its subtitle", () => {
  render(<ListRow testID="r" title="Wipe" subtitle="cannot be undone" destructive />);
  expect(String(screen.getByText("Wipe").props.className)).toContain("text-danger");
  expect(String(screen.getByText("cannot be undone").props.className)).not.toContain("text-danger");
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npm test -- list_row`
Expected: PASS on targets 1 and 3, since those behaviours already hold. This test exists to pin them before the class strings change. If it fails, fix the test to match current behaviour first — do not change `ListRow` to satisfy a test written from the design.

- [ ] **Step 3: Restyle `list_row.tsx`**

Replace the two `Text` class strings and the container class:

```tsx
        <Text
          numberOfLines={1}
          className={
            destructive
              ? "text-row font-semibold text-danger dark:text-danger-dark"
              : "text-row font-semibold text-fg dark:text-fg-dark"
          }
        >
```

```tsx
          <Text numberOfLines={1} className="text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
```

```tsx
  const className = "min-h-[44px] flex-row items-center gap-3 px-4 py-3";
```

(the container is unchanged — it is listed so the file is not accidentally re-indented).

- [ ] **Step 4: Give the hero amount its tabular treatment**

In `mobile/components/ui/amount_text.tsx`, replace `SIZE_CLASS`:

```tsx
/**
 * `hero` is the safe-to-spend figure: 40sp, 800 weight, tabular. Tabular
 * figures matter here specifically — the number re-renders as transactions
 * land, and proportional digits make it jitter sideways while the user is
 * reading it.
 */
const SIZE_CLASS: Record<AmountSize, string> = {
  sm: "text-secondary",
  md: "text-body",
  lg: "text-title font-semibold",
  hero: "text-hero font-extrabold",
};
```

and add `style={{ fontVariant: ["tabular-nums"] }}` to the rendered `Text` for every size.

- [ ] **Step 5: Update the amount_text test for the new classes**

In `mobile/components/ui/__tests__/amount_text.test.tsx`, add:

```tsx
test("every size renders tabular figures so the number cannot jitter", () => {
  render(<AmountText testID="amt" amount={123456} size="hero" />);
  const style = screen.getByTestId("amt").props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  expect(flat.fontVariant).toContain("tabular-nums");
});
```

Existing assertions in this file match on colour classes (`text-brand`, `text-fg`, `text-fg-2`), none of which change. They must still pass untouched.

- [ ] **Step 6: Restyle `empty_state.tsx` and `section_header.tsx`**

In `empty_state.tsx`, change the title and body classes to `text-title font-bold text-fg dark:text-fg-dark` and `text-body font-medium text-fg-2 dark:text-fg-2-dark`. Leave the mint disc and the `Send` glyph exactly as they are — Part 3's motion task replaces the glyph with the drifting mark, and doing it here would put motion in a commit that has no device verification.

In `section_header.tsx`, change the heading class to `text-section font-bold text-fg dark:text-fg-dark`.

- [ ] **Step 7: Recolour the review badge**

In `mobile/components/review/review_badge.tsx`, change the badge container class from `bg-brand ... dark:bg-brand-dark` to:

```tsx
      className="absolute -right-3 -top-1 min-w-[18px] items-center justify-center rounded-full bg-danger px-1 py-0.5 dark:bg-danger-dark"
```

and the label class to `text-badge font-bold text-on-brand dark:text-on-brand-dark`.

**Why red.** The design draws this badge red on the Transactions tab. Green in this app means "healthy" — it is the colour of a limit under budget and of a listening wallet. A green count on a tab that means "three things need your attention" says the opposite of what it is for. `on-brand` is still the correct ink: it is the token for ink on a filled control, and `constants/colors.ts` records `on-brand` on `danger` at 4.83:1 and `on-brand-dark` on `danger-dark` at 6.42:1, both clearing AA.

- [ ] **Step 8: Run the full suite**

Run: `npm test` then `npm run typecheck`
Expected: clean. Any test asserting `bg-brand` on the review badge is updated here.

- [ ] **Step 9: Build to the A54 and confirm the foundation**

Run: `npm run android`

Confirm, in **both** light and dark (Settings → Appearance):

1. Text renders at real weights — headings are visibly heavier than body, which they were not before Task 1.
2. Cards have a hairline in dark and a shadow in light.
3. The Transactions tab badge is red.
4. Nothing clips or truncates that did not before.

- [ ] **Step 10: Commit**

```bash
git add mobile/components/ui/ mobile/components/review/review_badge.tsx
git commit -m "feat(ui): restyle the shared atoms and recolour the review badge"
```

---

## Definition of done for Part 1

- [ ] `npm test` and `npm run typecheck` clean.
- [ ] Built and walked on the A54 in both themes.
- [ ] `git log --oneline` shows ten commits, Task 0 through Task 9.
- [ ] No screen file modified except `app/_layout.tsx` and `components/review/review_badge.tsx`.
- [ ] Part 2 can start: `Chip` has soft fills, `SegmentedControl`, `ProviderBadge`, `StatTile`, `MiniBars`, `ShareBar` and `Fab` all exist and are tested.
