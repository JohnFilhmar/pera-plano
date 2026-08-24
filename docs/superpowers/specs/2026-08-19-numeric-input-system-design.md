# W1 — Numeric Input System — Design Spec

**Status:** Design spec v1 · 2026-08-19 · **not an implementation plan.**

**Context:** `docs/superpowers/specs/2026-08-19-device-issues-triage-and-roadmap.md` — this is
workstream **W1**, and it closes §1.1, §1.2, §1.7, §1.8 and §1.9 of that document.

**Goal:** Every number a user types in PeraPlano is entered on a keypad the app owns, in the units a
person actually thinks in. Typing `1000` means one thousand pesos. Typing `1000.50` means one
thousand pesos and fifty centavos. A field that accepts only numbers never summons the Android
keyboard; a field that accepts letters always does. Nothing the user is typing into ever hides
behind the thing they are typing with.

**Architecture:** One pure module (`lib/money/peso_input.ts`) owns the keystroke-to-centavos
mapping and is the only place that arithmetic lives. One presentational grid
(`components/ui/numeric_keypad.tsx`) draws the keys. One context plus a re-registerable host
(`contexts/keypad_context.tsx`, `components/ui/keypad_host.tsx`) makes the grid a panel that slides
over whichever native window is on top. One field component (`components/ui/numeric_field.tsx`) is a
`Pressable`, never a `TextInput`, which is what makes "the OS keyboard cannot appear here" a
structural property rather than a prop that someone forgets to pass. A sibling
(`components/ui/date_field.tsx`) does the same job for dates against the platform date dialog.

**New dependencies:** `@react-native-community/datetimepicker` (Expo SDK 54 supported). Native
module — **requires a dev-client rebuild**, not just a JS reload. `react-native-reanimated` and
`react-native-keyboard-controller` are already installed and already mounted.

---

## Global Constraints

1. **Integer centavos remain the only money representation in state, props and storage.** This spec
   changes how keystrokes *map* to centavos. It does not introduce a float anywhere, and
   `formatCentavos` in `components/ui/amount_text.tsx` is not modified.
2. **No `TextInput` may carry `keyboardType="numeric"` or `"number-pad"` when W1 is done.** That is
   the acceptance test for "the OS keypad never appears on a number field" — a grep, not a
   judgement call.
3. **Alphanumeric fields are untouched.** Wallet names, notes, merchant, the recovery phrase and the
   report filename keep the system keyboard. W1 adds keyboard *avoidance* to their screens and
   changes nothing else about them.
4. **One shared test helper, written before the first migration.** See §7.2.
5. **No scrim behind the keypad.** See §4.3.

---

## 1. `lib/money/peso_input.ts` — the only place the mapping lives

A pure module. No React, no imports from the app. It is where W1's correctness lives and where
almost all of W1's tests point.

### 1.1 The state is the string the user typed

```ts
/** Exactly what the user has keyed, e.g. "", "0", "1000", "1000.", "1000.5", "1000.50". */
export type PesoInput = string;
```

Holding the raw string rather than a number is what lets `"1000."` exist. That intermediate state is
not a rounding artefact to be normalised away — it is a real thing the user is looking at
immediately after pressing the decimal key, and a model that cannot represent it will either
swallow the keystroke or jump the caret.

### 1.2 The keystroke rules

`appendKey(text, key)` where `key` is `"0"`–`"9"` or `"."`. Every rule below returns `text`
unchanged when it refuses, so a refused keystroke is a no-op and never a silent truncation.

| Situation | Result |
|---|---|
| `"."` and text already has one | refused |
| `"."` and text is `""` | `"0."` |
| `"."` otherwise | `text + "."` |
| digit, and the fraction already has 2 digits | refused |
| digit, and text is `""` or `"0"` | the digit alone (`"0"` stays `"0"`) |
| digit, and the integer part already has `MAX_INTEGER_DIGITS` | refused |
| digit otherwise | `text + key` |

`removeLastKey(text)` drops one character — including the decimal point, so backspacing out of a
fraction is symmetric with typing into it. `clear()` returns `""`.

**Why refuse rather than clamp.** The current numpad's header comment already argues this for its
own cap and it is right: a keystroke that is *shown* and then not *saved* means the display and the
ledger disagree about the number the user is reading. Refusing keeps them equal by construction.

### 1.3 `MAX_INTEGER_DIGITS = 13`

Thirteen integer digits plus two fraction digits is ₱9,999,999,999,999.99, or `999999999999999`
centavos. `Number.MAX_SAFE_INTEGER` is `9007199254740991`, an order of magnitude above it. Past the
safe integer boundary, integer arithmetic silently stops being exact — which in a money app is a
balance that does not add up and nothing that throws. The cap is not a product limit; it is the
point past which the user is leaning on the keypad and the app must still hold a number it can do
arithmetic with.

### 1.4 Conversion is integer-only, in both directions

```ts
export function centavosFrom(text: PesoInput): Centavos;
export function pesoInputFrom(amount: Centavos): PesoInput;
```

`centavosFrom` splits on `"."`, then computes `Number(integerPart) * 100 + Number(paddedFraction)`.
It never divides, never multiplies a fractional value, and never calls `Number` on a string
containing a decimal point. `Number("12.34") * 100 === 1233.9999999999998` is the exact bug
`lib/ingest/amount.ts` exists to avoid on the parsing side, and this is the same bug arriving from
the input side.

`pesoInputFrom` is the inverse, used to seed a field from a stored value when editing. `100000` →
`"1000"` (not `"1000.00"`, so the next keystroke continues naturally); `649` → `"6.49"`.

### 1.5 Display while typing is not display when committed

```ts
export function formatPesoInput(text: PesoInput): string;
```

Groups the integer part and echoes the fraction **verbatim**: `"1000"` → `₱1,000`, `"1000."` →
`₱1,000.`, `"1000.5"` → `₱1,000.5`, `""` → `₱0`.

Padding to two decimals happens on commit, through the existing `formatCentavos`, and never
mid-keystroke. A field that rewrites `1000.5` to `1000.50` while the user is still typing takes the
next `0` and produces `1000.50` again, or worse `1000.500` — it fights the person using it.

---

## 2. `components/ui/numeric_keypad.tsx` — the grid

Replaces `components/transactions/amount_numpad.tsx`. Purely presentational: it renders keys and
reports presses. It holds no state and knows nothing about money.

An explicit three-column grid, never `flex-wrap`. The current 4/4/3 layout is not a design; it is
what wrapping fixed-width children does at the A54's width, and it would silently become 5/5 on a
tablet.

```
1  2  3
4  5  6
7  8  9
.  0  ⌫
```

Backspace keeps the current component's two distinct behaviours, which are worth preserving
verbatim: **press removes one character, long press clears.** Wiring both to one handler passes any
test that only checks the field ends up empty — on a one-character value they are identical — and
leaves a user deleting a mistyped amount one key at a time while the digits shift under them.

### 2.1 Three modes

| Mode | Decimal key | Grouping | Affix | Value emitted |
|---|---|---|---|---|
| `peso` | yes, ≤2 dp | yes | `₱` prefix | `Centavos` |
| `integer` | **key rendered but inert and dimmed** | no | none | `number` |
| `rate` | yes, ≤2 dp | no | `%` suffix | raw string |

The decimal key is *rendered and disabled* in `integer` mode rather than omitted, so the grid never
reflows between modes and a user moving between "installment amount" and "how many installments"
does not watch the keys move under their thumb.

`rate` emits a raw string and the consuming form parses it exactly as it does today. Converting the
loan interest rate to basis points is a real improvement and it is **not W1's** — it would drag loan
schedule maths into an input-layer change.

---

## 3. `contexts/keypad_context.tsx` — state, and which window to draw in

### 3.1 The provider owns one focus at a time

```ts
type KeypadRequest = {
  fieldId: string;
  mode: "peso" | "integer" | "rate";
  initialText: string;
  onChangeText: (text: string) => void;
  onDone?: () => void;
};
```

`open(request)` focuses a field. `close()` blurs. Opening a *second* field while one is open swaps
the request without closing and reopening — the panel stays put and the value changes, because a
close/open animation between two adjacent amount fields reads as a glitch.

### 3.2 The bottom-sheet problem, and the host registry

`components/ui/bottom_sheet.tsx` is built on the platform `Modal`, which its own header comment
notes is "its own native window: it is NOT inside whatever View" rendered it. A keypad hosted once
at the root would therefore render **behind** any open sheet — and three numeric fields live inside
sheets (`allocation_sheet.tsx:105`, `balance_correction_sheet.tsx:120`,
`cash_reconcile_sheet.tsx:105`).

Resolution: `<KeypadHost />` is a component that may be mounted more than once, and the provider
draws the panel into exactly one of them.

- Mounted once in `app/_layout.tsx`, as a sibling of the `Stack`.
- Mounted once inside `BottomSheet`, at the bottom of its `Modal` content.
- Each host registers on mount with a monotonically increasing token and deregisters on unmount.
  The provider renders into the **highest live token**, which is always the topmost native window.
- When the host currently holding the panel unmounts — a sheet closing while the keypad is open —
  the provider calls `close()` rather than silently re-parenting. A keypad that survives the
  disappearance of the field it was editing has nowhere to commit to.

This is deliberately a registry and not a portal library. It is about twenty lines, it is directly
testable without a renderer, and it adds no dependency.

---

## 4. `components/ui/keypad_host.tsx` — the panel

### 4.1 It is not a `TextInput` and it is not a `Modal`

An absolutely-positioned view pinned to the bottom of its host, sliding up with
`react-native-reanimated` (already a dependency). Respects `useSafeAreaInsets().bottom` — the app is
`edgeToEdgeEnabled`, so a panel flush to the bottom lands under the gesture bar.

Header row: the field's label on the left; a **close (×)** icon button and a **Done** button on the
right. Both are always reachable, which matters because §4.3 removes the scrim that would otherwise
be the obvious way out.

**× and Done do exactly the same thing, and that is deliberate.** The field is updated on every
keystroke through `onChangeText`, so by the time either control is pressed there is no uncommitted
state left to discard — both simply close the panel. Two affordances exist because the panel reads
as a dialog to some users (who look for ×) and as a keyboard to others (who look for Done), and
losing either group to a panel they cannot dismiss is worse than a small redundancy.

Do not later "improve" × into a cancel that reverts the field. That is an undo feature: it needs the
field to snapshot its pre-edit value, it needs a rule for what happens when focus moves between two
fields without either control being pressed, and it turns two identical-looking buttons into two
destructive-vs-safe ones with no visual cue telling them apart.

### 4.2 Opening and closing

| Trigger | Effect | Built? |
|---|---|---|
| Press a `NumericField` | open, or swap focus if already open | yes |
| Press **Done** or **×** | commit, close — identical, see §4.1 | yes |
| Focus any `TextInput` | close (the OS keyboard is coming up regardless) | **no — §11.1** |
| Android hardware back | close, and **do not** navigate | yes |
| Scroll the form | close | **no — §11.1** |
| Navigate away / host unmounts | close | yes |

Hardware back consuming the event while the keypad is open is the one that needs a `BackHandler`
subscription. Without it the user's first back press exits the screen they were mid-way through
filling in.

### 4.3 No scrim, deliberately

The obvious design is a translucent full-screen backdrop that closes on tap. It is wrong here. The
forms this keypad serves are dense — the manual-entry sheet has direction toggles, a wallet picker,
a category picker and a date field all above the amount — and a scrim makes every one of those taps
a *dismissal* instead of the action the user intended. The user would tap "Received", the keypad
would close, and nothing else would happen.

The keypad occupies the bottom band; everything above it stays live and directly tappable. The cost
is that "tap the empty background to dismiss" does not work, which is what §4.1's × and Done, and
hardware back, are for.

### 4.4 The panel publishes its height

The host measures itself and writes its height into the context. §6 consumes it. Without this the
keypad reproduces, for numeric fields, the exact burial problem §1.7 describes for the OS keyboard.

---

## 5. `components/ui/numeric_field.tsx` — the field

A `Pressable` styled to match the existing bordered inputs, rendering `formatPesoInput(text)` or a
placeholder, with a caret-like accent when it is the focused field.

**It renders no `TextInput` at any point.** This is the whole mechanism behind the owner's
requirement. `showSoftInputOnFocus={false}` on a real `TextInput` is the other way to do it, and it
is a prop that one future edit can drop, one platform can ignore, and one autofill path can bypass.
A component with no text input in its tree cannot raise a keyboard no matter what anyone does to it
later.

**Accessibility.** `accessibilityRole="button"` with a label naming the field and speaking its
current value, so a screen-reader user hears "Amount, ₱1,000" rather than an unlabelled press
target. The keypad's own keys are individually labelled buttons, as today's numpad already does.

**The tradeoff, stated plainly:** no text cursor, no selection, no paste. For amounts this is
acceptable — the keypad's press-to-backspace and hold-to-clear cover correction. If a paste path is
ever needed it belongs in a later workstream, not smuggled into this one.

### 5.1 Manual entry keeps its prominent keypad, through the same path

`app/transaction/new.tsx` deliberately lands with the amount as "the first and only thing on
screen". It keeps that: the screen calls `open()` on mount, so the panel is already up when the
screen appears. Visually identical to today's inline numpad, one code path instead of two, and it
inherits §6's avoidance so the Save button stops hiding.

`NumericKeypad` stays exported and inline-capable, but after W1 no caller inlines it.

---

## 6. Keyboard and keypad avoidance

`KeyboardProvider` is **already** mounted at `app/_layout.tsx:358`. Nothing in the app consumes it:
there is not one `KeyboardAvoidingView`, `KeyboardAwareScrollView` or `keyboardShouldPersistTaps`
anywhere. The infrastructure is paid for and unused.

W1 adds one wrapper, `components/ui/form_screen.tsx`:

- `KeyboardAwareScrollView` from `react-native-keyboard-controller`, which handles the OS keyboard
  for the alphanumeric fields with no per-screen logic.
- Bottom padding of `max(keyboardHeight, keypadHeight)`, so our panel gets the same treatment the
  library gives the system keyboard.
- ~~Scrolls the focused `NumericField` into view when the keypad opens.~~ **Not built — §11.2.**
- `keyboardShouldPersistTaps="handled"`, so tapping a chip or a Save button while something is
  focused registers on the first tap rather than being eaten by a dismissal.

Applied to the eight long forms behind the four "buried" screenshots: loan, bill, goal, income,
manual entry, wallet, first-limit and the onboarding income step.

---

## 7. `components/ui/date_field.tsx`

A `Pressable` rendering a formatted date or a placeholder, opening the platform date dialog from
`@react-native-community/datetimepicker`. Value type is `IsoDate` (`'YYYY-MM-DD'`, already in
`types/domain.ts`) — no `Date` object crosses the component boundary, and nothing calls
`toISOString`, which is UTC and would shift the day for a UTC+8 user near midnight.

Per-field bounds, because "any date" is wrong on every one of these: a goal deadline is today
forward, a transaction date is today backward, a first loan payment is today forward, and the report
range's two fields bound each other.

Replaces the five `placeholder="YYYY-MM-DD"` inputs at `goal_form.tsx:94`, `loan_form.tsx:269`,
`range_picker.tsx:125` and `:132`, and `manual_entry_form.tsx:251`.

---

## 8. Migration inventory

Twenty `keyboardType` call sites across twelve files. Mode per site, confirmed by reading each:

**`peso` (13):** `limits/new.tsx:153` `limit-amount` · `bill_form.tsx:132` · `allocation_sheet.tsx:105` ·
`goal_form.tsx:74` · `goal_form.tsx:169` · `income_form.tsx:60` · `loan_form.tsx:169` `loan-principal` ·
`loan_form.tsx:234` `loan-installment` · `first_limit_form.tsx:146` `first-limit-amount` ·
`quick_wallet_list.tsx:163` · `balance_correction_sheet.tsx:120` · `cash_reconcile_sheet.tsx:105` ·
`wallet_form.tsx:154`

**`integer` (4):** `loan_form.tsx:215` `loan-term` · `loan_form.tsx:242` `loan-count` ·
`loan_form.tsx:250` `loan-interval` · `due_rule_picker.tsx:240`

**`rate` (3):** `limits/new.tsx:169` `limit-percent` · `first_limit_form.tsx:155` `first-limit-percent` ·
`loan_form.tsx:207` `loan-rate`

---

## 9. Testing strategy

### 9.1 Where the weight sits

`lib/money/peso_input.ts` is pure, total, and has a small input alphabet. It gets exhaustive
table-driven tests and it is where W1's correctness is actually established:

- every rule in §1.2, including each refusal, asserted as a no-op rather than "ends up empty";
- `centavosFrom` round-tripping against `pesoInputFrom` across the range;
- the specific cases from the owner's report: `"1000"` → `100000`, `"1000.50"` → `100050`,
  `"1000.5"` → `100050`, `"0.05"` → `5`, `"6.49"` → `649`;
- the boundary at `MAX_INTEGER_DIGITS`, asserting the result stays a safe integer;
- a regression test naming the old behaviour: `"100000"` must be ₱100,000.00 and **not** ₱1,000.00.

The registry rule in §3.2 is likewise testable without a renderer: register, register, unregister,
assert which token holds the panel.

### 9.2 The shared test helper comes first

Twenty-nine test files use `fireEvent.changeText`; roughly eighteen of them drive a numeric or date
field and will not compile against a component with no `TextInput`.

**Before migrating any of them, write `test_support/keypad.ts`** exposing something like
`typeAmount(field, "1000.50")` — press the field, then press the keys, then Done. Migration then
becomes one mechanical substitution per assertion instead of eighteen separately-invented ways to
drive a keypad. Skipping this is the single most likely way for W1 to cost three times its estimate.

### 9.3 The structural assertion

One test asserts that `NumericField` renders no `TextInput`, and one repo-level check asserts no
`keyboardType="numeric"` or `"number-pad"` survives outside `test_support/`. Constraint 2 is only
real if something enforces it.

### 9.4 What CI cannot cover

The panel's slide, its interaction with the sheet `Modal`, the hardware-back subscription, and the
platform date dialog are all device behaviour. They go on the on-device checklist in
`docs/13-on-device-verification.md`, together with §1.11's unresolved "Add manually" rendering,
which needs the device to diagnose at all.

---

## 10. Out of scope

Explicitly **not** W1, each because it belongs to a later workstream in the roadmap: delete for bills
and loans, derived limits, the Home empty-state and review-count changes (all W2); the package scan,
the deny-by-default flip, the Privacy Centre and the review-queue dismiss action (all W3); the app
PIN, which will reuse `NumericKeypad` in `integer` mode but touches key material and waits for W4.

Amounts already stored wrong under the centavo rule are **not** migrated. There is no way to tell a
deliberate ₱6.49 from a mistyped ₱649, and a migration that guesses would corrupt correct data to
fix incorrect data. The user deletes and re-enters them, which is what makes W2's delete a near
dependency rather than a later nicety.

---

## 11. Deferred after implementation

Three deliverables above were **not built**, and W1 shipped without a ruling either way. They are
recorded here as deliberate deferrals rather than left as claims the code does not honour. None is
a correctness defect -- each is a comfort or polish gap with a bounded, named fix -- and none
blocks the merge. Whoever picks one up starts here.

### 11.1 §4.2's "focus any `TextInput`" and "scroll the form" close triggers

**Not implemented.** There is no `onFocus` handler and no `onScroll` anywhere in the app. Four of
§4.2's six triggers are built; these two are not.

Reachable immediately, and the sharpest case is the screen the panel was designed around:
`components/transactions/manual_entry_form.tsx` renders the merchant and note `TextInput`s at
`:306` and `:315`, on a screen where `app/transaction/new.tsx` auto-opens the panel on mount. So
the very first thing a user does after typing an amount -- tapping "Where?" -- raises the OS
keyboard **over** the still-open keypad panel. Two keyboards, stacked. It is survivable (Done, ×
and hardware back all still dismiss the panel, and the OS keyboard sits on top so the field being
typed into stays visible) but it is not what §4.2 describes.

**The fix, for whoever takes it.** Both halves are cheap and neither needs to touch a call site:

- *Scroll:* `close()` from `FormScreen`'s `onScrollBeginDrag`. One prop, in the one wrapper every
  migrated form already goes through.
- *Focus:* a `Keyboard.addListener("keyboardDidShow", close)` in `KeypadProvider`. Prefer this to
  a per-`TextInput` `onFocus` -- it is one subscription instead of an `onFocus` on every text
  field in the app, it cannot be forgotten on a new field, and it fires on the event that actually
  matters (the OS keyboard arriving) rather than on a proxy for it.

Both want a test that the panel closes without the field's value changing, since closing is not
cancelling (§4.1).

### 11.2 §6's "scrolls the focused `NumericField` into view when the keypad opens"

**Not implemented.** `components/ui/form_screen.tsx` pads its content by the panel's height and
stops there. `KeyboardAwareScrollView` does scroll-into-view for the OS keyboard on its own, but
our panel is not a keyboard as far as it or the OS is concerned, so nothing does it for a
`NumericField`.

The consequence is a comfort gap, not a lost keystroke: the padding guarantees the field CAN be
scrolled to, only not that it already has been. The onboarding income step is the case to look at
-- its amount field sits below a four-row cadence picker and can scroll out of sight on the very
tap that focuses it. The panel still shows the field's name and its running value, so the user is
never editing something they cannot read, which is why this is a deferral and not a defect. It is
already on the on-device checklist (`docs/13-on-device-verification.md`, W1 -> Onboarding) as a
judgement call for the walker.

### 11.3 `form_screen.tsx` assumes its viewport reaches the bottom of the window

`components/ui/form_screen.tsx` adds `keypadHeight` as bottom padding, which is only exact when
the scroll viewport's bottom edge **is** the window's bottom edge -- the panel is pinned there at
`position: absolute; bottom: 0` (`components/ui/keypad_host.tsx`).

On two routes it is not. `app/wallet/new.tsx:129-134` and `app/wallet/edit.tsx` wrap `FormScreen`
in an outer `View` carrying `paddingBottom: insets.bottom`, so the panel overlaps the scroll view
by `keypadHeight - insets.bottom` and those two forms over-reserve by the inset -- 126px on the
A54. **The error direction is safe:** it always over-reserves and never under-reserves, so Save is
never buried; the cost is dead space. That is exactly why no checklist item catches it, and why it
is stated rather than fixed under a review deadline.

**The clean fix** is for `contexts/keypad_context.tsx` to publish the panel's **top edge in window
coordinates** instead of a bare height, and for each consumer to subtract its own measured bottom.
That also generalises: `components/ui/bottom_sheet.tsx` and `components/onboarding/onboarding_frame.tsx`
each hand-derive their own correction from the same bare height today, and each documents its own
reasoning for doing so. The assumption is named in a comment at the `paddingBottom` line so the
next reader meets it there.
