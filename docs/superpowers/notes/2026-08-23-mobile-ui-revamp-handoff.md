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

Two tasks were killed mid-flight by an API session limit on 2026-08-22 and
recovered on 2026-08-23:

- **Plan detail routes (Task 4b)** — recovered and committed as **89c3d0d**
  (23 files, +1022/−477). It had already fixed the TS1355 I flagged before it
  died; `components/limits/limit_form.tsx:68` now carries a comment explaining
  why `as const` does not belong there. Typecheck clean, 10 suites / 130 tests
  green. Committed with a bare `git commit` (never `-a`) so the other task's
  unstaged work could not leak in.
- **More screens (Task 4)** — died mid-insert of a local `SettingCard` /
  `SettingRow` helper, leaving six `TS2552: Cannot find name 'SettingRow'`
  sites in `app/(tabs)/more/settings.tsx`. Re-dispatched with the breakage
  named, told to finish rather than restart.

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

**`ListRow` clamps its subtitle to one line, and no test can see it.**
`components/ui/list_row.tsx` hard-codes `numberOfLines={1}` on the subtitle.
Routing a long sentence through it clips to roughly 15-30 visible characters
on a phone — and React Native Testing Library does **not** simulate device
line-clamping, so `getByText` finds the full string and the test passes. This
shipped once and reached a privacy disclosure whose own comment labels it a
"verbatim promise". If a layout constraint is visual-only, assert the **prop**
(`numberOfLines`), never the text. The same blindness applies to anything RTL
does not lay out: width, overflow, and truncation are all invisible to it.

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

**Lucide icons need a wrapper for both `testID` and `className`.** A `testID`
passed to a lucide icon does not reach RNTL's `getByTestId` — put it on a
wrapping `<View>`. And lucide icons ignore `className` until `cssInterop` has
been run over them, which is what `registerIcon` is for; icons pulled out of a
map rather than imported at module scope must go through it. Both are already
documented in `components/wallets/wallet_type_icon.tsx:36-45` — read that file
before adding any icon.

**`cssInterop` inserts a wrapper that consumes `className` before the icon
sees it.** This is why asserting an icon's tone is awkward, and why tests here
kept reaching for a nearby `View` instead: NativeWind generates an
intermediate component (`CssInterop.TriangleAlert` and friends) that swallows
the prop, so the real lucide element never carries the class string. The
stable way to assert an icon's tone is to query the icon **by imported type**
and read `className` off its `.parent` — not to wrap it in a decorative
`View` and read that, which couples the test to a node that only looks
authoritative. Test the render path, not a proxy that happens to sit near it.

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

**A fresh install never renders `app/index.tsx`.** `lock_context.tsx`'s
`needs_onboarding` status routes through `app/lock.tsx` **straight** to
`app/(onboarding)/index.tsx`, bypassing the splash screen entirely; the flow
then starts at `welcome`. So anything placed on `app/index.tsx` — the splash
brand mark included — is seen only by returning users, and the first screen a
brand-new user actually sees is `welcome.tsx`. This is stated in
`app/index.tsx`'s own header (lines 7-8) and is easy to get backwards: I
assumed the splash animation covered the first-run moment, and it does not.
Check which entry path a screen sits on before reasoning about what a new user
experiences.

**Suite-level flakiness under parallel load is broader than any fixed list.**
`bills_screen`, `home_screen`, `transactions_screen` and `filter_bar` are the
ones seen most often under `maxWorkers: 60%`, but two independent runs on this
branch each hit a *different* test, green in isolation. Treat the list as
examples, not as the set — always re-run a suspected failure in isolation
before treating it as a regression, and equally, never assume a red test is
"just the flake" because it appeared during a parallel run.

**Contrast is measured, never eyeballed.** All three soft tones failed AA on
their own tints (brand 3.96, danger 3.69, warn 2.63); the "obvious" fix
`#B45309` reached only 4.13. The shipped answer is three dedicated ink
tokens in `constants/colors.ts` (`brand-ink`, `danger-ink`, `warn-ink`, plus
`-dark` variants), measured 5.63 / 6.36 / 5.85. Six provider badges likewise
need dark ink because white fails on them (gotyme 2.56 … shopeepay 3.66),
see `constants/providers.ts`. Use `lib/ui/contrast.ts` — do not estimate.

---

## 3. How to verify work here

**A green test proves nothing until it has been seen red.** Tests on this
branch passed *identically against the bug they were written to catch* often
enough that it is the default suspicion, not the exception — deliberately not
a count here, because the number only ever goes up. The standing method for
any guard that matters: break the thing on purpose, watch the test go red
**for the stated reason**, restore, confirm `git status` clean.

The recurring shape is a test asserting against **the wrong node or the wrong
property**. Three confirmed instances, all the same mistake: `StatTile` read
the wrapper's className while a nested `<Text>` decided the colour; `ListRow`
read the text content while `numberOfLines` decided whether it was visible;
`ErrorState` read a decorative wrapper's className while the icon it wrapped
carried its own. Ask what the assertion would do if the defect were present,
and answer it by making it present.

**A brief can mandate a vacuous test, and then the implementer is blameless.**
`loading_skeleton.test.tsx` pinned `accessibilityLabel` and never `accessible`
— so removing `accessible` kept it green while TalkBack regressed to reading
every row. That test's code was supplied verbatim by the plan; the implementer
transcribed it exactly as instructed. **Test code written into a plan gets no
review pass of its own unless someone deliberately gives it one.** When a plan
hands over a test verbatim, check what it would fail against before shipping
it — the pre-flight scan is meant to catch this and did not.

**Fault injection only proves what you inject — this is its blind spot.**
The sharpest lesson of the run: the shared-budgets no-pressable guard was
fault-injected by a re-reviewer, passed, and was declared sound. The
re-reviewer had injected a `Pressable` **with** an `accessibilityRole` — the
case that already worked. A bare `<Pressable>`, which is exactly what a
careless reintroduction produces, sailed straight through. The hole was real
and was found only by injecting the *inconvenient* case. Inject what you are
actually afraid of, not what is easy to write.

**A broad `testID` regex query silently changes meaning when you add a
child.** `charts.test.tsx` pinned ranked-bar order with `/^ranked-bar-/`.
Adding an `Nx` count `Chip` to each row introduced `ranked-bar-<x>-count` —
and the Chip's own internal `-count-label` — so the query started returning
nine elements where the assertion expected three. The test did not fail; it
compared a different thing. When you add a child to a row that any test
queries by prefix, re-read that test. Prefer a query narrow enough that a new
sibling cannot join it.

**A negative assertion needs a positive anchor.** A guard made only of
`queryBy…toBeNull` passes against a component that renders *nothing at all* —
it cannot tell "the bad control is gone" from "the whole screen is gone".
Confirmed here by forcing `ProviderSuccessMeter` to `return null`: the
no-report guard stayed green while three sibling tests correctly failed. Fixed
by asserting the row is present *before* asserting the control is absent. My
own dispatch caused this by phrasing the requirement purely negatively
("assert the screen renders no control claiming to report") — **when you ask
for a guard against something, also say what must still be there.**

**A jest pattern matching zero files exits zero.** Naming a test file that
does not exist produces a confident green that tested nothing (Ruling PF-13).
Check the file count in the run output.

**Never run the suite against a dirty tree** while an implementer holds
uncommitted files — the failures you chase will not be yours (Ruling P2-4).
Related: a fault-injecting reviewer holds a **write** lock on the files it
touches, so it cannot run concurrently with an implementer in the same area
(Ruling P2-3).

**Never fault-inject with `git stash`.** An agent here injected a fault by
`git stash push --keep-index`, running the test, then `git stash pop`. It
worked, and the risk was real: the stash stack is shared with the main
checkout and every other worktree and session, so a `pop` can restore — or a
concurrent push can displace — work belonging to someone else entirely. My
dispatches forbade `git add -A` and `git commit -a` and said nothing about
stash, which is the more dangerous of the three because it silently touches
state outside this worktree. **To inject a fault, edit the file and edit it
back.** Every dispatch should say so explicitly.

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

- **A deferral that lands only in prose has no owner.** Task 6's report
  deferred a decision "to Part 3 Task 7"; Task 7's Files list never received
  the file, so its implementer correctly left it alone as out of scope.
  Neither agent erred — the handoff itself was unowned, and the gap survived
  two reviews because each task was individually complete. When one task
  defers a decision to a later one, put the file in that task's **file list**,
  not only in its narrative.
- **An instruction can be arithmetically right and physically wrong.** I told
  an agent to reach a 44×44 touch target with `hitSlop` and said nothing about
  row spacing. It did exactly that — uniform slop of 12 against an 8px
  `gap-2`, so every chip's responder reached 4px into its neighbour's painted
  pill. I had explicitly protected those dense rows from being visually
  inflated and then made them mis-tap instead. When you specify a dimension,
  specify what it must not collide with; a measurement given without its
  neighbours is half a spec.
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
- **A defect fixed at its known sites is not a defect fixed.** The
  whole-branch review found *three separate classes* we had already fixed on
  this branch still live elsewhere: `subtitleLines` applied at five clipping
  sites while six more in `more/index.tsx` still clip; `brand-ink` replacing
  `text-brand`-on-`bg-brand-soft` in `plus_gate.tsx` while two new files
  reintroduced the same failing pairing; `hitSlop` given to `Chip` while
  comparable wallet pills stayed under 44pt. Each fix was correct, tested,
  reviewed, and local. **When a review finds an instance, the deliverable is a
  sweep for the class, not a patch for the instance** — and the sweep's result
  belongs in the report as a count, so the next reader knows it happened.
- **Most errors on this branch were measuring a proxy instead of the thing.**
  It is worth stating as one rule because it looked like several different
  bugs. A test read the wrapper's className instead of the node that renders
  the glyphs. Another read text content instead of the `numberOfLines` that
  decides whether the text is visible. A plan counted "four" loading views by
  eye when there were 25. A brief said "at least 20 files" of pressable chips,
  derived from grepping files that *render* `<Chip` rather than files that pass
  `onPress` — there were 9. In each case the proxy correlated with the target
  closely enough to look right and diverged exactly where it mattered. Before
  trusting a number or an assertion, ask what it literally measures, and
  whether that is the thing you care about or merely something near it.
- **Disjoint files are not disjoint state.** Two concurrent implementers in
  one worktree share a single **git index**. Verifying their file sets do not
  overlap is necessary and not sufficient: one `git add -A` from either sweeps
  the other's half-written work into its commit. Every parallel dispatch must
  forbid `git add -A|-u|.` and `git commit -a`, and stage explicit paths only.
- **A count in a plan is a claim about the codebase, and it decays.** Task 5's
  plan said "the four `testID="*-loading"` blank views". There were **25**, four
  of them inside another agent's files. The plan's trailing "and any other
  `*-loading`" clause would have sent an agent searching straight into a
  concurrent edit. Enumerate the real set at dispatch time and hand over paths,
  never a search. This is the same failure as the comment-counts lesson above,
  one level up.

---

## 5. Owner device checklist (A54 — no subagent can do these)

Font weights render correctly — **confirmed by owner**. Still open:

- Card shadow and hairline, light vs dark.
- Red Transactions tab badge.
- Chip geometry in dense rows.
- **Adjacent-chip mis-tap.** Chips carry a `hitSlop` to reach the 44pt touch
  minimum their painted pill (~22px) does not meet. Rows are spaced `gap-2`
  (8px), so horizontal slop is capped at half the gap to stop neighbouring
  responders overlapping. Jest has no real hit-testing — it can pin the
  numbers and not the behaviour. **Tap along a dense filter row and confirm
  the chip you aimed at is the one that activates.** A very short label
  ("3x") stays under 44px wide by design: overlapping responders were judged
  the worse failure, because a missed tap is noticed and retried while a
  wrong-chip tap silently applies a value the user never chose.
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

**The design's notification action buttons cannot be built, and were not.**
The design draws four notification cards carrying five actions between them —
"See breakdown", "Mute 7 days", "Move ₱{amount}", "Not now", "Fix now". A
worktree-wide grep, TypeScript and native Android both, found **no
notification action infrastructure of any kind**: no `categoryIdentifier`, no
`setNotificationCategoryAsync`, no `actionIdentifier`, no response listeners —
not for these, not for any notification the app posts. Adding them would be
the rest-state-promise defect at OS level, where it is worse: a button in the
shade that does nothing is not recoverable by backing out of a screen.
Shipping title/body copy only. **Building these actions is real work — new
Expo notification categories plus a response handler — and belongs on the
roadmap, not in this revamp.**

Related: the design's fourth board, **Capture** (`₱285 tracked at Jollibee`),
**does not exist** — no builder, no notifier, no call site. Only Limit
warning, Payday, and Listener down are real, via `notifyLimitAlerts`,
`notifyPaydaySummary`, and `notifyTrackingInterrupted`. None of the three is
wired to a live production trigger yet; that gap predates this branch.

**The design's notification copy was written without checking the app's
existing copy rules — three of four strings in one table conflicted.** The
mockup is a visual artifact; its words are not automatically permissible here.

- `Kinsenas landed — ₱9,250` violates a documented, tested rule: generated
  sentences never use the cadence name. `components/income/income_summary_
  card.tsx:4-5` states it ("twice a month, around ₱18,500 each time" — not
  "kinsenas"; cadence names are internal vocabulary) and
  `income_screen.test.tsx:153` pins it, literally named *"the kinsenas
  sentence never says 'kinsenas'"*. The word is fine as a picker **label**
  (`cadence_picker.tsx:29`), never inside generated prose.
- `Notification access was revoked` is reserved in `health_card.tsx` for one
  specific sub-cause that the notifier cannot distinguish from the others.
  Asserting it unconditionally tells some users something false.
- `Tracking paused` collided with `listener_health.tsx`'s reserved use of
  "paused" for the user's own **voluntary** switch — the one case where
  nothing is wrong. Shipped as `Tracking stopped working` instead.

**Open, needs an owner decision:** the Limit warning board was left byte-for-
byte unchanged. Its current wording is the named canonical example in
`docs/12-encryption-and-app-lock.md` §7a, stated there as binding on every
notification-posting task. The design's `80% of your Food limit is gone` shape
needs a category name and a days-left figure that exist on `LimitAlert` but
are not threaded into `limitThresholdAlertCopy`'s params. Closing that gap
means either amending the binding doc or breaking the file's tested
"one alert kind, one wording" delegation. **That is a spec-precedence call,
not a copy edit.**

**Where copy lives:** `lib/alerts/alert_copy.ts` decides *what* an alert says.
`lib/alerts/alerts_service.ts` decides *whether, when, and on which channel* it
is delivered — it holds no board copy at all, only two Android channel display
names. The Part 3 plan gets this backwards; believe the files.
