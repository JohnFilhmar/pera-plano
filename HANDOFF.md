# Handoff — 2026-08-18

For whoever picks this up next. Written at the end of a session that landed 26 commits
across two plans. Read the **Traps** section before you touch anything; most of it cost
real rework to learn.

---

## What this project is

PeraPlano — a local-first Philippine personal-finance Android app. It reads bank and
e-wallet **notifications** on-device and turns them into ledger entries, so the user never
types a transaction. The privacy story is the product: no bank passwords, no account
linking, nothing leaves the phone.

Stack: Expo SDK 54 · expo-router ~6 · React Native 0.81.5 · NativeWind 4 · TypeScript
strict · op-sqlite with **SQLCipher** · jest + jest-expo + @testing-library/react-native.

Working directory for all `npx` commands is `mobile/`.

---

## State as of this handoff

Branch `feat/mvp-implementation`, pushed and in sync with `origin`. Suite is
**3313/3315**, `tsc --noEmit` clean. The 2 failures are a known flaky pair — see Traps.

Two plans completed today, both reviewed to clean:

| Plan | Commits | What |
|---|---|---|
| `docs/superpowers/plans/2026-08-18-brand-assets-and-onboarding-art-placeholders.md` | 7 | Brand SVGs relocated to `assets/brand/`; `BrandMark`, `ImagePlaceholder`; onboarding value carousel; three SMIL animations re-authored in Reanimated |
| `docs/superpowers/plans/2026-08-18-device-testing-issue-fixes.md` | 18 | Eight bugs found on a physical Samsung A54, seven fixed |

Plus one design doc, **unreviewed and not scheduled**:
`docs/superpowers/specs/2026-08-18-on-device-ai-assistant-design.md` — an optional
downloadable on-device AI assistant. Explanatory only, never prescriptive, so it stays
inside the product brief's "not a financial advisor" non-goal. Nothing is built from it.
It recommends decomposing into three implementation plans and running a spike first.

---

## Do this first: the on-device gates

**A physical Samsung A54 5G is the only test device.** Nine things cannot be settled by
CI and are waiting on it. Ordered by consequence.

1. **Onboarding carousel gesture.** `components/onboarding/value_carousel.tsx` nests a
   horizontal `ScrollView` inside `OnboardingFrame`'s vertical one, relying on
   `nestedScrollEnabled`. If the gesture is swallowed, **every first-run user** gets one
   frozen panel and a dot row that never advances. Visibly broken, uncatchable by any test.
2. **Review-queue save** — the original P0. Catch a real notification, open the correction
   sheet, confirm Save enables and actually writes a transaction.
3. **"Save wallet"** on `app/wallet/[id]/edit.tsx` — the button that was under the nav bar.
   Check the top edge too.
4. **The 8(b) clipping, still live.** See "The clipping mystery" below — capture the
   device's Font size and Display size settings **before** changing any code.
5. **Four buttons in one row** on `app/wallet/[id].tsx` for a non-cash wallet with a
   dismissible drift (Edit / Adjust balance / Dismiss / Archive).
6. **`ImagePlaceholder` overflow** — a long art brief must grow the box, not clip. Jest runs
   no Yoga layout pass, so the test can only assert the *absence* of a fixed height.
7. **Reanimated motion fidelity** — the suite proves keyframe transcription, reduced-motion
   degrade and teardown. It cannot prove the motion looks like the designer's.
8. **The wing flap** specifically — the only non-uniform transform in the port.
9. **Contrast eyeball** for the new `on-brand` token in dark mode.

The pre-existing encryption ship gates in
`docs/superpowers/plans/2026-08-07-encryption-foundation.md` Task 11 are separate and still
open — two of them fix parameters that cannot change once a real user holds a recovery
phrase.

---

## Traps

**`formatPhp` does not exist.** Four older plans (`m3`, `m3-part2`, `m3b`, `m3c`) cite it
in their Global Constraints. The only money formatter is **`formatCentavos`** in
`components/ui/amount_text.tsx:46`. This wasted time today; don't inherit it.

**`[id]` is a directory *and* `[id].tsx` is a file.** Under `app/wallet/` both exist, and
expo-router makes `[id]/edit.tsx` a real route. A file list built from `ls` missed the
screen a bug report was actually about. **Enumerate routes, not files**, when scoping a
screen bug.

**Stale header comments block merges here.** This codebase leans hard on headers that
explain *why* a decision was made and what breaks if reversed. Two merges were blocked
today for headers describing behaviour the code no longer had — once in
`assets/brand/README.md`, once in `app/wallet/[id].tsx`. If you change behaviour, the
propagation list is **every artifact that asserts the old behaviour**, not just the ones a
reviewer will read.

**`mobile/app/__tests__/bills_screen.test.tsx` and `home_screen.test.tsx` flake.** Eight occurrences in one
session: they time out on a full run and pass 29/29 in isolation, always the same two
files, never files anyone touched. Different signature from the Windows jest
transform-cache `EPERM` race (also real). **This deserves its own task** — its actual cost
is that it trains everyone to reflexively re-run, which is how a genuine failure eventually
gets waved through.

**Other known-not-yours noise:** a `console.warn` from `lib/events/app_events.ts:142`
(commit `e4c4034`); 4 `act()` warnings in `mobile/app/__tests__/goal_routes.test.tsx`; 2 in
`mobile/app/(onboarding)/__tests__/first_run_handoff.test.tsx` (documented, an attempted fix was reverted rather than ship
dead code).

---

## Invariants — do not "fix" these

**`wallets.balance` is never written outside creation.** `createWallet` writes it at INSERT
as the wallet's anchor; `updateWallet` refuses to patch it. Balance is the ledger's running
total, moved only by a transaction that explains the move. A back door creates "a number no
transaction accounts for" (`components/wallets/wallet_form.tsx:10-14`). Post-creation
corrections go through a **ledger write** — see `hooks/mutations/use_correct_wallet_balance.ts`.

**`CashReconcileSheet` is cash-only, deliberately.** A bank wallet re-anchors from the
provider's own reported balance-after, so a typed adjustment there "would fight the next
snap." Non-cash wallets use the separate `BalanceCorrectionSheet`, which discloses on screen
that a later notification will overwrite the correction. **Credit wallets get neither** — a
credit balance is the amount *owed*, so "you have more than recorded" would have written
`direction: "in"` and recorded debt as income.

**Review-queue items are not Transactions.** The queue is the ingest pipeline's pressure
valve. Never commit a queue item into the ledger to make two numbers agree.

**`react-native-svg` does not implement SMIL.** An animated SVG imported through
`react-native-svg-transformer` renders its **first frame, silently, with no error or
warning**. This is why the brand motion is re-authored in Reanimated rather than imported —
see `assets/brand/README.md`, and `components/ui/brand_mark_motion.ts` for the transcribed
keyframes. **Those three SVGs are now specifications for that file, and its tests assert
their numbers as literals — edit an SVG and CI stays green on the stale transcription.**

**Safe-area house pattern:** insets go on a **padding-free outer `View`** wrapping a bare
`ScrollView`, never on the `ScrollView`'s `style`. A `style` prop replaces the style
NativeWind compiles from `className`, so insets on an element with padding classes silently
drop that padding. Canonical examples: `app/review/index.tsx:181-183` and
`components/onboarding/onboarding_frame.tsx`. Verified exhaustive across `mobile/app/` as of
today — no screen applies insets to a `ScrollView`'s `style`.

---

## The clipping mystery (unsolved, real)

The owner's screenshot shows the Home empty-state button reading **"Add"** where the source
says `"Add manually"`, and a section header reading **"Your"** where the source says
`"Your limits"`. Both truncate at the first word.

**Two hypotheses are dead.** "Text without a flex guard inside `flex-row`" is falsified by
`components/limits/limit_card.tsx:70-71`, which uses the *identical* row shape and rendered
"Monthly limit" — thirteen characters — in full in the same screenshot. "Synthetic bold from
a single-face Inter" dies for the same reason: both are `font-semibold`.

**What correlates:** the two clipped strings are `text-base` (16px) in a row; the unclipped
one in the identical row shape is 14px; an 18px string in a *column* wrapped fine. That
points at **system font scaling**, which would also explain why no simulator reproduces it.

Confirmed via `git log -S` that neither string was ever shorter, so it is not a stale build.

**Do not apply `flex-1`.** It sets `flexBasis: 0%` and would collapse the button to its
padding inside `components/ui/empty_state.tsx:32`'s shrink-to-fit `items-center` column;
`flexShrink: 1` is inert there. Start by capturing the device's font-scale and display-size
settings. Full write-up in
`.superpowers/sdd/2026-08-18-device-testing-issue-fixes/batch-d-report.md`.

---

## Deferred work

Roughly 20 minors are logged across the two SDD ledgers (see below). The ones worth doing
first:

- **`components/lock/unlock_prompt.tsx` header** — says "first mount" without saying a re-lock
  *is* a new mount. The biometric prompt now fires on every return-from-background re-lock,
  which is the path users hit most, and it is both undocumented and untested.
- **`LOOP_HEADING_OFFSET = 42`** in `components/ui/brand_mark.tsx` has no test, and it is
  derived from the *static* mark's path geometry — redraw the artwork and it silently becomes
  wrong with nothing failing.
- **~20 sites use `text-surface` as a foreground** on filled controls, the pattern the new
  `on-brand` token replaced. All are value-identical today so nothing renders differently,
  but `components/lock/` is now half-migrated. Full inventory with fill-type per site is in
  `batch-d-report.md`. Settle the token's name before the sweep — `on-brand` also carries
  `danger` fills, and `on-fill` would age better.
- **The flaky pair**, above.

---

## Where the durable record is

- `docs/superpowers/plans/` and `docs/superpowers/specs/` — committed, the real record.
- `.superpowers/sdd/<plan-name>/progress.md` — **gitignored scratch.** Two ledgers there hold
  every controller ruling with its reasoning and stated cost-if-wrong, all deferred minors,
  and per-batch reports with TDD evidence. They will not survive a `git clean -fdx`. If any
  of it matters to you, move it before then.
- Commit messages in this repo are unusually detailed and are a genuine source of truth.

---

## A note on method

Four confident diagnoses failed on contact this session: a function that never existed, a
file list that missed the reported screen, a clipping hypothesis falsified by the owner's own
screenshot, and a misquoted code comment. **Every one was caught before it shipped, because
the brief handed to the implementer said explicitly that the claim was a hypothesis to verify
rather than a fact to act on.**

Two of the best fixes in these 26 commits exist only because an implementer read the code and
pushed back instead of complying. If you delegate here, say plainly which parts of your
instruction you have verified and which you have not.
