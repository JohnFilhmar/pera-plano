# W1 — Known Follow-Ups After Merge

**Status:** Follow-up register · 2026-08-20 · branch `feat/w1-numeric-input`

Sixteen tasks, twenty-six commits, and eighteen reviews produced roughly fifty findings that were
deliberately not fixed on the branch. The whole-branch review triaged them; the must-fix ones were
fixed in the final wave. This file records what remains, so the reasoning does not die with the
scratch workspace.

Nothing here blocks the merge. It is ordered by what a maintainer would actually want to pick up
first.

---

## 1. Worth doing properly, and each closes a class

### 1.1 Brand `Centavos` and `PesoInput`

`types/domain.ts` has `type Centavos = number`; `lib/money/peso_input.ts` has `type PesoInput = string`.
Both document an intent the compiler cannot enforce — `openingBalanceText: String(wallet.balance)`
type-checks cleanly and is a 100× bug.

**Three such bugs were found on this branch, all by review rather than by the compiler:**
`allocation_sheet.tsx` (row seeding), `income_form.tsx` (`String(averageAmount)`), and
`correct_sheet.tsx` (`digitsFromCentavos` as `String(Math.trunc(amount))` — that one would have made
an *untouched* review sheet submit a fabricated 100× correction).

Branded types would have made all three compile errors. In an app whose entire subject is money,
that is worth the ceremony.

### 1.2 Split the keypad context

`useKeypad()` returns one object whose `useMemo` deps include the live `request`, which mutates on
every keystroke. So `FormScreen` — and therefore every child of every migrated form — re-renders on
each key press, not only when `keypadHeight` changes.

This wants a context split (focus state vs. published geometry), not a patch. It is a real
performance shape on heavy forms and was correctly out of scope for every individual task.

### 1.3 An `autoOpen` prop on `NumericField`

`app/transaction/new.tsx` opens the panel from a route effect, which forced the amount state to be
lifted out of `ManualEntryForm` and duplicated the field's identity strings across two files. An
`autoOpen` / `focusOnMount` prop would delete the route effect, the lifted state and the duplication
at once — and it is where the unmount cleanup would most naturally live.

Noted by Task 9's reviewer; out of scope then because it is Task 5's file.

### 1.4 Publish the panel's top edge, not a bare height

`keypadHeight` has three consumers and each corrects it differently: `bottom_sheet.tsx` uses
`max(insets.bottom, keypadHeight)`, `onboarding_frame.tsx` uses `keypadHeight - insets.bottom`, and
`form_screen.tsx` uses it raw.

Two of the three do the offset maths; the third assumes its viewport reaches the window bottom,
which is false on the two wallet routes (see spec §11.3) — it over-reserves by `insets.bottom`,
126 px on the A54. The error direction is safe, which is exactly why no device check catches it.

A single `keypadTop` in window coordinates, or a `useKeypadInset()` hook that measures the
consumer's own bottom, removes the assumption from every call site.

### 1.5 Make the host registry field-aware

"Highest live token wins" is the right default, but it re-parents the panel into *any* sheet that
mounts — including a category picker that has nothing to do with the focused field.

Recording which host was active at `open()` and closing rather than re-parenting when a higher host
appears matches the spec's own reasoning (§3.2: "a keypad that survives the disappearance of the
field it was editing has nowhere to commit to") applied in the other direction.

---

## 2. Small, specific, cheap

| Item | Where | Note |
|---|---|---|
| `disabled` does not close a panel already open on that field | `numeric_field.tsx` | Reachable: focus an allocation amount, then tap the row to "Skipped". Behaviour is unchanged from the `pointerEvents` wrappers it replaced, and the data consequence is nil — both call sites filter on the checked/included flag before committing. Cosmetic only. One line. |
| Stale comment | `quick_wallet_list.test.tsx:150-152` | Says "a NumericField has no such prop" — the final wave added it. The test still passes and still proves the right thing. |
| `LabelledNumber` clear → day 1 | `due_rule_picker.tsx:227` | Seeds `useState(value)` once and never resyncs. Hold-to-clear is now a single gesture: `""` → `clampDay("")` → `NaN` → silently returns day 1 while the field shows blank. **The only silent-wrong-data item in the register.** Mitigated by the visible due-preview dates. |
| Inert guard in the footer test | `income_step.test.tsx:177-197` | The safe-area mock returns all-zero insets with no provider, so the `- insets.bottom` assertions become `320 >= 320 && 320 <= 320` and cannot distinguish the subtraction from a bare height. The arithmetic is right; the test does not prove it. Fix shape: wrap in a real `SafeAreaProvider` with a non-zero bottom inset, as `components/__tests__/safe_area.test.tsx` already does. |
| Widen the numeric-keyboard guard | `no_numeric_keyboard.test.ts` | Currently misses `inputMode="tel"` (RN maps it to a phone pad), `keyboardType="phone-pad"`, and brace form (`inputMode={"numeric"}`). |
| `readAmount` admits non-integer centavos | `correct_sheet.tsx:107-110` | `amount: 1250.5` seeds `"12.50"` → 1250 ≠ proposed, so an untouched sheet reports a correction. Pre-existing. `Number.isInteger` at the payload boundary is the honest fix. |
| Tier-coupled assertion | `reports_screen.test.tsx:164` | `toHaveLength(2)` counts the horizontal month strip, which only renders on the plus tier. When `MVP_TIER` flips — documented as a one-constant change — it fails as "Expected 2, received 1" while its comment points at nesting. Tier-independent form: filter on `props.horizontal !== true`. |
| `pesoInputFrom` drops the sign | `peso_input.ts:93-98` | `Math.abs`. No current call site can pass a negative, but a negative wallet balance seeded into a field would display positive. Preserve the sign or document the precondition. |
| Focus ring reflows | `numeric_field.tsx:73-75` | Adds `border` to an unbordered box, so the field grows 2 px and its text shifts 1 px on focus. Use a transparent 1 px border unfocused, or a ring. |
| `DateField` shows the raw ISO string | `date_field.tsx:68` | Spec §7 says a *formatted* date. The typing problem is solved; the reading one is not. `lib/dates.ts` has no display formatter, which is probably why it was skipped. |
| No exit animation | `keypad_host.tsx:105` | Returns `null` the instant `visible` flips, so the `toValue: 0` timing animates an unmounted tree. Enter fades and rises; exit is a hard cut. |
| `flex-1` doc-rot | `form_screen.tsx:26-32` | Header says "every migrated form still wants `flex-1`"; only `loan_form.tsx` carries it. Harmless either way — reconcile the comment now the branch is whole. |
| Missing `beforeEach` resets | several test files | `mockPickedDate`, `mockReceivedMinimumDate`. Order-dependent by construction; every affected suite currently passes. |

---

## 3. Not W1's, but found while doing it

### 3.1 ESLint cannot run in this repo at all

ESLint 9 is installed with no `eslint.config.js`, so `npx eslint` fails immediately. **No lint gate
ran on any of this branch's twenty-six commits**, and none has run on anything else either.
Pre-existing; nothing here caused it or fixed it.

### 3.2 The test suite is load-flaky

Three suites — `setup_flow_e2e`, `bills_screen`, `home_screen` — have each timed out under parallel
load and passed in isolation. The full run takes ~26 minutes at `maxWorkers: 60%` with a 30 s
per-test timeout; the same two suites take 40 s and 26 s alone but 148 s and 101 s in parallel.

The branch ends at 2 failing suites against a **baseline of 5** before it started, while adding 72
tests — so W1 improved the number. But every review on this branch had to spend an isolation run
proving a parallel failure was not a regression. Raising `testTimeout` or lowering `maxWorkers`
would pay for itself.

### 3.3 Three screens have no reachable navigation path

`/wallet/new`, `/plan/income` and `/transaction/new` cannot be reached by tapping anything in the
shipped app once past first-run. The on-device checklist reaches them by `adb` deep link because
there was no button to describe.

Unrelated to W1 — found only because the checklist had to explain how to get to each screen.

---

## 4. Deliberately not built, and recorded in the spec

Three spec deliverables were not implemented. They are marked in
`docs/superpowers/specs/2026-08-19-numeric-input-system-design.md` §11 rather than left silently
absent:

- **§11.1** — two of §4.2's six close triggers (focus a `TextInput`, scroll the form). Reachable
  today in manual entry: tapping the merchant field raises the OS keyboard *over* the still-open
  panel.
- **§11.2** — §6's "scroll the focused field into view". `FormScreen` only pads. The onboarding
  income amount sits below a four-row cadence picker and can scroll out of sight on the tap that
  focuses it.
- **§11.3** — `FormScreen`'s window-bottom assumption, see §1.4 above.
