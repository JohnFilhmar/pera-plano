# Device-Testing Issue Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Source:** eight screenshots from a real Samsung A54 session on 2026-08-18
(`D:\Downloads\pera-plano-issues\`). Every issue below was reproduced in the code before being
written down; the root cause and the file:line are named for each. Two are **P0 — they break the
product's core promise on a real device**.

**Goal:** make the app usable end-to-end on a phone. Today a user who receives a real notification
can watch PeraPlano catch it and then *cannot save it*, and a user who opens a wallet cannot reach
the Save button. Everything else here is real but survivable.

**Tech Stack:** TypeScript ~5.9 strict · expo-router ~6 · React Native 0.81.5 · NativeWind 4 ·
react-native-safe-area-context · jest + jest-expo + @testing-library/react-native.

## Verified findings

| # | Symptom (screenshot) | Root cause | Where | Priority |
|---|---|---|---|---|
| 1 | Lock screen needs a manual "Unlock" tap | **Deliberate**, to stop a cancelled prompt looping | `components/lock/unlock_prompt.tsx:6-9` | P2 |
| 2 | "Nothing tracked yet" under "1 item needs a second look" | Ledger genuinely empty; queue items aren't Transactions. Copy contradicts the banner above it | `components/transactions/ledger_list.tsx:64,65,245` | P2 |
| 3 | Review-queue **Save never enables** | `canSave` needs a wallet; wallet rows sit below a `max-h-96` scroll fold with no affordance and no stated reason | `components/review/correct_sheet.tsx` | **P0** |
| 4 | Income field takes raw centavos (`1750000` → ₱17,500.00) | `centavosFromDigits(digits)` behind a placeholder reading "e.g. 18500", which actually yields ₱185.00 | `components/onboarding/income_quick_form.tsx` | P1 |
| 5 | Three identical "+ Bank SMS" chips | Chips are built **per package**; `sms_relay` has 3 `packageNames` in `seed.json` | `app/(onboarding)/wallets.tsx:~366` | P1 |
| 6 | Wallets stuck at ₱0.00, no way to set a balance | `showOpeningBalance` is passed by `app/wallet/new.tsx:110` **only**; reconcile is cash-only by design | `components/wallets/wallet_form.tsx:53,66,145` | P1 |
| 7 | "Save wallet" sits **under** the Android nav bar | Insets applied to a `ScrollView`'s `style` instead of `contentContainerStyle` | `app/wallet/[id].tsx:119-122`, `app/wallet/new.tsx:98-101` | **P0** |
| 8 | "Add" button text colour; "Add manually"→"Add", "Your limits"→"Your" | `VARIANT_FG.primary` uses `surface`, a **background** token, as a foreground; plus `Text` with no flex guard inside `flex-row` | `components/ui/button.tsx:64-69,113`, `components/ui/section_header.tsx:21` | P2 |

### What is NOT broken, and must not be "fixed"

- **Reconcile being cash-only is correct.** `cash_reconcile_sheet.tsx:16-19` explains it: a bank
  wallet re-anchors from the provider's reported balance-after, so a typed adjustment there
  "would fight the next snap and lose, leaving a transaction explaining a balance change that
  never happened." Task 4 below must not extend reconcile to bank wallets.
- **`balance` has no setter on purpose.** `wallet_form.tsx:11-13`: balance is the ledger's running
  total, moved only by the ledger. Task 4 adds an *opening balance* and an *adjustment entry* —
  both of which are ledger writes. **No task in this plan may write `wallets.balance` directly.**
- **The review queue not counting toward the ledger is correct.** Issue 2 is a copy defect, not a
  data defect. Do not commit queue items into the ledger to make a number agree.

## Global Constraints

- **Naming:** snake_case files/dirs; `camelCase` values, `PascalCase` components/types,
  `SCREAMING_SNAKE_CASE` constants.
- **Currency:** integer **centavos** everywhere. Format only via `formatCentavos` (components/ui/amount_text.tsx) / `AmountText` — NOTE: four older plans say `formatPhp`, which has never existed.
- **Commits:** Conventional Commits. **No AI-attribution trailer or footer of any kind.**
- **TDD:** named failing test → run it and watch it fail → minimal implementation → green → commit.
- **Test commands:** all `npx jest --ci`; one file `npx jest --ci <path>`; typecheck `npx tsc --noEmit`.
- **Working directory:** `mobile/`.
- **Dark mode is not optional.** Every colour `className` ships a `dark:` counterpart.
- **Palette tokens only, never raw hex.**
- **No new dependencies.**
- **Known pre-existing noise, not yours:** `lib/events/__tests__/app_events.test.ts` emits a
  `console.warn` from `lib/events/app_events.ts:142` (commit `e4c4034`). Leave it.
- **Windows flake:** a jest-transform-cache `EPERM` race under parallel workers has produced
  spurious failures that clear on re-run. If failures carry that signature in files you did not
  touch, re-run before concluding you broke something, and report both runs.

---

### Task 1 (P0): Make the review-queue correction savable

**Files:**
- Modify: `mobile/components/review/correct_sheet.tsx`
- Test: `mobile/components/review/__tests__/correct_sheet.test.tsx` (extend)

**The defect:** `canSave = amount > 0 && walletId !== null`. The wallet rows render inside a
`<ScrollView className="max-h-96">` after the numpad and the direction buttons, so on a 1080×2340
phone they are **below the fold**. The user sees a greyed Save, no wallet selection, and no
explanation. This is the single worst bug in the set: the app catches a real notification and then
refuses to record it.

**Rules:**
1. **Say why Save is disabled.** Render a short line above the button naming the missing field —
   "Pick a wallet to save" / "Enter an amount to save". A disabled control with no stated reason is
   the actual failure here; the scroll fold merely hid the cause.
2. **Default the wallet when the choice is unambiguous.** If `wallets.length === 1`, preselect it.
   Do NOT preselect when there are several — guessing which wallet a transaction belongs to is the
   decision this sheet exists to ask about.
3. **Get the wallet picker above the fold, or make the fold obvious.** Two acceptable fixes: move
   the wallet block directly under the numpad (ahead of direction), or drop the fixed `max-h-96`
   for a height that adapts to the sheet. Pick one, and state in the file header which and why.
   A scroll indicator alone is not sufficient — the user in the report never discovered it.
4. **Handle the genuinely-empty case.** If `wallets.length === 0`, the sheet must say so and offer
   nothing to press, rather than rendering a bare "WALLET" label over dead space.
5. Do not change `CorrectionPatch`, `onSubmit`'s diff semantics, or the rule-checkbox behaviour.
   The header's "IT REPORTS A DIFF, NOT A FORM" contract is intact and load-bearing.

**Tests (names are requirements):**
- `explains why save is disabled when no wallet is chosen`
- `explains why save is disabled when the amount is zero`
- `preselects the only wallet when there is exactly one`
- `does not preselect a wallet when there are several`
- `tells the user when there are no wallets at all`
- `still reports only the changed fields` (regression on rule 5)

---

### Task 2 (P0): Free the wallet screens from the system bars

**Files:**
- Modify: `mobile/app/wallet/[id].tsx` (lines 119-122)
- Modify: `mobile/app/wallet/new.tsx` (lines 98-101)
- Test: `mobile/app/__tests__/wallet_routes.test.tsx` (extend)

**The defect:** both screens put safe-area insets on a `ScrollView`'s **`style`** prop. On a
`ScrollView`, `style` is the outer frame — it does not pad the scrolling content, so the header
renders under the status bar and "Save wallet" renders under Android's ▢ ◁ ◁ strip. `app.json`
sets `edgeToEdgeEnabled`, so there is nothing else clearing the bars.

**Rules:**
1. Move the insets to **`contentContainerStyle`**. That is the prop that pads scrolling content.
2. **This exact bug was already fixed once**, in `components/onboarding/onboarding_frame.tsx` —
   read its header comment before editing. It solved the same problem a different way (insets on a
   padding-free outer `View` wrapping the ScrollView) because *"a `style` prop wins over the style
   NativeWind compiles from `className`"*. Either shape is acceptable here; match one of them
   deliberately and say which in a comment, so the third screen that hits this has a precedent
   rather than a third invention.
3. `app/review/index.tsx:~200` also gets this right (insets on an outer `View`). Between it and
   `onboarding_frame.tsx` the house pattern already exists — do not invent a fourth.
4. Verify **both** edges: the top header and the bottom Save button.

**Tests (names are requirements):**
- `wallet detail pads its content for both system bars`
- `wallet new pads its content for both system bars`

**⚠️ ON-DEVICE GATE:** Jest cannot prove a button is physically above the nav bar. These tests
assert the inset values reach the right prop; the actual clearance is an A54 screenshot check.

---

### Task 3 (P1): One chip per provider, not one per package

**Files:**
- Modify: `mobile/app/(onboarding)/wallets.tsx`
- Test: `mobile/components/onboarding/__tests__/providers_step.test.tsx` (extend) or a new
  `mobile/app/(onboarding)/__tests__/wallets_step.test.tsx`

**The defect:** the "Also have one of these?" row does `addable.map(choice => ...)` keyed on
`choice.packageName`. `ProviderChoice` is per-package, and `assets/parser_rules/seed.json` gives
`sms_relay` three packages — `com.google.android.apps.messaging`, `com.samsung.android.messaging`,
`com.android.mms`. Result: three identical "+ Bank SMS" chips, of which two are noise.

**Rules:**
1. **Deduplicate by provider, not by package.** One chip per distinct provider label. Adding it
   should attach **every** package that provider owns as a matcher, not just one — otherwise a user
   whose bank texts arrive via `com.android.mms` silently catches nothing.
   `lib/wallets/matchers.ts:64` already maps a provider to all its packages; reuse that rather than
   re-deriving.
2. **`app/(onboarding)/wallets.tsx` carries its own private copy of `PROVIDER_LABELS`** (around
   line 100), duplicating `constants/providers.ts`. Delete the local copy and import the shared
   one. Two label tables is how "GCash" becomes "Gcash" on one screen — which is the exact failure
   `constants/providers.ts`'s own header says it exists to prevent.
3. Do not change the seed ruleset. Three packages for `sms_relay` is correct data; the presentation
   was wrong.

**Tests (names are requirements):**
- `offers one chip per provider even when a provider has several packages`
- `adding a multi-package provider attaches all of its packages as matchers`
- `uses the shared provider labels`

---

### Task 4 (P1): Let people tell PeraPlano what they already have

**Files:**
- Modify: `mobile/components/onboarding/quick_wallet_list.tsx`
- Modify: `mobile/app/(onboarding)/wallets.tsx` (pass the balance through on create)
- Modify: `mobile/app/wallet/[id].tsx` (offer an adjustment for non-cash wallets)
- Test: `mobile/components/onboarding/__tests__/quick_wallet_list.test.tsx` (extend)
- Test: `mobile/app/__tests__/wallet_detail.test.tsx` (extend)

**The defect:** every wallet starts at ₱0.00 and can only move when a notification arrives. There
is no way to say "my GCash already has ₱3,000 in it". `wallet_form.tsx` *has* an `openingBalance`
field but `showOpeningBalance` defaults to `false` and only `app/wallet/new.tsx:110` passes it —
so the onboarding wallet step never offers it. After creation, only **cash** wallets can be
corrected, via `CashReconcileSheet`.

**Rules:**
1. **Add an opening-balance field to the onboarding wallet step**, optional, defaulting to empty.
   A blank field must mean ₱0.00 and must not block Continue — onboarding stays skippable.
2. **Offer a balance adjustment on non-cash wallet detail.** Reuse the *shape* of
   `CashReconcileSheet`: ask what the balance actually is, write the **difference** as a ledger
   entry. **Never write `wallets.balance` directly** — `wallet_form.tsx:11-13` is explicit that
   balance is the ledger's running total and a back door creates "a number no transaction accounts
   for".
3. **`CashReconcileSheet` itself stays cash-only and unmodified.** Its header (lines 16-19) gives
   the reason: a bank wallet re-anchors from the provider's reported balance-after, so a typed
   adjustment fights the next snap and loses. The new non-cash path must therefore be labelled as
   a *starting balance / manual correction*, and must state on screen that an incoming notification
   with a reported balance will win over it. If that conflict cannot be resolved cleanly, report
   `DONE_WITH_CONCERNS` and say so — do not paper over it.
4. Opening balance is entered in the same units and with the same widget as the rest of the app —
   see Task 5, and land Task 5 first if the two collide.

**Tests (names are requirements):**
- `onboarding offers an optional opening balance per wallet`
- `a blank opening balance creates the wallet at zero and does not block continue`
- `a non-cash wallet offers a balance adjustment`
- `the adjustment writes a ledger entry rather than setting the balance directly`
- `cash wallets still use the reconcile sheet` (regression on rule 3)

---

### Task 5 (P1): Make money input mean what it says

**Files:**
- Modify: `mobile/components/onboarding/income_quick_form.tsx`
- Test: `mobile/components/onboarding/__tests__/income_quick_form.test.tsx` (extend)

**The defect:** the field is a bare `TextInput` whose digits go through `centavosFromDigits`, so
typing is in **centavos** — but the placeholder reads `"Amount, e.g. 18500"`, which produces
**₱185.00**. The reporter typed `1750000` to reach ₱17,500.00. The placeholder is not merely
unhelpful, it is wrong.

**Rules:**
1. Pick one and make the whole field consistent: either accept **pesos with a decimal**, or keep
   centavos-by-digits and make the widget say so the way the rest of the app does. The review
   queue's `AmountNumpad` already solves this — it renders `₱200.00` while the user types digits.
   **Prefer reusing `AmountNumpad`**: a second money-entry idiom in the same app is how one screen
   ends up 100× off.
2. **The placeholder must not contradict the behaviour.** If a user types the placeholder's own
   example verbatim they must get the amount it implies.
3. The live preview under the field stays — it is the thing that let the reporter notice at all.
4. Check for the same pattern elsewhere before finishing: any other bare `TextInput` feeding
   `centavosFromDigits` with a peso-looking placeholder has the same defect. Report what you find;
   fix only what is in this task's files, and list the rest for the controller.

**Tests (names are requirements):**
- `typing the placeholder's own example produces the amount it implies`
- `the preview matches the committed value`

---

### Task 6 (P2): Prompt for biometrics on open, once

**Files:**
- Modify: `mobile/components/lock/unlock_prompt.tsx`
- Test: `mobile/components/lock/__tests__/unlock_prompt.test.tsx` (extend or create)

**The current behaviour is deliberate.** `unlock_prompt.tsx:6-9`: *"Requires an explicit tap rather
than auto-firing the system prompt on mount — this is also what makes 'NotAuthenticated →
re-prompt and retry' (task-9-brief rule 3) a plain, non-looping user action instead of an automatic
retry that could spin forever on a cancelled prompt."*

That reasoning is sound and the fix must not discard it.

**Rules:**
1. **Auto-fire the system prompt exactly once, on first mount.** Not on re-render, not after a
   cancellation, not after an error.
2. **After any failure or cancellation, fall back to today's manual button** — that is the
   anti-loop guarantee, and it stays.
3. Update the file header: the existing comment will otherwise describe behaviour the file no
   longer has. State the new rule and keep the anti-loop reasoning, since it still explains the
   fallback.
4. The screen must remain usable if biometrics are unavailable or the prompt never resolves.

**Tests (names are requirements):**
- `fires the system prompt once on mount`
- `does not re-fire on re-render`
- `does not re-fire after a cancelled prompt`
- `leaves the manual unlock button usable after a failure`

---

### Task 7 (P2): Stop the ledger contradicting the banner above it

**Files:**
- Modify: `mobile/components/transactions/ledger_list.tsx`
- Modify: `mobile/components/ui/empty_states.tsx` (the `transactions` catalogue entry)
- Test: `mobile/components/transactions/__tests__/ledger_list.test.tsx` (extend)

**The defect:** the screen renders "Needs your review — 1 item needs a second look" and, directly
beneath it, "Nothing tracked yet / Your transactions will appear here automatically." Both are
true — queue items are not Transactions — but together they read as a broken app.

**Rules:**
1. When the ledger is empty **and** the review queue is not, the empty state must acknowledge the
   waiting items and point at them. When both are empty, today's copy is correct and stays.
2. **Do not commit queue items into the ledger** to make the two agree. The queue is the pipeline's
   pressure valve (`app/review/index.tsx` header) and an unreviewed capture is not a transaction.
3. `empty_states.tsx` transcribes this copy for an audit test (its own header explains why). If you
   change the copy, update the mirror in the same commit or the catalogue test will drift.

**Tests (names are requirements):**
- `points at the review queue when the ledger is empty but items are waiting`
- `keeps the plain empty copy when nothing is waiting either`

---

### Task 8 (P2): Fix the button foreground token and the clipped labels

**Files:**
- Modify: `mobile/constants/colors.ts`
- Modify: `mobile/components/ui/button.tsx`
- Modify: `mobile/components/ui/section_header.tsx`
- Test: `mobile/components/ui/__tests__/primitives.test.tsx` (extend)

**Two defects, reported together.**

**(a) The colour.** `VARIANT_FG.primary = "text-surface dark:text-surface-dark"`. `surface` is a
**background** token (`#FFFFFF` / `#111A16`). In dark mode this paints near-black text on bright
`brand-dark` green. It is being used as "the colour that sits on a brand fill", which is a
different idea that has no token.

**(b) The clipping — LEADING HYPOTHESIS, CONFIRM BEFORE FIXING.** "Add manually" renders as "Add"
(`empty_states.tsx` catalogue vs the screenshot) and `SectionHeader title="Your limits"`
(`components/home/limit_progress_list.tsx:36`) renders as "Your". Both truncate at the first word.
Both live in a `flex-row` with no flex guard on the `Text` — `button.tsx:113` and
`section_header.tsx:21`. That is a known React Native measurement behaviour, but **I could not
confirm it from static reading alone.**

**Rules:**
1. **Add an explicit on-brand foreground token** (e.g. `on-brand` / `on-brand-dark`) rather than
   widening `surface`'s meaning. `colors.ts` already keeps a strict comment discipline about which
   tokens carry meaning — read the chart-ramp block for the standard, and document the new token
   the same way.
2. Repoint `VARIANT_FG.primary` and `.destructive` at it. **Then check every other place that uses
   `text-surface` as a foreground on a filled control** — `unlock_prompt.tsx`, `correct_sheet.tsx`'s
   direction buttons, and `income_quick_form.tsx`'s wallet chips all do. Fix them in this task and
   list any you find beyond those three.
3. **Confirm defect (b) before changing anything for it.** If a `flex-1`/`shrink` guard is the fix,
   apply it to both files. **If reproduction shows a different cause, report that instead and fix
   the real one** — do not apply a speculative flex fix and claim the symptom is gone.
4. Contrast: whatever the new token is, state the contrast ratio against `brand` and `brand-dark`
   in the comment. "Looks fine" is not a reason.

**Tests (names are requirements):**
- `the primary button uses the on-brand foreground, not a surface token`
- `a multi-word button label renders in full`
- `a multi-word section title renders in full`

**⚠️ ON-DEVICE GATE:** contrast and text clipping are both eyeball checks on the A54. The tests
above pin the token choice and the rendered string; they cannot prove legibility.

---

## Suggested order

`1 → 2` (both P0, both block real use) → `5` (lands before 4, which depends on the money widget)
→ `3 → 4` → `7 → 6 → 8`.

Tasks 1, 2, 3, 5, 6, 7 are independent of each other. Task 4 depends on Task 5's decision about
the money-entry widget. Task 8 touches `colors.ts` and `button.tsx`, which almost every other task
renders — land it last to avoid churning their diffs.
