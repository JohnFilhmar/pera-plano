# Brand Assets and Onboarding Art Placeholders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Give the delivered brand SVGs a permanent home that both the app and the future
marketing site can consume, wire the one mark that actually renders on React Native, and put
self-documenting art placeholders into the onboarding flow so the value story is designed and
reviewable now and the real photography drops in later without touching layout code.

**Architecture:** A repo-root `assets/brand/` becomes the single source of truth for brand
marks; `mobile/` keeps a copy of only the file it can render, and the motion those files describe
in SMIL is re-authored in Reanimated rather than imported (Task 4). Placeholders are a reusable UI
primitive (`ImagePlaceholder`) whose props carry the art brief as visible text, so the brief
lives in the component tree rather than in a doc nobody opens. Replacing a placeholder later is
a one-component swap at a stable call site.

**Tech Stack:** TypeScript ~5.9 strict · expo-router ~6 · react-native-svg 15.12.1 ·
react-native-svg-transformer · NativeWind 4 · lucide-react-native · jest + jest-expo +
@testing-library/react-native.

## Context: what already exists

| Thing | Where | Note |
|---|---|---|
| 14 delivered SVGs | `docs/peraplano-animated-svg/` | untracked; `README.txt` documents them |
| Favicon / manifest set | `docs/assets icons favicon and manifest/` | untracked; web-only |
| Source archive | `docs/favicon_io.zip` | untracked |
| SVG-as-component transform | `mobile/metro.config.js:13-15` | already wired, never yet used |
| SVG type declaration | `mobile/svg.d.ts` | already exists and is in `tsconfig.json` include |
| Onboarding shell | `mobile/components/onboarding/onboarding_frame.tsx` | progress dots, back, primary, skip |
| Target screen | `mobile/app/(onboarding)/how_it_works.tsx` | currently text + one `Card` |
| Brand-mark stand-in | `mobile/components/ui/empty_state.tsx:6` | uses lucide `Send` as the paper plane |
| Palette tokens | `mobile/constants/colors.ts` | `brand` #15803D / `brand-dark` #22C55E — matches the SVGs |

### THE CONSTRAINT THAT SHAPES THIS WHOLE PLAN

Every animated file in the delivery uses **SMIL** (`<animate>`, `<animateTransform>` — see
`docs/peraplano-animated-svg/README.txt` line 4). **`react-native-svg` does not implement SMIL.**
Imported through `react-native-svg-transformer`, those elements are dropped and the file renders
its **first frame, silently, with no error and no warning**. So 12 of the 14 files are static
decals on mobile and fully alive only in a browser.

That is why this plan moves all 14 to a shared location but copies exactly **one**
(`peraplano-logo-static.svg`) into `mobile/`. Porting the motion to Reanimated is real work with
its own design decisions, so it is **kept out of Tasks 1-3 and handled on its own in Task 4**
(added at the owner's request after Tasks 1-3 were specified). Tasks 1-3 alone leave the phone
showing a static mark; Task 4 is what makes the motion real on device.

## Global Constraints

These apply to EVERY task.

- **Naming — TWO rules, do not merge them.**
  - TypeScript/TSX source files and directories: **snake_case** (`image_placeholder.tsx`), same
    as the rest of the repo.
  - **Brand SVG asset filenames keep their delivered kebab-case names verbatim**
    (`peraplano-logo-static.svg`, `nav-ne.svg`). They are external design deliverables named by
    `README.txt` and by the doc-10 web handoff; renaming them breaks that handoff and makes the
    shared copy un-diffable against the source. This is a deliberate exception, not an oversight.
- **TS symbols:** `camelCase` values, `PascalCase` components/types, `SCREAMING_SNAKE_CASE` constants.
- **Nothing is deleted.** Files move; the originals do not get re-created at the old path and
  nothing is `rm`'d. Use `git mv` for tracked files, plain `mv` for untracked ones.
- **Commits:** Conventional Commits. **No AI-attribution trailer or footer of any kind.**
- **TDD:** named failing test → run it and watch it fail → minimal implementation → run it green → commit.
- **Test commands:** all tests `npx jest --ci`; one file `npx jest --ci <path>`; typecheck `npx tsc --noEmit`.
- **Working directory:** JS/TS commands run from `mobile/`; file moves run from the repo root.
- **Dark mode is not optional.** Every visual element ships a `dark:` variant, same as every
  existing component in `components/ui/`.
- **No new dependencies.** Everything here builds from what `mobile/package.json` already has.
- **A placeholder must be unmistakably a placeholder.** Dashed border, visible brief text, panel
  index. If a screenshot of it could be mistaken for finished art, it has failed its only job.

---

### Task 1: Shared brand asset home + `BrandMark`

**Files:**
- Move (no deletions): `docs/peraplano-animated-svg/*` → `assets/brand/`, with the eight
  `nav-*.svg` under `assets/brand/nav/`; `docs/assets icons favicon and manifest/*` →
  `assets/brand/favicon/`; `docs/favicon_io.zip` → `assets/brand/favicon/favicon_io.zip`
- Create: `assets/brand/README.md`
- Create: `mobile/assets/brand/peraplano-logo-static.svg` (a **copy** of the shared file)
- Create: `mobile/components/ui/brand_mark.tsx`
- Create: `mobile/test_support/svg_mock.tsx`
- Test: `mobile/components/ui/__tests__/brand_mark.test.tsx`
- Modify: `mobile/package.json` (jest `moduleNameMapper` only)

**Interfaces:**
```ts
// components/ui/brand_mark.tsx
export type BrandMarkProps = {
  /** Square edge in dp. Default 48. */
  size?: number;
  className?: string;
  testID?: string;
};
export function BrandMark(props: BrandMarkProps): React.JSX.Element;
```

**Rules:**
1. **`assets/brand/` at the repo root is the single source of truth.** `mobile/` holds a copy,
   not a symlink or a Metro `watchFolders` reach-out: Metro resolving above the project root is
   a known Windows/junction hazard this repo already works around
   (`mobile/metro.config.js:7-8`), and one 440-byte file is not worth re-opening it.
2. **`assets/brand/README.md` is the file that stops the next person from wasting a day.** It
   must state, in its own words: which files are SMIL-animated, that `react-native-svg` renders
   SMIL as a frozen first frame with no error, which single file is copied into `mobile/` and
   why, that the favicon set and `nav/` are web-only, and that `android-chrome-*.png` are PWA
   icons and **not** Android app icons (`mobile/assets/icon.png` is unrelated and stays put).
   Fold in what `README.txt` already documents — the replay trick, the brand hexes — rather than
   leaving two READMEs disagreeing. Keep the original `README.txt` beside it.
3. **`BrandMark` has no `variant` prop.** Only the static mark renders on RN today; a prop with
   one legal value is speculative API. The idle/launch/loading variants get added when they are
   actually implemented in Reanimated.
4. The SVG is imported as a component (`import Logo from "@/assets/brand/peraplano-logo-static.svg"`)
   and given `width={size} height={size}`. `svg.d.ts` already declares the module — do not add a
   second declaration.
5. **Jest cannot run the Metro SVG transform.** Add `"\\.svg$": "<rootDir>/test_support/svg_mock.tsx"`
   to the existing `jest.moduleNameMapper` in `mobile/package.json`. The mock is a component that
   renders a `View` and **forwards `testID` and every other prop it receives**, so a test can
   assert the mark was rendered at the right size. Give it a header comment explaining, as
   `test_support/style_mock.ts` does for CSS, that this is a deliberate transform stand-in and
   not a gap being papered over.
6. `empty_state.tsx` is **not** changed in this task. Its lucide `Send` stand-in keeps working;
   swapping it is a visual-regression question for a later pass, and widening this task to touch
   every empty state in the app is exactly the scope creep the review will catch.

**Tests (names are requirements):**
- `renders the brand mark at the default size`
- `applies an explicit size to both dimensions`
- `forwards testID`

**Verify:** `npx tsc --noEmit` clean; `npx jest --ci` fully green (the new mapper must not break
any existing suite).

---

### Task 2: The `ImagePlaceholder` primitive

**Files:**
- Create: `mobile/components/ui/image_placeholder.tsx`
- Test: `mobile/components/ui/__tests__/image_placeholder.test.tsx`

**Interfaces:**
```ts
// components/ui/image_placeholder.tsx
export type ImagePlaceholderProps = {
  /** Short scene name, e.g. "The tap". Rendered as the heading. */
  label: string;
  /** The art brief: what the final image must show. Rendered verbatim, in full. */
  brief: string;
  /** 1-based position, e.g. 2 — renders as "2 / 4" with `of`. Both or neither. */
  index?: number;
  of?: number;
  /** width / height. Default 16 / 9. */
  aspectRatio?: number;
  testID?: string;
};
export function ImagePlaceholder(props: ImagePlaceholderProps): React.JSX.Element;
```

**Rules:**
1. **The brief renders in full, never truncated.** The whole point is that a reviewer reads the
   intended scene off the running app. No `numberOfLines`, no ellipsis.
2. Visual: dashed 2dp border in the brand green, `bg-brand-soft` / `dark:bg-brand-soft-dark`
   fill, rounded corners matching the repo's existing radius scale, contents centred. Reuse
   `BrandMark` from Task 1 as the corner glyph — not a lucide icon — so the placeholder looks
   like it belongs to this product.
3. The index badge renders **only** when both `index` and `of` are given, and reads `"N / M"`.
   Passing exactly one of the two is a caller bug; render no badge rather than a half-formed one.
4. `aspectRatio` drives the box via RN's `aspectRatio` style, **not** a hardcoded height — the
   panel has to hold its shape across an A54 and a tablet alike.
5. Content overflowing the aspect box must stay readable: the brief is the payload, so let the
   box grow past its ratio rather than clip the text. Say which behaviour you chose in the
   file's header comment and make the test assert it.
6. This is a UI primitive with no knowledge of onboarding. It does not import from
   `components/onboarding/` and it does not know what a carousel is.

**Tests (names are requirements):**
- `renders the label and the full brief text`
- `renders the position badge when index and of are both given`
- `omits the position badge when only one of index or of is given`
- `applies the default 16:9 aspect ratio`
- `applies a custom aspect ratio`

**Verify:** `npx tsc --noEmit` clean; `npx jest --ci` green.

---

### Task 3: The value carousel on `how_it_works`

**Files:**
- Create: `mobile/components/onboarding/value_carousel.tsx`
- Create: `mobile/components/onboarding/value_panels.ts`
- Modify: `mobile/app/(onboarding)/how_it_works.tsx`
- Test: `mobile/components/onboarding/__tests__/value_carousel.test.tsx`
- Test: `mobile/app/(onboarding)/__tests__/how_it_works.test.tsx` (create if absent; extend if present)

**Interfaces:**
```ts
// components/onboarding/value_panels.ts
export type ValuePanel = {
  /** Stable key, snake_case. */
  id: string;
  label: string;
  /** The art brief handed to the photographer / image model. */
  brief: string;
};
export const VALUE_PANELS: readonly ValuePanel[];

// components/onboarding/value_carousel.tsx
export type ValueCarouselProps = { panels?: readonly ValuePanel[]; testID?: string };
export function ValueCarousel(props: ValueCarouselProps): React.JSX.Element;
```

**Rules:**
1. **The four panels, in this order, with these briefs.** Copy the brief text verbatim into
   `VALUE_PANELS` — it is the deliverable, not filler:

   | id | label | brief |
   |---|---|---|
   | `the_tap` | The tap | Young Filipino professional at a coffee-shop counter in a Manila mall, tapping a debit card on the POS terminal, barista mid-hand-off. Warm late-afternoon light, candid not posed. Their phone is still in their pocket — no app, no screen, nothing to do. This is the moment before PeraPlano does anything. |
   | `the_notification` | The notification | The same person walking to a table, phone now in hand, lock screen showing a single bank notification banner about a card purchase. PeraPlano is NOT open. Slight motion blur behind them. The notification is the raw material — it already arrives on every phone, whether or not anyone reads it. |
   | `already_logged` | Already logged | Seated, coffee on the table, PeraPlano open. The transaction is already there as a filled ledger row: merchant, amount in pesos, a wallet chip, a category chip, a timestamp. Their thumb hovers over the screen without typing. Nothing was entered by hand. This is the panel that has to sell the product. |
   | `whats_left` | What's left | Close-up of the phone on PeraPlano's Home tab: the Safe-to-Spend figure large and green, the weekly limit ring part-filled, the next-payday chip below it. Their shoulders relaxed in soft background bokeh. Capture is the mechanism; knowing what is safe to spend is the reason. End on control, not surveillance. |

2. **Art direction, stated once inside `value_panels.ts` as a file header comment** so it travels
   with the briefs:
   - Filipino subjects, Philippine settings. Not re-dressed American stock.
   - Warm natural light, candid framing, real phones held the way people hold them.
   - Brand green `#22C55E` appears as an accent — app UI, signage, a plant — never as a wash
     over the whole frame.
   - Panels 3 and 4 embed app UI, so each needs a **light and a dark** rendition.
3. **NO REAL BRANDS, ANYWHERE IN THE FINAL ART.** The cafe, the card, and the bank in the
   notification are all fictional. Two independent reasons, both binding: trademark exposure in
   shipped marketing art, and this codebase's existing rule that no invented string is presented
   as a real provider format — `how_it_works.tsx`'s own header cites docs rule 15 and its
   `Card` is labelled "illustrative only". A photo of a real bank's real notification would
   break the discipline the surrounding screen already keeps. Write this rule into the file
   header, not just into this plan.
4. **The carousel is horizontal, paged, and built from `ScrollView`** with `horizontal`,
   `pagingEnabled`, and `showsHorizontalScrollIndicator={false}` — no new dependency. Panel width
   comes from `useWindowDimensions()` minus `OnboardingFrame`'s `px-6` (24dp per side); do not
   hardcode a width.
5. **Dots below the panels, not `StepProgress`.** `components/onboarding/step_progress.tsx`
   tracks the nine-step onboarding flow; reusing it for panel position would show the user two
   different progress meters that disagree. Build a small local dot row inside
   `value_carousel.tsx`.
6. It nests inside `OnboardingFrame`'s vertical `ScrollView`. Verify the horizontal gesture is
   not swallowed — if it is, the fix belongs in this component, not in the frame.
7. **What `how_it_works.tsx` keeps:** its mechanism paragraph, its illustrative-notification
   `Card`, and its trust line all stay, along with every existing `testID`
   (`how-it-works-mechanism`, `how-it-works-example`, `how-it-works-trust`). The carousel is
   added above them. Any existing test asserting those testIDs must still pass untouched.
8. `VALUE_PANELS` is exported and the `panels` prop is injectable **so the test can drive a
   two-panel fixture** — that is the entire justification for the prop. Default to `VALUE_PANELS`.

**Tests (names are requirements):**
- `renders every panel's label and brief`
- `renders one dot per panel`
- `renders the four shipped value panels by default`
- `how_it_works still renders its mechanism, example and trust copy` (regression on rule 7)
- `how_it_works renders the value carousel above the mechanism copy`

**Verify:** `npx tsc --noEmit` clean; `npx jest --ci` fully green — including every pre-existing
onboarding suite.

---

### Task 4: Port the brand motion to Reanimated

**Added 2026-08-18 at the owner's request**, after Tasks 1-3 were already specified. Task 1 rule 3
said `BrandMark` has no `variant` prop, on the YAGNI grounds that only one value would be legal.
**This task supersedes that rule** — with four legal values the prop stops being speculative. That
is a deliberate amendment, not a contradiction, and the reviewer is told so.

**Why this task exists:** after Tasks 1-3 the phone shows a *static* paper plane and the five
animated deliverables are documented shelf-ware. `docs/10-web-design-prompt.md:83-86` always
intended the layered variant to be animated natively with Reanimated; this is that work.

**Files:**
- Create: `mobile/components/ui/brand_mark_motion.ts`
- Modify: `mobile/components/ui/brand_mark.tsx`
- Test: `mobile/components/ui/__tests__/brand_mark_motion.test.tsx`
- Modify: `mobile/components/ui/__tests__/brand_mark.test.tsx`

**Scope — exactly three variants, and the two that are excluded:**

| Variant | Source SVG | Shape of the motion |
|---|---|---|
| `idle` | `assets/brand/peraplano-idle-logo.svg` | infinite float |
| `launch` | `assets/brand/peraplano-launch.svg` | one-shot takeoff, freezes home |
| `loading` | `assets/brand/peraplano-idle-loop.svg` | infinite closed-path flight |

**NOT ported, and not a gap:** `peraplano-bg-planes.svg` (1600×900, 43 KB, seven independent
plane routes — a marketing hero, pointless and expensive on a phone) and `nav/*.svg` (8-direction
pagination; onboarding already has `components/onboarding/step_progress.tsx` and the app has no
8-way pagination anywhere). Say so in the file header so nobody re-opens it.

**Interfaces:**
```ts
// components/ui/brand_mark.tsx  — amends Task 1's interface
export type BrandMarkVariant = "static" | "idle" | "launch" | "loading";
export type BrandMarkProps = {
  size?: number;                 // square edge in dp, default 48
  variant?: BrandMarkVariant;    // default "static"
  /** `launch` only: any change to this value replays the one-shot. */
  playToken?: number;
  className?: string;
  testID?: string;
};

// components/ui/brand_mark_motion.ts — keyframes transcribed from the SMIL
export const IDLE_DRIFT: readonly { x: number; y: number }[];
export const IDLE_DRIFT_MS: number;          // 3400
export const IDLE_ROTATE_DEG: readonly number[];
export const IDLE_ROTATE_MS: number;         // 5200
export const LAUNCH_KEYFRAMES: readonly { t: number; x: number; y: number; opacity: number }[];
export const LAUNCH_MS: number;              // 1150
export const LOOP_PATH: readonly { x: number; y: number; deg: number }[];
export const LOOP_MS: number;                // 3200
export const TRAIL_DOTS: readonly { cx: number; cy: number; r: number; delayMs: number }[];
```

**Rules:**

1. **The SVG files are the specification; transcribe, do not invent.** Every constant carries a
   comment naming the source file and the attribute it came from. The values are already in the
   files — `IDLE_DRIFT` is `translate` `0 0;0.55 -0.45;0 0;-0.35 0.3;0 0` at `dur="3.4s"`;
   `LAUNCH_KEYFRAMES` is `translate` `0 0;-1.4 1.1;24 -18.5;24 -18.5;-7 5.4;0 0` with
   `keyTimes="0;0.16;0.56;0.6;0.64;1"` and the paired opacity track `1;1;0;0;1;1` at
   `keyTimes="0;0.56;0.58;0.63;0.72;1"`, all `dur="1.15s" fill="freeze"`; `LOOP_PATH` is the
   discretized translate list paired index-for-index with the rotate list in
   `peraplano-idle-loop.svg`. Transcribe the actual numbers out of the files. A hand-tuned
   approximation that "looks about right" is a defect — the designer's easing is the deliverable.
2. **`calcMode="spline"` with `keySplines="0.4 0 0.6 1"` is a cubic-bezier easing**, not linear.
   Map it to Reanimated's `Easing.bezier(0.4, 0, 0.6, 1)`. `launch` uses a different spline per
   segment (see its `keySplines`) — honour them per segment rather than flattening to one curve.
3. **REDUCED MOTION IS A HARD REQUIREMENT, NOT POLISH.** An infinite loop with no escape is an
   accessibility defect. Check whether `react-native-reanimated` 4.1.1 exports `useReducedMotion()`
   and use it if so; otherwise use `AccessibilityInfo.isReduceMotionEnabled()` plus its
   `reduceMotionChanged` subscription. **When reduced motion is on, every animated variant renders
   the static mark** — that is the honest degrade, and it is also exactly what the SMIL files do
   in a browser that refuses animation.
4. **Animations must stop on unmount.** Cancel every shared value / animation you start. A leaked
   infinite `withRepeat` keeps the JS thread awake and drains battery on a phone that has moved on
   to another screen. The test suite must prove the teardown, not assume it.
5. **`launch` freezes at its resting state,** matching SMIL `fill="freeze"` — it does not snap back
   mid-flight or leave the mark invisible. Its last keyframe returns to `0 0` at opacity 1, so the
   frozen state is the static mark; make sure the implementation actually lands there.
6. **`playToken` is the replay trigger** and mirrors the source README's own web trick
   (`img.src = 'peraplano-launch.svg?' + Date.now()`). An unchanged `playToken` must not re-fire on
   an unrelated re-render.
7. **Do not modify `assets/brand/*` or `mobile/assets/brand/*`.** This task reads the SVGs as
   reference and writes TypeScript. The static SVG import from Task 1 stays exactly as it is.
8. `empty_state.tsx` still stays untouched (Task 1 rule 6 holds).

**Tests (names are requirements):**
- `renders the static mark when no variant is given`
- `renders the static mark for every animated variant when reduced motion is enabled`
- `unsubscribes from the reduced-motion listener on unmount`
- `cancels its animations on unmount`
- `replays the launch animation when playToken changes`
- `does not replay the launch animation when an unrelated prop changes`
- `transcribes the idle drift keyframes from the source SVG` (assert the literal values, so a
  future edit that silently retunes the designer's easing fails CI)
- `pairs every loop path point with a heading` (`LOOP_PATH` translate and rotate lists came from
  two separate SMIL attributes — a length mismatch means a bad transcription)

**Verify:** `npx tsc --noEmit` clean; `npx jest --ci` fully green.

**⚠️ ON-DEVICE GATE — state this in the report, do not skip it.** Automated tests here prove
structure, reduced-motion degrade, keyframe fidelity and teardown. They **cannot** prove the
motion looks right. Whether the port actually reads as the designer's animation is an eyeball
check on the physical Samsung A54, and it belongs on the project's existing deferred on-device
ship-gate list. Report it as an open gate rather than implying the task is visually verified.
