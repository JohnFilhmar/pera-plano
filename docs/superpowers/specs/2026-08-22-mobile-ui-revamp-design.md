# PeraPlano Mobile — UI/UX revamp against the design handoff

**Status:** Design v1 · 2026-08-22 · approved in conversation, question by question. Every
decision below was put to the owner as an explicit choice; where the owner chose something other
than the recommendation, this file records the choice, not the recommendation.

**Source design.** `docs/pera-plano-mobile/PeraPlano Mobile UI.dc.html` — 36 artboards in 8
sections (cover, 00 component sheet, 01 onboarding … 07 system states), each with a Light and a
Dark twin, 72 boards total. Phone skeleton is 360×740.

**Why this file exists.** The app already has every feature the design draws.
`constants/shipped_features.ts` reports every `FeatureKey` as `"shipped"`, and the component tree
already carries `safe_to_spend_hero`, `limit_progress_list`, `upcoming_bills_strip`,
`tracking_banner`, `review_card`, `matcher_chip_list`, `cash_reconcile_sheet`, `donut_chart`,
`ranked_bars` and `trend_line`. What the app does not have is the design's visual weight:
hierarchy, icon avatars, tabular money, tinted chips, a state-coloured hero. **This is a restyle of
a complete app, not a rebuild.** Treating it as a rebuild is the fastest way to lose the working
ingest layer underneath.

**One thing this file asserts that no repo document supports.** The type-scale floor in §3.2
(body 13→14sp, secondary 11.5→12sp) is a judgement made here, not a design instruction. It is
flagged in place.

---

## 0. How to read this

- **Delta** — what changes. Anything not listed as a delta does not change.
- **What breaks if skipped** — the actual failure, not a vague risk. This is the line that decides
  sequencing when time is short.
- **Untouched** means untouched: same file, same props, same `testID`. `testID`s are preserved
  across the entire revamp; no screen's tests lose their handles.

---

## 1. Scope

**In:** all ~40 routes and ~100 components. Screens with no artboard — recovery phrase, device
lock, lock screen, Settings, About, parser diagnostics, and every detail/edit route — are
extrapolated from the component sheet rather than left on current styling. The owner chose full
extrapolation specifically so that no styled screen pushes into an unstyled one.

**Out, and deliberately so:**

| Not doing | Why |
|---|---|
| `peraplano-bg-planes.svg`, `nav/*.svg` ports | 43 KB across 7 plane routes, and an 8-direction pagination set with nothing in the app to drive it. `assets/brand/README.md` already reasons both out; the motion budget is "restrained + moments". |
| Optional first-name field | Superseded — see §6.2. |
| Notification bell + a new Alerts route | Owner declined. The inline `alerts_feed.tsx` stays and is restyled. |
| Any purchase path | §6.1. |
| Beta-cohort persistence | Deferred to Google account linking — §6.3. |
| Shared budgets, the feature | Only the `SoonGate` placeholder ships — §5.6. |

---

## 2. Decisions locked

| # | Question | Decision |
|---|---|---|
| D1 | How far the revamp reaches | Every route, extrapolating where no board exists |
| D2 | Product voice | Filipino-flavoured — "Utang", "Kinsenas period", "Kumusta" |
| D3 | Onboarding shape | All 12 steps kept, including recovery phrase and device lock, restyled in place |
| D4 | Motion budget | Restrained + success moments |
| D5 | Plan IA | Segmented (Limits / Goals / Utang / Bills); Income becomes a row under Limits |
| D6 | Home additions | Tri-tile, hero 7-day bars, FAB + Transactions tab badge. No bell, no Alerts route |
| D7 | Plus tier | Built and styled; explicitly free for beta testers, indefinitely; no prices, no trial CTA |
| D8 | Delivery | Atoms first, then one commit per section |
| D9 | Plus badging | Chips read `PLUS · free in beta` |
| D10 | Wallet cap | No cap in beta; paywall sheet built but never triggered |
| D11 | Shared budgets | `SoonGate` row + full "coming in an update" screen |

D3 matters more than it looks. Recovery phrase and device lock fix parameters that cannot change
once a user holds a phrase; moving them within the flow is not a styling decision.

---

## 3. Foundation

### 3.1 Tokens — `constants/colors.ts`, `tailwind.config.ts`

Every semantic token in the app already equals the design's VARBLOCK exactly: `brand`
`#15803D`/`#22C55E`, `bg` `#F7FAF7`/`#0B1210`, `surface` `#FFFFFF`/`#111A16`, `fg`, `fg-2`,
`danger`, `warn`, and `brand-soft` (the design's `--mint`). Three additions, and no others:

| Token | Light | Dark | Role |
|---|---|---|---|
| `line` | `#E3EBE5` | `#22302A` | Dividers, chip borders, dark-mode card hairline |
| `chip` | `#EDF3EE` | `#18231E` | Unfilled chip and segment-track surface |

Dark-mode elevation is **not** a token. `constants/__tests__/colors.test.ts` asserts every
`palette` key has a `-dark` sibling, and a shadow string has no meaningful dark sibling — it
is not a colour. `Card` keeps `shadow-sm` in light and gains a `dark:border dark:border-line-dark`
hairline instead; a drop shadow on `#0B1210` is invisible regardless.

**Soft chip tones are computed, not tokenised.** Background is the semantic token at 12–14% alpha;
text is that same token at full strength. This is the design's own rule — `rgba(217,119,6,.14)`
with `var(--wn)` for "due today", `rgba(220,38,38,.12)` with `var(--dg)` for "overdue 2d". No new
hexes, with one exception in §7.6.

The `chart-1..8` ramp is untouched and stays non-semantic. Nothing in this revamp may paint a
status with a chart colour, or a chart slice with a semantic one.

### 3.2 Type scale

Inter throughout. Money uses tabular figures.

| Role | Weight / size | Role | Weight / size |
|---|---|---|---|
| hero-money | 800 / 40sp tabular | screen-title | 700 / 20sp |
| section | 700 / 15sp | row-title | 600 / 13sp |
| body | 500 / **14sp** | secondary | 500 / **12sp** |
| micro-label | 600 / 11sp | badge | 700 / 10sp |
| mono | 600 / 11sp `ui-monospace` | | references, captured text |

**The two bold figures deviate from the boards**, which set body at 13px and secondary at 11.5px
at 360dp. 13sp sits under Android's `body-medium` default, and this app's entire proposition is
being read at a glance on a phone, frequently outdoors. Every other ratio in the design is kept
exactly.

### 3.3 Atom changes — `components/ui/*`

Most screens improve without being touched, which is why this lands before any screen work.

- **`Chip`** — gains `fill: "solid" | "soft" | "outline"` alongside the existing `tone`. Today
  `brand` / `warn` / `danger` are solid fills; the design uses solid only for an active filter or
  segment and tints everywhere else. `soon` keeps its exact current grey — `SoonGate` renders this
  component, and grey-versus-green means "not built" versus "needs Plus". That contract does not
  move.
- **`Button`** — adds `outline-destructive` (surface fill, `danger` border, `danger` text — the
  design's "Wipe everything"), an explicit disabled visual, an icon-pill form (`+ Add`), and
  `size: "md" | "lg"`. Radius → 999.
- **`Card`** — keeps `rounded-2xl p-4`. Gains the dark-mode hairline in place of the shadow.
- **New `ProviderBadge`** — 14dp rounded square, provider colour, white 800-weight initial. Needs
  a `PROVIDER_BADGE` map in `constants/providers.ts` (colour + letter per key) beside the existing
  `PROVIDER_LABELS`. Coloured initials, not logos — no trademark surface.
- **New `SegmentedControl`** — four screens hand-roll this today: Plan's four panels, manual
  entry's Expense/Income/Transfer, income cadence, and Amount-₱-versus-%-of-income.
- **New `StatTile`, `MiniBars`, `ShareBar`, `Fab`.**
- **Restyled, APIs unchanged:** `ListRow`, `AmountText`, `EmptyState`, `BottomSheet`,
  `NumericKeypad`, `SectionHeader`, and the tab bar.

---

## 4. Motion

SMIL is inert on this platform — `react-native-svg` drops `<animate>` and renders frame one
silently (`assets/brand/README.md`). `components/ui/brand_mark_motion.ts` already holds the
designer's transcribed keyframes for idle, launch and idle-loop, and
`components/ui/__tests__/brand_mark_motion.test.tsx` asserts the literal values. **This revamp
extends that file; it never retunes it.**

| Trigger | Asset | Behaviour |
|---|---|---|
| Splash → first frame | `launch` | One-shot takeoff, hands off to Home |
| Every loading / skeleton state, pull-to-refresh | `idle-loop` | Infinite; replaces the bare `ActivityIndicator`s |
| All five empty states | `idle-logo` | Slow drift; replaces the static mark |
| Onboarding 9 "You're all set" | `launch` + confetti dots | As drawn on the board |
| Goal reached · limit created · first auto-capture | `launch` | One-shot, ~600 ms, non-blocking |
| Hero state change (healthy → near → over) | — | Colour cross-fade + number roll. Not a plane. |

Every beat is a pure Reanimated worklet with no JS callback mid-flight, honours
`AccessibilityInfo.isReduceMotionEnabled` by degrading to a fade, and is measured on the A54 before
the motion commit lands. Rationale in §7.8.

---

## 5. Screens

### 5.1 · 02 Home
Greeting header — `Kumusta, Beta User` over `Kinsenas period · 8 days left`. No bell. The hero
gains 7-day `MiniBars` tinted to state, and the eye toggle that hides amounts. `StatTile` row:
Balance (wallet sum), Spent so far (period spend), Saved (goal balances) — all three already
computed elsewhere in the app. Limits list gains `See all`. Bills strip restyled. FAB added. The Transactions tab badge already exists
(`app/(tabs)/_layout.tsx` sets `badged: true` and renders `ReviewCountBadge`); it is
recoloured from `bg-brand` to `bg-danger` to match the board, not built from scratch.

The four hero states already exist in `components/home/safe_to_spend_hero.tsx`. This is colour and
layout, not logic.

### 5.2 · 03 Transactions
Header gains search and filter actions. Filter chip row (All / Review N / month / wallet /
category). "N need a quick check" banner. Day-group headers carry a day total. Rows gain a category
icon, wallet name and time.

The review queue gains the confidence percentage, the captured-text block, category suggestion
chips and the "Remember this next time" checkbox. Detail gains the icon medallion, the
`AUTO-CAPTURED · 96% MATCH` chip, and the source-notification block with its 30-day expiry line
(`components/privacy/expiry_countdown.tsx` already exists).

### 5.3 · 04 Wallets
Total card gains `ShareBar` plus legend. Rows gain `ProviderBadge`, listening state and last-seen;
the mismatch badge moves inline. Detail gains the brand-coloured balance header, matcher chips and
the GSave-split hint.

**No wallet cap.** The "Add a 4th tracked wallet · PLUS" card becomes a plain "Add wallet". The
paywall sheet is still built and styled — it is a designed board — but nothing triggers it in beta.

### 5.4 · 05 Plan
Becomes segmented. `app/(tabs)/plan/index.tsx` hosts the `SegmentedControl` and renders the active
panel. The four list routes stay as real, routable screens that re-export the same panel
components, so deep links and back-navigation still resolve (§7.4). `/plan/income` becomes a row at
the top of the Limits panel — where it belongs, since percent-of-income limits read from it. Tab
label **Loans → Utang**. Detail and edit routes are structurally untouched, restyled only.

### 5.5 · 06 More
Profile card: paper-plane avatar, **Beta User**, `Beta tester · everything unlocked`. Grouped
Insights / Tracking / App sections. Reports gains the donut plus legend, six-period bars and the
ranked list. About shows the version and a static `Beta` chip — **no install date**, because
nothing records one (§6.3). A date rendered there would be either invented or read from a value
this revamp explicitly does not persist.

Free-vs-Plus becomes **"Everything's unlocked — free for beta testers, forever"**: capability rows
survive; prices, the trial CTA, and the per-tier counts do not (§7.3).

### 5.6 · 07 System states
Four Android notification layouts, five empty states, the loading skeleton, the error state, the
Plus sheet (built, untriggered), and the Soon screen. Shared budgets ships as a `SoonGate` row in
More plus the full "coming in an update" screen with its three bullets and "Notify me when it
ships" — the feature itself is not built.

### 5.7 · 01 Onboarding
All 12 steps restyled; none added, removed or reordered. Recovery phrase and device lock keep their
position and gain the same visual language as the nine designed steps. The provider picker becomes
the two-column grid with `ProviderBadge`s, replacing today's lowercase checkbox list. Wallet setup
stops surfacing raw package ids such as `com.samsung.android.app.smartcapture` as wallet names.

---

## 6. Tier and identity

### 6.1 Plus in beta
`lib/entitlements.ts` already hardcodes `MVP_TIER = "plus"`, so every capability is already
unlocked and every free cap is already inert. Nothing about enforcement changes here.

What changes is that the state becomes *visible*: `PlusGate` renders a non-interactive
`PLUS · free in beta` chip on the unlocked path, so the design's mint lock badges actually appear
(§7.2). The locked path — press intercept, upgrade sheet — is untouched and stays correct for the
day pricing turns on.

### 6.2 "Beta User"
A fixed string in the UI layer. No name field, no third-party auth, no account. It reads as an
introduction, and as a tag early testers keep.

### 6.3 What is deliberately *not* built
Nothing persists a beta cohort. No `first_install_at`, no `build_channel`, no cohort id.

The owner's decision is that cohort identity ships **with** Google account linking, not before it.
This file records the consequence rather than arguing with it: **an install date cannot be
reconstructed retroactively from the app.** When account linking lands, the only evidence of who
installed during beta will be Google Play Console's install records. Whether Play Console exposes
per-account first-install dates in an exportable form **has not been verified**, and should be
before the beta ends, because it is the sole surviving source.

Filed as a new v2 backlog item — see §9.

---

## 7. Risks, and how each is handled

### R1 · The design's font weights are not loaded
`app/_layout.tsx:382` loads exactly `Inter_400Regular`; `tailwind.config.ts` maps `sans` to it
alone. Every `font-semibold` and `font-bold` in the app today falls through to the system face.

**Resolution.** All four weights (500/600/700/800) land as their own commit containing no screen
changes, followed by an A54 pass over the five tab roots and every `numberOfLines={1}` row, with
any truncation fixed inside that same commit.

The weights are wired through a Tailwind plugin that overrides `font-normal` /
`font-medium` / `font-semibold` / `font-bold` / `font-extrabold` to emit `fontFamily`
rather than `fontWeight`. React Native does not synthesise weight for a single-weight
registered family, so `fontWeight` is inert on Android; overriding the utilities keeps all
166 existing call sites working and makes them render the correct weight for the first
time, with no codemod across 76 files.

**What breaks if skipped.** Glyph metrics shift on every screen simultaneously — wider button
labels, rows that fit today beginning to truncate, and the tab bar's longest label
("Transactions") clipping at 360dp. Landed alongside screen work, the cause is unattributable.

### R2 · The Plus badges are currently dead code
`components/gates/plus_gate.tsx:31` returns bare children when `getTier() === "plus"`, and
`MVP_TIER` is `"plus"`. **No PLUS badge has ever rendered in the running app**, though the mint
chips appear on 9 of the 36 boards.

**Resolution.** `PlusGate` renders the badge in both branches; the unlocked one is
non-interactive and reads `PLUS · free in beta`. `components/gates/__tests__/gates.test.tsx` gains
a plus-path badge assertion beside its existing free-path one.

**What breaks if skipped.** Restyling the badge inside the `free` branch ships the entire Plus
visual language as unreachable code, and nothing changes on screen — discoverable only on device.

### R3 · The design's tier counts contradict the code
The board's Free-vs-Plus table says "Limits & goals — 3 each". `lib/entitlements.ts` says
`FREE_ACTIVE_LIMIT_CAP = 1`, `FREE_GOAL_CAP = 1`, `FREE_LOAN_CAP = 1`. Wallets agree at 3; limits
and goals are off by 3×.

**Resolution.** The table ships capability rows only — no counts, which fits removing prices
anyway. The 1-versus-3 conflict is logged in `docs/08-risks-and-open-questions.md` so it blocks the
pricing launch instead of surfacing after it.

**What breaks if skipped.** The app advertises a free plan three times more generous than the code
will enforce, to precisely the audience that was promised permanent Plus.

### R4 · Plan segments would orphan four live routes
`app/(tabs)/plan/_layout.tsx` is a bare `<Stack>`. `/plan/limits`, `/plan/goals`, `/plan/loans`
and `/plan/bills` are real routes that detail screens pop back to, and
`components/home/alerts_feed.tsx` deep-links to `/plan/limits/[id]` and `/plan/bills/[id]`.

**Resolution.** The four route files stay as real screens and re-export the same panel components
the segment host renders. Tapping a segment is a state change, not a navigation.

**What breaks if skipped.** Tap an alert on Home → limit detail → Android system back → a dead
route, or dropped out of the tab entirely.

### R5 · Tests assert precisely what is being inverted
`app/__tests__/plan_hub.test.tsx:104-108` asserts `getByText("Loans")` and that `"Income"` is
absent; line 79 asserts the hub navigation that segments remove. Roughly a dozen files across the
sections assert on copy that changes.

**Resolution.** Tests are rewritten inside the same commit as the section they cover, so every
commit on the branch is independently green. `plan_hub.test.tsx` becomes a segment test asserting
panel swap rather than `push`.

**What breaks if skipped.** Loosening assertions to `testID`s instead would let a future copy
regression — "Utang" silently reverting to "Loans" — pass CI unnoticed.

### R6 · Soft chips break a contrast guarantee the code documents
`components/ui/chip.tsx` carries recomputed WCAG figures for the *solid* fills only (brand
5.0/7.79, danger 4.8/6.42, warn-dark 10.63). A soft chip is semantic-colour text on a 12–14% tint
of itself — a pairing none of those numbers cover. `warn` `#D97706` on its own 14% tint lands near
**3.6:1**, under AA at the 11sp the design sets "due today" in.

**Resolution.** Soft-`warn` text drops to `#B45309` — the one new hex in this revamp. All six soft
pairings are computed and written into `chip.tsx`'s comment block in the existing style, and a unit
test asserts each clears 4.5:1.

**What breaks if skipped.** Without the test it re-breaks silently the next time anyone moves
`warn` or `bg` — which is the exact incident that comment block already records.

### R7 · The beta tag has nothing behind it
Deferred by decision — see §6.3. Recorded, not solved.

### R8 · Motion on the A54
The first-auto-capture beat fires off a notification-driven ledger commit, so the JS thread may be
parsing while it plays.

**Resolution.** UI-thread-only worklets, no JS callbacks mid-flight, the auto-capture beat deferred
one frame past the ledger commit, `isReduceMotionEnabled` degrading all four beats to a fade, and
device verification before the motion commit lands.

**What breaks if skipped.** A stuttering plane is worse than no plane, and it stutters exactly when
the app is doing the thing it exists to do.

### R9 · The hero's seven bars would re-read the whole ledger
`lib/reports/aggregate.ts:248` `trendSeries(transactions, ranges)` takes a `Transaction[]`, and
`app/(tabs)/index.tsx:47` already calls `useTransactions({})` unfiltered.

**Resolution.** A narrow `useDailySpend(7)` hook aggregating in SQL — `GROUP BY date` over seven
days returns seven rows regardless of ledger size. Home also drops the unfiltered
`useTransactions({})` it currently uses only for a `length === 0` empty-state check; that becomes a
`COUNT`.

**What breaks if skipped.** On 400+ transactions Home re-reads the entire ledger on every focus to
draw seven small bars — worst for exactly the long-term users the app most wants to keep.

---

## 8. Sequencing

One commit per row. Each lands with its own tests green.

| # | Commit | Notes |
|---|---|---|
| 1 | Inter 500/600/700/800 + A54 truncation audit | R1. No screen changes in this commit. |
| 2 | Tokens: `line`, `chip` | §3.1 |
| 3 | Atoms: `Chip` fills, `Button`, `Card`, `ProviderBadge`, `SegmentedControl`, `StatTile`, `MiniBars`, `ShareBar`, `Fab`, soft-contrast test | R6 lands here |
| 4 | 02 Home — header, hero bars, tri-tile, FAB, tab badge, `useDailySpend(7)` | R9 lands here |
| 5 | 03 Transactions | |
| 6 | 04 Wallets | |
| 7 | 05 Plan — segments, Income row, Loans → Utang | R4, R5 land here |
| 8 | 06 More — profile, Reports, Free-vs-Plus, `PlusGate` both branches | R2, R3 land here |
| 9 | 07 System states + Shared budgets `SoonGate` | |
| 10 | 01 Onboarding — all 12 steps | |
| 11 | Motion layer | R8. Last, so it lands on finished screens. |

Motion is last on purpose: animating screens that are still moving wastes the device-verification
pass it requires.

---

## 9. Documents this revamp must also change

- `docs/08-risks-and-open-questions.md` — add the free-tier count conflict (R3): limits and goals
  are 1 in code, 3 in the design; blocking before pricing.
- `docs/09-v2-backlog.md` — add **Google account linking & beta cohort**, carrying the deferred R7
  work: cohort identity, honouring the permanent-Plus promise, and the Play Console reconciliation
  question from §6.3. Prerequisite: the server exists (build order is mobile → server → web). Not
  blocked by §4's standing non-goals — account linking is not among them.

---

## 10. Cross-references

- Design handoff: `docs/pera-plano-mobile/PeraPlano Mobile UI.dc.html`
- Design language and the two gating states: `docs/11-mobile-app-design-prompt.md`
- Tier matrix: `docs/05-monetization.md` §2
- Brand assets and the SMIL constraint: `assets/brand/README.md`
- Information architecture: `docs/06-information-architecture.md`
- Plus prerequisites: `docs/superpowers/specs/2026-08-21-plus-tier-prerequisites.md`
