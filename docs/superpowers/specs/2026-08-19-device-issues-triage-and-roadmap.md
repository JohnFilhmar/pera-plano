# Device-Testing Issues, Round 2 — Triage, Decisions, Roadmap

**Status:** Decision record · 2026-08-19 · **not an implementation plan.** Each workstream below
gets its own design spec and its own plan.

**Source:** 17 screenshots captured on the Samsung A54 5G test device, plus three feature requests
from the owner (hovering numeric keypad, app-level PIN, explicit bank-app scan at onboarding).

**What this document is for:** the screenshots are gone the moment the folder is cleared, and each
one collapses to a one-line symptom that hides a root cause somewhere else in the tree. This
records the root cause for all twelve distinct issues, the four decisions the owner made on
2026-08-19, and the order the work happens in. W1–W4 specs reference this file rather than
re-deriving it.

---

## 0. The four decisions

Made by the owner on 2026-08-19 after the tradeoffs below were put to them. Recorded here because
three of the four reverse or extend a decision already written into the codebase, and a future
reader finding those old comments needs to know they were superseded deliberately.

### 0.1 The app PIN is an ADDITIONAL DEK wrap. The device screen lock stays mandatory.

The 6-digit PIN becomes a third way to unwrap the DEK, alongside the device Keystore KEK and the
recovery phrase. It does **not** replace `app/(onboarding)/device_lock.tsx`, and `isDeviceSecure()`
remains a hard gate.

**Why not let the PIN replace the screen lock.** Six digits is 10^6 combinations. The device
Keystore gives hardware-enforced rate limiting and, on most modern hardware, key material that
never leaves the secure element. A PIN-derived key has neither: an attacker with a device image can
attack it offline at whatever rate their hardware allows. High-cost Argon2id raises that cost but
does not change its shape. Keeping the device key as the primary wrap means the PIN only ever
*adds* an unlock path — it can never be the weakest link, because the data is not protected by it
alone.

**What this still buys.** The users the owner is worried about — no fingerprint enrolled, face
unlock only, or a screen lock they resent — get a reliable way into the app that does not depend on
a biometric class the Keystore refuses to honour. See §1.3.

### 0.2 Installed-app discovery uses `QUERY_ALL_PACKAGES`.

Chosen over the `<queries>` manifest allowlist after the tradeoff was put to the owner.

**The cost, recorded so it is not rediscovered at review time.** `QUERY_ALL_PACKAGES` is a Play
restricted permission. Every release requires a declaration form, and Google's enumerated permitted
uses do not obviously cover "detect which bank apps the user has installed" — the financial
carve-out is worded for fraud and security checks. A rejection is a live possibility.

**The mitigation, which is a design constraint on W3, not an alternative to the decision.** Package
discovery goes behind one interface with two implementations: the `QUERY_ALL_PACKAGES` scan, and a
`<queries>` manifest allowlist of known PH bank and e-wallet packages. If a review ever bounces, the
swap is one implementation, not a redesign of onboarding. The interface exists from day one whether
or not the second implementation is written immediately.

### 0.3 Capture flips to deny-by-default.

`CapturePrefs.shouldCapture` currently returns `filter.isEmpty() || packageName in filter` — an
empty provider filter captures **every notification on the device**. That is why `com.viber.voip`
and `com.google.android.gm` appear in the Privacy Centre. It is deliberate, it is documented at
length in `app/(onboarding)/providers.tsx` ("SELECTING NOTHING MEANS CAPTURE-EVERYTHING, NOT
CAPTURE-NOTHING"), and it is pinned by `CapturePrefsTest` on the Kotlin side.

It is now reversed: nothing is captured except explicitly selected packages.

**Why the original decision was right at the time, and why it stops being right.** The old rationale
was that a user who ticked nothing would otherwise get an app that installs, onboards cleanly, and
silently tracks nothing. That was sound when the provider picker was populated from thirteen
*guessed, unverified* package names and a listener history that is empty on a fresh install —
"ticked nothing" was overwhelmingly likely to mean "recognised nothing", not "wanted nothing". Once
§0.2's scan pre-fills the picker with apps the user demonstrably has, an empty selection becomes a
real choice. **This flip is therefore sequenced strictly after the scan lands** — shipping it first
would produce exactly the silent no-op app the original comment warns about.

### 0.4 Derived limits are display-only.

A monthly limit implies daily and weekly guardrails; an annual limit implies monthly, weekly and
daily. These are **computed for display**, not written as limit rows.

One stored limit per period the user actually created. Derived figures render on Home and Plan and
never fire their own alerts — the stored limit remains the single source of truth for
`limit_alert_state`. This avoids three alert streams for one budget, and avoids the desync that
appears the moment a user edits a child limit whose parent then changes.

---

## 1. The twelve issues and their root causes

Grouped by cause, not by screenshot. Screenshot filenames are given so the mapping survives.

### 1.1 Every amount in the app is entered in centavos — `W1`

`components/ui/amount_text.tsx:centavosFromDigits()` strips non-digits and treats **every remaining
digit as a centavo**. `100000` becomes ₱1,000.00. `177.66` becomes ₱177.66 only because `17766`
centavos happens to be the right answer — the same rule, not a different one.

Required behaviour: `1000` is ₱1,000.00; `1000.50` is ₱1,000.50. Digits before the decimal point are
pesos. A fraction exists only when the user types the point.

Storage stays integer centavos throughout, and `formatCentavos` is untouched. Only the **input**
mapping changes, so the float-precision invariant that file's header defends survives intact — see
the W1 spec for the integer-only conversion.

*Screenshot: `change-number-input-behavior-always-1000-is-1000-...`*

### 1.2 Reusable numpad is 4/4/3 with no decimal key — `W1`

`components/transactions/amount_numpad.tsx` lays ten keys out with `flex-row flex-wrap` over fixed
`w-20` children, which produces four-four-three at the test device's width. It is not a chosen
layout; it is what wrapping happens to do. There is no decimal key because §1.1's model has no use
for one.

*Screenshot: `change-reusable-numpad-to-look-like-actual-phone-numpad-format-not-4x4x2-...`*

### 1.3 Face unlock can never work against the current Keystore key — `W0`

`KeyVault.kt:118` pins the key's authorised authenticators:

```kotlin
private const val AUTH_TYPES =
  KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL
```

Samsung A54 face unlock is **Class 2 (weak)**. It satisfies
`LocalAuthentication.authenticateAsync({ disableDeviceFallback: false })`, which on Android maps to
a BiometricPrompt accepting `BIOMETRIC_WEAK | DEVICE_CREDENTIAL` — so the prompt reports success —
but it does **not** authorise a Keystore key that demands Class 3. The subsequent unwrap throws
`NotAuthenticatedError`, which `contexts/lock_context.tsx` maps to "Please authenticate again to
continue."

The user is told to retry the exact action that cannot succeed, forever.

**This is independent of the app PIN.** It is a small fix and it is the reason the owner cannot
reliably open the app today, so it ships first and alone.

*Screenshot: `facerecognition-not-working-need-to-implement-app-pin-fallback-...`*

### 1.4 The notification listener captures every app on the device — `W3`

`CapturePrefs.kt:180`, covered in §0.3. The listener's own gate at
`PeraPlanoNotificationListenerService.kt:275` is correct; the predicate behind it is what admits
Viber and Gmail.

*Screenshots: `notifications-are-tracking-irrelevant-data-...`,
`system-catches-irrelevant-notifications-and-unrejectable-...`*

### 1.5 The review queue can triage garbage but does not offer to — `W3`

Good news buried in a bad screenshot: `hooks/mutations/use_review_action.ts:44` already defines both
`{ kind: "dismiss" }` ("Not money") and `{ kind: "ignore-provider" }`. The capability exists and is
wired to `resolve(id, "dismissed")`.

The low-confidence card in `components/review/` renders only "Looks right" and "Correct". A
0%-confidence capture with no amount, no merchant and no matched wallet offers the user two ways to
accept it and none to reject it. This is a UI gap, not missing functionality.

*Screenshot: `system-catches-irrelevant-notifications-and-unrejectable-...`*

### 1.6 Bills and loans cannot be deleted — `W2`

Delete is **half-built across the Plan tab**, and which half you get depends on which entity you
opened:

| Entity | Repo | Hook | Detail-screen action |
|---|---|---|---|
| Goal | `deleteGoal` | `use_delete_goal` | yes — `goals/[id].tsx:75` "Delete goal" |
| Limit | `deleteLimit` | `use_delete_limit` | yes — `limits/[id].tsx:156` "Delete" |
| **Bill** | **none** | **none** | **none** |
| **Loan** | **none** | **none** | **none** |

`lib/db/repos/` does have `deleteBillPayment` and `deletePayment` / `deleteAdjustment`, but those
remove a *payment against* a bill or loan, never the bill or loan itself. There is **no
`deleteBill` and no `deleteLoan` at any layer.**

**The copy already claims otherwise.** `bills/[id].tsx:58` renders "It was archived or deleted. Any
payments you recorded are still in your ledger." and `loans/[id].tsx:42` renders "It was deleted…"
— not-found states describing a transition the app has no code path to perform. Whoever wrote those
screens expected delete to exist. W2 makes the copy true rather than removing it.

**Delete is detail-screen-only even where it works.** Goals and limits can only be deleted after
tapping into the row; the list itself offers no affordance, which is the screen the owner was
looking at when they reported this. W2 should add a list-level path — swipe or long-press — for all
four entities, or the fix is invisible from where the problem is noticed.

This compounds §1.1: the owner's "Dasca Fiberblaze ₱6.49" is a bill created by typing `649` under
the centavo rule. Fixing §1.1 does not retro-correct rows already written, so **W2's delete must
land close behind W1** or the test device stays full of unremovable wrong data.

*Screenshots: `undeleteable-unremovable-bad-input-mistaken-planned-datas-1/2`*

### 1.7 No screen avoids the keyboard — `W1`

`KeyboardProvider` from `react-native-keyboard-controller` **is** mounted at
`app/_layout.tsx:358`. What is missing is any consumer: there is not one `KeyboardAvoidingView`,
`KeyboardAwareScrollView` or `keyboardShouldPersistTaps` in the app. Focused fields, and the Save
button below them, go under the keyboard on every long form.

The infrastructure is already paid for; the screens simply never opted in.

*Screenshots: `focused-inputs-are-getting-burried-by-keyboard-keypad-1/2`,
`save-income-button-burried-1`, `save-income-butotn-burried-2`*

### 1.8 Dates are typed as free text — `W1`

`placeholder="YYYY-MM-DD"` on a bare `TextInput` in `components/goals/goal_form.tsx:94`,
`components/loans/loan_form.tsx:269`, `components/reports/range_picker.tsx:125` and `:132`, and
`components/transactions/manual_entry_form.tsx:251`. No date-picker dependency is installed.

*Screenshots: `change-date-input-with-date-selector`,
`apply-changed-numpad-on-this-component-...-and-change-all-date-yyyy-mm-dd-inputs-...`*

### 1.9 Onboarding's first-limit step uses the system keyboard — `W1`

`components/onboarding/first_limit_form.tsx:146,155` are `keyboardType="numeric"` text inputs on a
step that is conceptually the same "type an amount" interaction the numpad already owns.

*Screenshot: `add-numpad-to-this-section-instead-of-phone-keyboard-or-keypad`*

### 1.10 Derived limits do not exist — `W2`

Periods `daily | weekly | monthly | annual` are modelled (`app/(tabs)/plan/limits/new.tsx:27-30`)
but nothing derives one from another. Resolution in §0.4.

*Screenshot: `limits-should-auto-inherit-accordingly-...`*

### 1.11 Home's empty-state action renders "Add" instead of "Add manually" — `W2`

`components/ui/empty_states.tsx:55` holds `actionLabel: "Add manually"` and
`app/(tabs)/index.tsx:141` passes it through correctly. `components/ui/button.tsx` applies no width
constraint and no `numberOfLines`. The string is right, the wiring is right, and the device renders
"Add".

**Unresolved — needs on-device investigation, not more static reading.** Working hypothesis is a
reflow when the Inter face finishes loading. Do not "fix" this by hardcoding a shorter label.

*Screenshot: `add-manually-button-manually-text-disappearing-...`*

### 1.12 The review-count link on Home is too quiet — `W2`

"2 items awaiting review aren't counted yet" renders as underlined body text under the
Safe-to-Spend hero. It is the one thing on that screen telling the user the headline number is
incomplete, and it reads as a footnote.

*Screenshot: `add-manually-button-...-and-items-need-review-need-to-be-more-noticeable`*

---

## 2. Workstreams and order

| | Scope | Depends on |
|---|---|---|
| **W0** | Class-3 biometric fix (§1.3) | — |
| **W1** | Numeric input system: peso semantics, hovering keypad, date fields, keyboard avoidance (§1.1, §1.2, §1.7, §1.8, §1.9) | — |
| **W2** | Delete for bills and loans, plus a list-level delete affordance for all four Plan entities; derived limits; Home copy and review-count prominence (§1.6, §1.10, §1.11, §1.12) | W1 for the forms it touches |
| **W3** | `QUERY_ALL_PACKAGES` scan; deny-by-default capture; onboarding provider step; Privacy Centre; review-queue dismiss (§1.4, §1.5) | §0.2 scan strictly before §0.3 flip |
| **W4** | App PIN as a third DEK wrap (§0.1) | W0 |

**Order: W0 → W1 → W2 → W3 → W4.**

W0 first because it is small and the owner cannot dependably open the app without it. W1 next
because every subsequent form change would otherwise be written twice. W2 close behind W1 so the bad
rows W1's bug created become removable. W3 before W4 because it is the larger user-visible win and
touches no key material. W4 last for the same reason in reverse: it is the only workstream that can
lose a user's data if it is wrong.
