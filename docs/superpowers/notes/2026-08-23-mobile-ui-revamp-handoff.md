# Mobile UI revamp — working notes and handoff

Branch `feat/mobile-ui-revamp`, worktree `.claude/worktrees/ui-revamp`.
Spec: `docs/superpowers/specs/2026-08-22-mobile-ui-revamp-design.md`.
Plans: `docs/superpowers/plans/2026-08-22-mobile-ui-revamp-part{1,2,3}-*.md`.
Live ledgers: `.superpowers/sdd/<plan-basename>/progress.md` (git-ignored; the
authoritative per-task record, and the thing to read first on resume).

This file is the part that must outlive the ledgers and the session context:
what we learned about *this codebase* and about *how to verify work here*.

---

## 1. State at handoff (2026-08-23)

Part 1 complete (whole-branch reviewed, fix wave applied). Part 2 complete
(8 tasks, all reviewed clean). Part 3: tasks 1, 2, 3, 6, 8 complete.

Last commit: `f3de1bb` — "fix(more): broaden the shared budgets no-pressable
guard past role".

**Two tasks died mid-flight to an API session limit. Neither committed.**
Their work is on disk, uncommitted, and must be triaged before anything else:

- **Plan detail routes (Task 4b)** — files *staged*, one step from commit:
  `app/(tabs)/plan/{goals/[id],limits/[id],limits/[id]/edit,limits/new}.tsx`,
  `app/__tests__/limit_routes.test.tsx`, and the `bills/`, `goals/`,
  `income/`, `limits/`, `loans/` component sets.
  **Known defect inside it:** `components/limits/limit_form.tsx(68,24)` fails
  typecheck with **TS1355** (`as const` applied to something that is not a
  literal). Confirmed twice, not a race. Almost certainly a literal reading of
  the brief's "declare segments `as const`" applied where it does not fit.
  Do not commit this until typecheck is clean.
- **More screens (Task 4)** — *unstaged* and **incomplete**: it stopped
  mid-edit while inserting a local `SettingCard` helper. Touches
  `app/(tabs)/more/{privacy,settings}.tsx`, `components/privacy/*`,
  `components/reports/*`.

Neither was committed deliberately: one is known-broken, the other is
half-written. A WIP commit of either onto the feature branch would put a
red typecheck into the history for no gain.

**Remaining after those two land:** Task 5 (system states: `ErrorState`,
`LoadingSkeleton`, the four `*-loading` views, 4 Android notification
layouts), the Chip accessibility sweep (Ruling P3-1), then **Task 7 (motion)
strictly last** — its own plan requires it to land on finished screens.
Then whole-branch review for Parts 2+3, then
`superpowers:finishing-a-development-branch`.

---

## 2. Repo facts that cost real time

Each of these burned at least one agent-session before it was understood.

**SQLite epoch-ms is not a date.** `date(occurred_at, 'localtime')` against an
epoch-millisecond column does not error — it silently returns `2000-01-01` for
every row. The correct form is
`date(occurred_at / 1000, 'unixepoch', 'localtime')`. A query built the wrong
way produces a plausible, entirely wrong chart. See
`lib/db/repos/transactions_repo.ts` (`dailySpend`).

**Spend filtering has no `is_transfer` column.** Match `sumSpend`:
`direction = 'out'` and `transfer_link_id IS NULL`.

**Nested `<Text>` wins over its parent in React Native.** A `tone` or size prop
applied to a wrapper is *inert* if the visible text sits in a child `<Text>`
that sets its own colour. This shipped once as a passing test that asserted
against the **wrapper's** className while the device rendered the parent's
colour. If a style prop targets text, assert on the node that actually renders
the glyphs.

**`useTheme()` throws without a `ThemeProvider`** (`theme_context.tsx:77`).
Shared primitives (`Chip`, gates) render inside provider-less tests, so a
primitive that calls `useTheme()` breaks suites far from itself. Ruling PF-1:
shared primitives use NativeWind's `useColorScheme()` instead.

**React Native sets `focusable: true` on any `Pressable` with a press
handler, regardless of `accessibilityRole`.** This is the only reliable
structural discriminator for "is anything on this screen tappable" —
`queryByRole("button")` misses a role-less `Pressable` entirely. Lucide SVGs
carry `focusable: false`, so they do not pollute the sweep.

**Font weight comes from `fontFamily`, not `fontWeight`.** RN does not
synthesise weight for `expo-font`-registered families. A Tailwind plugin
rewrites `font-normal|medium|semibold|bold|extrabold` to emit `fontFamily`,
with `corePlugins: { fontWeight: false }`. Adding a weight means registering
a font file, not adding a number.

**Expo Router route additions break `tsc --noEmit` until
`.expo/types/router.d.ts` regenerates.** The error reads like a broken import
and is not one. Regenerate before believing it. The file is git-ignored, so it
never arrives with a checkout.

**A fresh `git worktree add` has no `node_modules`.** Worktrees do not copy
git-ignored directories and there is no root `package.json` to hoist from.
This cost one agent its entire session chasing a phantom test failure
(Ruling PF-5). Install inside `mobile/` before dispatching anyone.

**Known parallel-load flakes**, not real failures: `bills_screen`,
`home_screen`, `transactions_screen`, `filter_bar` fail under
`maxWorkers: 60%` and pass in isolation.

**Contrast is measured, never eyeballed.** All three soft tones failed AA on
their own tints (brand 3.96, danger 3.69, warn 2.63); the "obvious" fix
`#B45309` reached only 4.13. The shipped answer is three dedicated ink
tokens in `constants/colors.ts` (`brand-ink`, `danger-ink`, `warn-ink`, plus
`-dark` variants), measured 5.63 / 6.36 / 5.85. Six provider badges likewise
need dark ink because white fails on them (gotyme 2.56 … shopeepay 3.66),
see `constants/providers.ts`. Use `lib/ui/contrast.ts` — do not estimate.

---

## 3. How to verify work here

**A green test proves nothing until it has been seen red.** Seven tests in
this run passed *identically against the bug they were written to catch*.
The standing method for any guard that matters: break the thing on purpose,
watch the test go red **for the stated reason**, restore, confirm
`git status` clean.

**Fault injection only proves what you inject — this is its blind spot.**
The sharpest lesson of the run: the shared-budgets no-pressable guard was
fault-injected by a re-reviewer, passed, and was declared sound. The
re-reviewer had injected a `Pressable` **with** an `accessibilityRole` — the
case that already worked. A bare `<Pressable>`, which is exactly what a
careless reintroduction produces, sailed straight through. The hole was real
and was found only by injecting the *inconvenient* case. Inject what you are
actually afraid of, not what is easy to write.

**A jest pattern matching zero files exits zero.** Naming a test file that
does not exist produces a confident green that tested nothing (Ruling PF-13).
Check the file count in the run output.

**Never run the suite against a dirty tree** while an implementer holds
uncommitted files — the failures you chase will not be yours (Ruling P2-4).
Related: a fault-injecting reviewer holds a **write** lock on the files it
touches, so it cannot run concurrently with an implementer in the same area
(Ruling P2-3).

**Do not pipe a backgrounded test run through `tail`.** It truncated the
output file here and destroyed 7 of 9 failure records. Redirect the full
output; read the tail afterwards.

**Derive review ranges from `git log`, never from the order reports arrived.**
Doing the latter swept another agent's commit into a review package — twice.

**Run the full suite between tasks.** Skipping it for ~10 commits let a
`plus-badge` cascade reach 8 suites before anyone noticed (Ruling P3-2).
When it did, the fix was per-assertion judgment, not a blanket flip: 6
assertions were inverted and `schedule_table.test.tsx:103` was correctly left
alone, because `rows=[]` returns before reaching `PlusGate`.

---

## 4. Instruction-writing lessons (for whoever briefs the next agents)

These are my own errors, and they share a shape: an instruction that is
correct where it was written and destructive where it lands.

- **Locally correct, globally destructive.** Hoisting the plan panels'
  `ScrollView` would have left four standalone routes unscrollable. Deleting
  `plan_hub.test.tsx` would have destroyed six unrelated `usePaydayAllocations`
  hook tests. Check what else lives in a file before prescribing surgery on it.
- **Do not invent capabilities.** A brief specified "Split transaction" and
  "Mark as transfer" UI — zero source matches for either. The real pair is
  `TransferLinkActions`. Grep before you prescribe.
- **Rest-state promises are a product bug, not a copy nit.** The
  "Notify me when it ships" button promised a registration the app cannot
  perform. `docs/11-mobile-app-design-prompt.md`'s "TWO GATING STATES" had
  already specified Soon screens as **non-interactive** — the answer existed
  before the question was asked. Control removed (Ruling P3-3). **A close-out
  sweep for other rest-state promises is still outstanding.**
- **A privacy decision can look like a UI defect.** A brief specified the
  source-notification panel as always-visible; it is collapsed behind a tap,
  and `why_recorded_panel.tsx` documents that as a deliberate **privacy**
  choice. 13–14 of 34 tests pin it. Read the comment before "fixing" the
  behaviour.
- **Prefer invariants to counts in comments.** "Every call site that does not
  pass `size` gets the default" survives a fifteenth caller; "all fourteen
  call sites" does not. See `components/ui/numeric_field.tsx`.
- **Check a type before referencing its fields.** `Wallet` has no
  `providerKey` — that field is on `UserRuleMatcher`.

---

## 5. Owner device checklist (A54 — no subagent can do these)

Font weights render correctly — **confirmed by owner**. Still open:

- Card shadow and hairline, light vs dark.
- Red Transactions tab badge.
- Chip geometry in dense rows.
- Soft warn/danger chips readable in daylight.
- The four Plan back-stack checks: tap a Home alert → detail → Android
  system back → the **list** appears, not a blank screen.
- All twelve onboarding steps from a wiped install.
- Motion with "Remove animations" both off and on.

---

## 6. Product constraints that shaped the UI

- **No third-party auth exists.** There is no Google sign-in, so there is no
  name to greet. The greeting is **"Beta User"**, which doubles as an early-
  adopter identity.
- **Beta-cohort identity (R7) is deferred**, bundled with the future Google
  account-linking work rather than built now — owner's call.
- Soon-gated screens are **non-interactive**. No control on a Soon screen may
  imply a capability the backend cannot deliver.
