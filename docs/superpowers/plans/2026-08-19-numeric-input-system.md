# Numeric Input System (W1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every number in PeraPlano is typed on a keypad the app owns, in pesos — `1000` means ₱1,000.00 and `1000.50` means ₱1,000.50 — and nothing the user is typing into ever hides behind the thing they are typing with.

**Architecture:** One pure module (`lib/money/peso_input.ts`) owns the keystroke-to-centavos mapping and holds all the arithmetic. A presentational grid (`components/ui/numeric_keypad.tsx`) draws keys. A context plus a re-registerable host (`contexts/keypad_context.tsx`, `components/ui/keypad_host.tsx`) turns that grid into a panel that draws into whichever native window is topmost, which is what makes it work inside `bottom_sheet.tsx`'s `Modal`. A `Pressable`-only field (`components/ui/numeric_field.tsx`) replaces every numeric `TextInput`, so the OS keyboard is structurally unreachable rather than merely suppressed.

**Tech Stack:** TypeScript ~5.9 strict · Expo SDK 54 · expo-router ~6 · React Native 0.81.5 · NativeWind 4 · `@testing-library/react-native` 13 · jest-expo 54 · `@react-native-community/datetimepicker` (**new dependency**, Task 8) · `react-native-keyboard-controller` (installed, already mocked in `test_support/jest_setup.ts`, `KeyboardProvider` already mounted)

**Spec:** `docs/superpowers/specs/2026-08-19-numeric-input-system-design.md`
**Context:** `docs/superpowers/specs/2026-08-19-device-issues-triage-and-roadmap.md` (this is workstream W1)

## Global Constraints

- **Integer centavos are the only money representation** in state, props and storage. No task introduces a float. `formatCentavos` in `components/ui/amount_text.tsx` is not modified.
- **Never `Number()` a string containing a decimal point to get money.** `Number("12.34") * 100 === 1233.9999999999998`. Split on `"."` and do integer arithmetic on the halves.
- **`MAX_INTEGER_DIGITS = 13`, `MAX_FRACTION_DIGITS = 2`.** Ceiling ₱9,999,999,999,999.99 = `999999999999999` centavos, safely under `Number.MAX_SAFE_INTEGER` (`9007199254740991`).
- **When W1 is done, no `TextInput` in `mobile/` carries `keyboardType="numeric"` or `keyboardType="number-pad"`.** Enforced by a test in Task 15.
- **`NumericField` renders no `TextInput` in its tree**, ever. Enforced by a test in Task 5.
- **Alphanumeric fields are untouched** — wallet names, notes, merchant, recovery phrase, report filename keep the system keyboard.
- **Refused keystrokes are no-ops**, never silent truncation. A keystroke that is shown and then not saved means the display and the ledger disagree.
- **Colour and spacing use contract §2 tokens only** — `bg-surface dark:bg-surface-dark`, `text-fg dark:text-fg-dark`, `text-fg-2 dark:text-fg-2-dark`, `bg-brand dark:bg-brand-dark`, `text-on-brand dark:text-on-brand-dark`. No raw hex.
- **Commit after every task.** Message style: lower-case conventional prefix, imperative, no AI attribution trailer.
- Run the full suite with `npm test` from `mobile/`. Run one file with `npx jest <path>`.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `mobile/lib/money/peso_input.ts` | Keystroke state machine and integer-only centavo conversion. Pure, no React. |
| `mobile/lib/money/__tests__/peso_input.test.ts` | Exhaustive table tests. Where W1's correctness is established. |
| `mobile/components/ui/numeric_keypad.tsx` | 3-column key grid, three modes. Presentational, stateless. |
| `mobile/components/ui/__tests__/numeric_keypad.test.tsx` | Layout, mode behaviour, backspace-vs-clear. |
| `mobile/contexts/keypad_context.tsx` | Which field is focused, which host may draw, panel height. |
| `mobile/contexts/__tests__/keypad_context.test.tsx` | Host registry: topmost wins, unmount closes. |
| `mobile/components/ui/keypad_host.tsx` | The panel: header, display, grid, back handling, height reporting. |
| `mobile/components/ui/__tests__/keypad_host.test.tsx` | Open/close paths, × and Done, host stacking. |
| `mobile/components/ui/numeric_field.tsx` | The tap target. A `Pressable`, never a `TextInput`. |
| `mobile/components/ui/__tests__/numeric_field.test.tsx` | Opens keypad, stays in sync, renders no `TextInput`. |
| `mobile/test_support/keypad.ts` | `typeAmount()` / `openKeypad()` helpers used by every migrated form test. |
| `mobile/components/ui/form_screen.tsx` | Keyboard- and keypad-aware scroll wrapper. |
| `mobile/components/ui/date_field.tsx` | `Pressable` → platform date dialog, `IsoDate` in and out. |
| `mobile/components/ui/__tests__/date_field.test.tsx` | Bounds, formatting, cancel. |

**Modified**

| File | Change |
|---|---|
| `mobile/app/_layout.tsx` | Add `KeypadProvider` and a root `<KeypadHost />`. |
| `mobile/components/ui/bottom_sheet.tsx` | Add a `<KeypadHost />` inside the `Modal`. |
| `mobile/components/transactions/manual_entry_form.tsx` | Numeric + date migration. |
| `mobile/components/loans/loan_form.tsx` | Six fields, all three modes, plus a date. |
| `mobile/components/bills/bill_form.tsx`, `bills/due_rule_picker.tsx` | Amount + day-of-month. |
| `mobile/components/goals/goal_form.tsx`, `goals/allocation_sheet.tsx` | Two amounts, one allocation, one date. |
| `mobile/app/(tabs)/plan/limits/new.tsx`, `components/onboarding/first_limit_form.tsx`, `components/income/income_form.tsx` | Amount + rate. |
| `mobile/components/wallets/wallet_form.tsx`, `onboarding/quick_wallet_list.tsx`, `wallets/balance_correction_sheet.tsx`, `wallets/cash_reconcile_sheet.tsx` | Balances; the last two exercise the sheet host. |
| `mobile/components/reports/range_picker.tsx` | Two date fields. |
| `mobile/components/ui/amount_text.tsx` | Delete `centavosFromDigits` (Task 15). |
| `mobile/components/transactions/amount_numpad.tsx` | Delete (Task 15). |

---

## Task 1: The peso input state machine

**Files:**
- Create: `mobile/lib/money/peso_input.ts`
- Test: `mobile/lib/money/__tests__/peso_input.test.ts`

**Interfaces:**
- Consumes: `Centavos` from `@/types/domain`.
- Produces: `type PesoInput = string`; `MAX_INTEGER_DIGITS: 13`; `MAX_FRACTION_DIGITS: 2`; `appendKey(text: PesoInput, key: string): PesoInput`; `removeLastKey(text: PesoInput): PesoInput`; `centavosFrom(text: PesoInput): Centavos`; `pesoInputFrom(amount: Centavos): PesoInput`; `formatPesoInput(text: PesoInput): string`.

- [ ] **Step 1: Write the failing test**

Create `mobile/lib/money/__tests__/peso_input.test.ts`:

```ts
// mobile/lib/money/__tests__/peso_input.test.ts
//
// THE 100x ERROR IS THE ONE THIS FILE EXISTS TO CATCH, in the direction
// opposite to the old amount_numpad test. Reading `1`,`0`,`0`,`0` as twelve
// pesos and fifty centavos throws nothing and renders a plausible number; it
// is only ever noticed as "the app thinks I spent a hundredth of what I did".
import {
  appendKey,
  centavosFrom,
  formatPesoInput,
  MAX_INTEGER_DIGITS,
  pesoInputFrom,
  removeLastKey,
} from "../peso_input";

/** Presses `keys` in order against a fresh field. */
function type(keys: string): string {
  return [...keys].reduce((text, key) => appendKey(text, key), "");
}

describe("digits are pesos, not centavos", () => {
  test.each([
    ["1000", 100_000],
    ["1000.50", 100_050],
    ["1000.5", 100_050],
    ["6.49", 649],
    ["0.05", 5],
    ["1", 100],
    ["", 0],
  ])("%s yields %i centavos", (text, expected) => {
    expect(centavosFrom(text)).toBe(expected);
  });

  test("REGRESSION: 100000 is one hundred thousand pesos, not one thousand", () => {
    // The old centavosFromDigits read this as 100000 centavos = P1,000.00.
    expect(centavosFrom(type("100000"))).toBe(10_000_000);
  });
});

describe("the decimal point", () => {
  test("a leading point becomes 0.", () => {
    expect(appendKey("", ".")).toBe("0.");
  });

  test("a second point is refused as a no-op", () => {
    expect(appendKey("10.5", ".")).toBe("10.5");
  });

  test("a third fraction digit is refused as a no-op", () => {
    expect(appendKey("10.55", "9")).toBe("10.55");
  });

  test("the intermediate trailing point survives", () => {
    expect(type("1000.")).toBe("1000.");
  });
});

describe("leading zeros", () => {
  test("0 then 5 is 5, not 05", () => {
    expect(type("05")).toBe("5");
  });

  test("0 then 0 stays 0", () => {
    expect(type("00")).toBe("0");
  });

  test("0 then . opens a fraction", () => {
    expect(type("0.")).toBe("0.");
  });
});

describe("the safe-integer ceiling", () => {
  const atCap = "9".repeat(MAX_INTEGER_DIGITS);

  test("a digit past the cap is refused as a no-op", () => {
    expect(appendKey(atCap, "9")).toBe(atCap);
  });

  test("the value at the cap is still a safe integer", () => {
    expect(Number.isSafeInteger(centavosFrom(`${atCap}.99`))).toBe(true);
  });
});

describe("backspace", () => {
  test("removes one character, including the point", () => {
    expect(removeLastKey("10.")).toBe("10");
    expect(removeLastKey("10")).toBe("1");
    expect(removeLastKey("")).toBe("");
  });
});

describe("seeding a field from a stored amount", () => {
  test.each([
    [100_000, "1000"],
    [649, "6.49"],
    [5, "0.05"],
    [0, "0"],
  ])("%i centavos seeds as %s", (amount, expected) => {
    expect(pesoInputFrom(amount)).toBe(expected);
  });

  test("round-trips through centavosFrom", () => {
    for (const amount of [0, 1, 99, 100, 649, 100_050, 999_999_999]) {
      expect(centavosFrom(pesoInputFrom(amount))).toBe(amount);
    }
  });
});

describe("display while typing echoes the fraction verbatim", () => {
  test.each([
    ["", "₱0"],
    ["1000", "₱1,000"],
    ["1000.", "₱1,000."],
    ["1000.5", "₱1,000.5"],
    ["1000.50", "₱1,000.50"],
    ["0.05", "₱0.05"],
  ])("%s displays as %s", (text, expected) => {
    expect(formatPesoInput(text)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest lib/money/__tests__/peso_input.test.ts`
Expected: FAIL — `Cannot find module '../peso_input'`.

- [ ] **Step 3: Write the implementation**

Create `mobile/lib/money/peso_input.ts`:

```ts
// mobile/lib/money/peso_input.ts — W1 Task 1.
//
// THE ONLY PLACE KEYSTROKES BECOME MONEY. `components/ui/amount_text.tsx`
// owns the other direction (centavos -> a string a user reads); this owns
// the way in.
//
// THE STATE IS THE STRING THE USER TYPED, not a number derived from it.
// Holding "1000." is the whole reason this module exists: that intermediate
// value is not a rounding artefact to normalise away, it is what the user is
// looking at immediately after pressing the decimal key, and a model that
// cannot represent it either swallows the keystroke or jumps the caret.
//
// EVERY CONVERSION IS INTEGER-ONLY. `Number("12.34") * 100` is
// 1233.9999999999998, which is the exact bug `lib/ingest/amount.ts` exists to
// avoid on the parsing side, arriving here from the input side. Nothing below
// calls Number() on a string containing a decimal point.
//
// REFUSALS ARE NO-OPS. Every rule that rejects a keystroke returns the input
// unchanged rather than truncating: a keystroke that is SHOWN and then not
// SAVED leaves the display and the ledger disagreeing about the number the
// user is reading at that moment.
import type { Centavos } from "@/types/domain";

/** Exactly what the user has keyed: "", "0", "1000", "1000.", "1000.5". */
export type PesoInput = string;

/**
 * Thirteen integer digits and two fraction digits is P9,999,999,999,999.99,
 * or 999999999999999 centavos — an order of magnitude below
 * Number.MAX_SAFE_INTEGER (9007199254740991). Past that boundary integer
 * arithmetic silently stops being exact, which in a money app is a balance
 * that does not add up and nothing that throws. Not a product limit; the
 * point past which the user is leaning on the keypad.
 */
export const MAX_INTEGER_DIGITS = 13;
export const MAX_FRACTION_DIGITS = 2;

const DIGIT = /^[0-9]$/u;

/** Appends one key, or returns the input unchanged when it may not be added. */
export function appendKey(text: PesoInput, key: string): PesoInput {
  if (key === ".") {
    if (text.includes(".")) return text;
    // A bare "." would make centavosFrom's integer half empty; "0." is the
    // same value and is also what the user means by pressing it first.
    if (text === "") return "0.";
    return `${text}.`;
  }

  if (!DIGIT.test(key)) return text;

  const point = text.indexOf(".");
  if (point >= 0) {
    const fractionLength = text.length - point - 1;
    if (fractionLength >= MAX_FRACTION_DIGITS) return text;
    return `${text}${key}`;
  }

  // A leading zero is replaced rather than accumulated: "0" then "5" is 5,
  // not an "05" that later grows into "050".
  if (text === "" || text === "0") return key === "0" ? "0" : key;
  if (text.length >= MAX_INTEGER_DIGITS) return text;
  return `${text}${key}`;
}

/** Removes the last character — the decimal point included, so backspacing out of a fraction mirrors typing into one. */
export function removeLastKey(text: PesoInput): PesoInput {
  return text.slice(0, -1);
}

/** `"1000.5"` -> `100050`. Integer arithmetic on the two halves, never a float. */
export function centavosFrom(text: PesoInput): Centavos {
  if (text === "") return 0;

  const point = text.indexOf(".");
  const integerText = point >= 0 ? text.slice(0, point) : text;
  const fractionText = point >= 0 ? text.slice(point + 1) : "";

  const pesos = integerText === "" ? 0 : Number(integerText);
  const centavos = fractionText === "" ? 0 : Number(fractionText.padEnd(MAX_FRACTION_DIGITS, "0"));

  return pesos * 100 + centavos;
}

/**
 * The inverse, for seeding a field from a stored amount.
 *
 * `100000` gives `"1000"` and NOT `"1000.00"`: the next keystroke has to
 * continue the integer part, and a seeded `"1000.00"` is already at the
 * fraction cap, so every further digit would be refused on a field the user
 * has not touched yet.
 */
export function pesoInputFrom(amount: Centavos): PesoInput {
  const absolute = Math.abs(amount);
  const pesos = Math.trunc(absolute / 100);
  const centavos = absolute % 100;
  return centavos === 0 ? String(pesos) : `${pesos}.${String(centavos).padStart(2, "0")}`;
}

/**
 * What the field shows WHILE TYPING — grouped integer, fraction echoed
 * verbatim.
 *
 * Padding to two decimals happens on commit, through formatCentavos, and
 * never here. A field that rewrites "1000.5" to "1000.50" mid-keystroke takes
 * the user's next `0` and produces "1000.50" again, or worse "1000.500": it
 * fights the person using it.
 */
export function formatPesoInput(text: PesoInput): string {
  if (text === "") return "₱0";

  const point = text.indexOf(".");
  const integerText = point >= 0 ? text.slice(0, point) : text;
  const fractionText = point >= 0 ? text.slice(point) : "";

  const grouped = Number(integerText === "" ? 0 : integerText).toLocaleString("en-US");
  return `₱${grouped}${fractionText}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest lib/money/__tests__/peso_input.test.ts`
Expected: PASS, all suites green.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/lib/money/peso_input.ts mobile/lib/money/__tests__/peso_input.test.ts
git commit -m "feat(mobile): read typed digits as pesos rather than centavos"
```

---

## Task 2: The keypad grid

**Files:**
- Create: `mobile/components/ui/numeric_keypad.tsx`
- Test: `mobile/components/ui/__tests__/numeric_keypad.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1 — this component is stateless and knows nothing about money.
- Produces: `type KeypadMode = "peso" | "integer" | "rate"`; `NumericKeypad(props: { mode: KeypadMode; onKey: (key: string) => void; onBackspace: () => void; onClear: () => void })`. TestIDs: `numeric-keypad`, `keypad-key-0` … `keypad-key-9`, `keypad-key-.`, `keypad-backspace`.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/ui/__tests__/numeric_keypad.test.tsx`:

```tsx
// mobile/components/ui/__tests__/numeric_keypad.test.tsx — W1 Task 2.
//
// THE LAYOUT IS PART OF THE CONTRACT. The component this replaces laid ten
// keys out with flex-wrap over fixed-width children, which produced 4/4/3 on
// the test device by accident and would have produced 5/5 on a tablet. The
// row assertions below exist so the grid cannot drift back into being
// whatever wrapping happens to do.
import { fireEvent, render, screen } from "@testing-library/react-native";

import { NumericKeypad } from "../numeric_keypad";

const onKey = jest.fn();
const onBackspace = jest.fn();
const onClear = jest.fn();

beforeEach(() => {
  onKey.mockClear();
  onBackspace.mockClear();
  onClear.mockClear();
});

function renderKeypad(mode: "peso" | "integer" | "rate" = "peso") {
  render(
    <NumericKeypad mode={mode} onKey={onKey} onBackspace={onBackspace} onClear={onClear} />,
  );
}

test("renders twelve keys in phone order, three to a row", () => {
  renderKeypad();

  for (const key of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "."]) {
    expect(screen.getByTestId(`keypad-key-${key}`)).toBeTruthy();
  }
  expect(screen.getByTestId("keypad-backspace")).toBeTruthy();

  const rows = screen.getByTestId("numeric-keypad").props.children;
  expect(rows).toHaveLength(4);
});

test("a digit press reports that digit", () => {
  renderKeypad();

  fireEvent.press(screen.getByTestId("keypad-key-7"));

  expect(onKey).toHaveBeenCalledWith("7");
});

test("the decimal key reports a point in peso mode", () => {
  renderKeypad("peso");

  fireEvent.press(screen.getByTestId("keypad-key-."));

  expect(onKey).toHaveBeenCalledWith(".");
});

test("the decimal key is present but inert in integer mode", () => {
  renderKeypad("integer");

  const decimal = screen.getByTestId("keypad-key-.");
  // Rendered, so the grid never reflows between modes and the keys do not
  // move under a thumb already on its way down.
  expect(decimal).toBeTruthy();
  expect(decimal.props.accessibilityState.disabled).toBe(true);

  fireEvent.press(decimal);

  expect(onKey).not.toHaveBeenCalled();
});

test("the decimal key works in rate mode", () => {
  renderKeypad("rate");

  fireEvent.press(screen.getByTestId("keypad-key-."));

  expect(onKey).toHaveBeenCalledWith(".");
});

describe("backspace is two behaviours, not one", () => {
  // Wiring both to one handler passes any test that only checks the field
  // ends up empty -- on a one-character value they are identical.
  test("press removes one character", () => {
    renderKeypad();

    fireEvent.press(screen.getByTestId("keypad-backspace"));

    expect(onBackspace).toHaveBeenCalledTimes(1);
    expect(onClear).not.toHaveBeenCalled();
  });

  test("long press clears", () => {
    renderKeypad();

    fireEvent(screen.getByTestId("keypad-backspace"), "longPress");

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onBackspace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest components/ui/__tests__/numeric_keypad.test.tsx`
Expected: FAIL — `Cannot find module '../numeric_keypad'`.

- [ ] **Step 3: Write the implementation**

Create `mobile/components/ui/numeric_keypad.tsx`:

```tsx
// mobile/components/ui/numeric_keypad.tsx — W1 Task 2. Replaces
// components/transactions/amount_numpad.tsx.
//
// AN EXPLICIT THREE-COLUMN GRID, NEVER flex-wrap. The component this replaces
// wrapped fixed-width children and got 4/4/3 on the A54 -- not a chosen
// layout, just what wrapping does at that width, and it would silently become
// something else on a tablet. Each row is its own flex-row of flex-1
// children, so three columns is a property of the markup rather than of the
// screen.
//
// PRESENTATIONAL AND STATELESS. It knows nothing about money, holds no text,
// and never converts anything: lib/money/peso_input.ts owns all of that, and
// keeping the two apart is what lets the state machine be tested exhaustively
// without a renderer.
import { Pressable, Text, View } from "react-native";
import { Delete } from "lucide-react-native";
import { cssInterop } from "nativewind";

// Lucide ignores `className` until registered; `nativeStyleToProp` routes the
// resolved colour back onto the `color` prop it actually reads.
cssInterop(Delete, { className: { target: "style", nativeStyleToProp: { color: true } } });

export type KeypadMode = "peso" | "integer" | "rate";

export type NumericKeypadProps = {
  mode: KeypadMode;
  onKey: (key: string) => void;
  /** One character. */
  onBackspace: () => void;
  /** Everything. Long press only — see the test for why they are separate. */
  onClear: () => void;
};

const ROWS: readonly (readonly string[])[] = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  [".", "0", "backspace"],
];

const KEY_CLASS = "h-14 flex-1 items-center justify-center rounded-2xl bg-surface dark:bg-surface-dark";

export function NumericKeypad({ mode, onKey, onBackspace, onClear }: NumericKeypadProps) {
  const decimalInert = mode === "integer";

  return (
    <View testID="numeric-keypad" className="gap-2">
      {ROWS.map((row) => (
        <View key={row.join("")} className="flex-row gap-2">
          {row.map((key) => {
            if (key === "backspace") {
              return (
                <Pressable
                  key={key}
                  testID="keypad-backspace"
                  accessibilityRole="button"
                  accessibilityLabel="Delete last character"
                  accessibilityHint="Press and hold to clear"
                  onPress={onBackspace}
                  onLongPress={onClear}
                  className={KEY_CLASS}
                >
                  <Delete className="text-fg dark:text-fg-dark" size={22} />
                </Pressable>
              );
            }

            const inert = key === "." && decimalInert;

            return (
              <Pressable
                key={key}
                testID={`keypad-key-${key}`}
                accessibilityRole="button"
                accessibilityLabel={key === "." ? "Decimal point" : key}
                accessibilityState={{ disabled: inert }}
                disabled={inert}
                onPress={inert ? undefined : () => onKey(key)}
                className={`${KEY_CLASS}${inert ? " opacity-30" : ""}`}
              >
                <Text className="text-2xl font-semibold text-fg dark:text-fg-dark">{key}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest components/ui/__tests__/numeric_keypad.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/components/ui/numeric_keypad.tsx mobile/components/ui/__tests__/numeric_keypad.test.tsx
git commit -m "feat(mobile): lay the keypad out as a phone keypad with a decimal key"
```

---

## Task 3: The keypad context and host registry

**Files:**
- Create: `mobile/contexts/keypad_context.tsx`
- Test: `mobile/contexts/__tests__/keypad_context.test.tsx`

**Interfaces:**
- Consumes: `KeypadMode` from `@/components/ui/numeric_keypad`.
- Produces: `KeypadProvider({ children })`; `useKeypad(): KeypadContextValue` where

```ts
type KeypadRequest = { fieldId: string; label: string; mode: KeypadMode; text: string };

type KeypadContextValue = {
  request: KeypadRequest | null;
  open: (request: KeypadRequest & { onChangeText: (text: string) => void }) => void;
  close: () => void;
  /** Host calls this on every key. Routes to the focused field's handler. */
  emit: (text: string) => void;
  /** Field calls this while focused so the panel never shows a stale value. */
  syncFocused: (fieldId: string, text: string, onChangeText: (text: string) => void) => void;
  registerHost: () => number;
  releaseHost: (token: number) => void;
  activeHost: number | null;
  keypadHeight: number;
  setKeypadHeight: (height: number) => void;
};
```

- [ ] **Step 1: Write the failing test**

Create `mobile/contexts/__tests__/keypad_context.test.tsx`:

```tsx
// mobile/contexts/__tests__/keypad_context.test.tsx — W1 Task 3.
//
// THE HOST REGISTRY IS WHY THIS FILE EXISTS. components/ui/bottom_sheet.tsx
// is built on the platform Modal, which is its own native window, so a keypad
// hosted once at the root renders BEHIND any open sheet -- and three numeric
// fields live inside sheets. The rule is "the most recently mounted host
// wins", and these tests pin it without a renderer for the panel itself.
import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { useEffect, useRef } from "react";

import { KeypadProvider, useKeypad } from "../keypad_context";

/** Mounts and holds a host token for as long as it is rendered. */
function FakeHost({ name }: { name: string }) {
  const { registerHost, releaseHost, activeHost } = useKeypad();
  const tokenRef = useRef<number | null>(null);

  useEffect(() => {
    const token = registerHost();
    tokenRef.current = token;
    return () => releaseHost(token);
  }, [registerHost, releaseHost]);

  const mine = tokenRef.current !== null && tokenRef.current === activeHost;
  return <Text testID={`host-${name}`}>{mine ? "active" : "idle"}</Text>;
}

function Probe() {
  const { request } = useKeypad();
  return <Text testID="probe">{request === null ? "closed" : request.fieldId}</Text>;
}

function state(): string {
  return String(screen.getByTestId("probe").props.children);
}

function hostState(name: string): string {
  return String(screen.getByTestId(`host-${name}`).props.children);
}

test("the most recently mounted host is the active one", () => {
  const { rerender } = render(
    <KeypadProvider>
      <Probe />
      <FakeHost name="root" />
    </KeypadProvider>,
  );

  expect(hostState("root")).toBe("active");

  rerender(
    <KeypadProvider>
      <Probe />
      <FakeHost name="root" />
      <FakeHost name="sheet" />
    </KeypadProvider>,
  );

  expect(hostState("sheet")).toBe("active");
  expect(hostState("root")).toBe("idle");
});

test("the root host takes over again when the sheet host unmounts", () => {
  const { rerender } = render(
    <KeypadProvider>
      <Probe />
      <FakeHost name="root" />
      <FakeHost name="sheet" />
    </KeypadProvider>,
  );

  rerender(
    <KeypadProvider>
      <Probe />
      <FakeHost name="root" />
    </KeypadProvider>,
  );

  expect(hostState("root")).toBe("active");
});

test("a sheet closing while the keypad is open closes the keypad", () => {
  // Not silently re-parented: a keypad that outlives the field it was editing
  // has nowhere to commit to.
  let openIt: () => void = () => {};

  function Opener() {
    const { open } = useKeypad();
    openIt = () =>
      open({ fieldId: "sheet-amount", label: "Amount", mode: "peso", text: "", onChangeText: () => {} });
    return null;
  }

  const { rerender } = render(
    <KeypadProvider>
      <Probe />
      <Opener />
      <FakeHost name="root" />
      <FakeHost name="sheet" />
    </KeypadProvider>,
  );

  act(() => openIt());
  expect(state()).toBe("sheet-amount");

  rerender(
    <KeypadProvider>
      <Probe />
      <Opener />
      <FakeHost name="root" />
    </KeypadProvider>,
  );

  expect(state()).toBe("closed");
});

test("emit routes keystrokes to the focused field's handler", () => {
  const onChangeText = jest.fn();
  let openIt: () => void = () => {};
  let emitIt: (text: string) => void = () => {};

  function Opener() {
    const { open, emit } = useKeypad();
    openIt = () => open({ fieldId: "a", label: "A", mode: "peso", text: "", onChangeText });
    emitIt = emit;
    return null;
  }

  render(
    <KeypadProvider>
      <Probe />
      <Opener />
    </KeypadProvider>,
  );

  act(() => openIt());
  act(() => emitIt("12"));

  expect(onChangeText).toHaveBeenCalledWith("12");
});

test("opening a second field swaps focus without closing", () => {
  let openA: () => void = () => {};
  let openB: () => void = () => {};

  function Opener() {
    const { open } = useKeypad();
    openA = () => open({ fieldId: "a", label: "A", mode: "peso", text: "", onChangeText: () => {} });
    openB = () => open({ fieldId: "b", label: "B", mode: "peso", text: "", onChangeText: () => {} });
    return null;
  }

  render(
    <KeypadProvider>
      <Probe />
      <Opener />
    </KeypadProvider>,
  );

  act(() => openA());
  act(() => openB());

  expect(state()).toBe("b");
});

test("close clears the request", () => {
  let openIt: () => void = () => {};
  let closeIt: () => void = () => {};

  function Opener() {
    const { open, close } = useKeypad();
    openIt = () => open({ fieldId: "a", label: "A", mode: "peso", text: "", onChangeText: () => {} });
    closeIt = close;
    return null;
  }

  render(
    <KeypadProvider>
      <Probe />
      <Opener />
    </KeypadProvider>,
  );

  act(() => openIt());
  act(() => closeIt());

  expect(state()).toBe("closed");
});

test("useKeypad outside a provider throws rather than silently no-opping", () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  function Bare() {
    useKeypad();
    return null;
  }
  expect(() => render(<Bare />)).toThrow("useKeypad must be used within KeypadProvider");
  spy.mockRestore();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest contexts/__tests__/keypad_context.test.tsx`
Expected: FAIL — `Cannot find module '../keypad_context'`.

- [ ] **Step 3: Write the implementation**

Create `mobile/contexts/keypad_context.tsx`:

```tsx
// mobile/contexts/keypad_context.tsx — W1 Task 3.
//
// TWO JOBS, AND THEY ARE GENUINELY SEPARATE.
//
// 1. WHICH FIELD IS FOCUSED. One at a time. Opening a second field while one
//    is open SWAPS the request rather than closing and reopening, because a
//    close/open animation between two adjacent amount fields reads as a
//    glitch rather than as focus moving.
//
// 2. WHICH HOST MAY DRAW. components/ui/bottom_sheet.tsx is built on the
//    platform Modal -- its own header says it is "its own native window: it
//    is NOT inside whatever View" rendered it -- so a panel hosted once at
//    the root renders BEHIND any open sheet. <KeypadHost /> is therefore
//    mountable more than once, each mount takes a monotonically increasing
//    token, and the highest live token wins. That is always the topmost
//    native window.
//
// WHY onChangeText LIVES IN A REF AND NOT IN STATE. Forms pass inline arrows,
// so the handler's identity changes on every render. Holding it in `request`
// would mean: provider re-renders -> field re-renders -> new arrow identity
// -> sync effect fires -> new request object -> provider re-renders. An
// infinite loop that only appears once a real form is wired up, which is
// exactly the kind of thing that ships. A ref write causes no re-render, so
// the cycle cannot start.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { KeypadMode } from "@/components/ui/numeric_keypad";

export type KeypadRequest = {
  /** The focused field's testID. Identity, not decoration — the field compares against it. */
  fieldId: string;
  label: string;
  mode: KeypadMode;
  text: string;
};

export type KeypadContextValue = {
  request: KeypadRequest | null;
  open: (request: KeypadRequest & { onChangeText: (text: string) => void }) => void;
  close: () => void;
  /** The host calls this with the next text on every key. */
  emit: (text: string) => void;
  /** The focused field calls this so the panel never renders a stale value. */
  syncFocused: (fieldId: string, text: string, onChangeText: (text: string) => void) => void;
  registerHost: () => number;
  releaseHost: (token: number) => void;
  activeHost: number | null;
  keypadHeight: number;
  setKeypadHeight: (height: number) => void;
};

const KeypadContext = createContext<KeypadContextValue | null>(null);

export function KeypadProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<KeypadRequest | null>(null);
  const [hosts, setHosts] = useState<readonly number[]>([]);
  const [keypadHeight, setKeypadHeight] = useState(0);

  const onChangeRef = useRef<((text: string) => void) | null>(null);
  const nextTokenRef = useRef(1);

  const activeHost = hosts.length === 0 ? null : Math.max(...hosts);

  // Mirrors activeHost for releaseHost, which must know whether the host
  // going away is the one currently holding the panel — and cannot read the
  // post-update value of its own setState.
  const activeHostRef = useRef<number | null>(null);
  activeHostRef.current = activeHost;

  const open = useCallback(
    ({ onChangeText, ...next }: KeypadRequest & { onChangeText: (text: string) => void }) => {
      onChangeRef.current = onChangeText;
      setRequest(next);
    },
    [],
  );

  const close = useCallback(() => {
    onChangeRef.current = null;
    setRequest(null);
  }, []);

  const emit = useCallback((text: string) => {
    onChangeRef.current?.(text);
  }, []);

  const syncFocused = useCallback(
    (fieldId: string, text: string, onChangeText: (next: string) => void) => {
      // Ref write first, and unconditionally: the handler may have a new
      // identity even when the text has not moved.
      onChangeRef.current = onChangeText;
      setRequest((current) => {
        if (current === null || current.fieldId !== fieldId) return current;
        // Returning the SAME object when nothing changed is what stops the
        // render loop described in this file's header.
        if (current.text === text) return current;
        return { ...current, text };
      });
    },
    [],
  );

  const registerHost = useCallback(() => {
    const token = nextTokenRef.current;
    nextTokenRef.current += 1;
    setHosts((previous) => [...previous, token]);
    return token;
  }, []);

  const releaseHost = useCallback((token: number) => {
    const wasActive = activeHostRef.current === token;
    setHosts((previous) => previous.filter((held) => held !== token));
    // A sheet closing while the keypad is open closes the keypad. Silently
    // re-parenting to the root host would leave a panel editing a field that
    // no longer exists.
    if (wasActive) {
      onChangeRef.current = null;
      setRequest(null);
    }
  }, []);

  const value = useMemo<KeypadContextValue>(
    () => ({
      request,
      open,
      close,
      emit,
      syncFocused,
      registerHost,
      releaseHost,
      activeHost,
      keypadHeight,
      setKeypadHeight,
    }),
    [request, open, close, emit, syncFocused, registerHost, releaseHost, activeHost, keypadHeight],
  );

  return <KeypadContext.Provider value={value}>{children}</KeypadContext.Provider>;
}

export function useKeypad(): KeypadContextValue {
  const context = useContext(KeypadContext);
  if (!context) throw new Error("useKeypad must be used within KeypadProvider");
  return context;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest contexts/__tests__/keypad_context.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/contexts/keypad_context.tsx mobile/contexts/__tests__/keypad_context.test.tsx
git commit -m "feat(mobile): track keypad focus and which host window may draw it"
```

---

## Task 4: The panel and its two mount points

**Files:**
- Create: `mobile/components/ui/keypad_host.tsx`
- Test: `mobile/components/ui/__tests__/keypad_host.test.tsx`
- Modify: `mobile/app/_layout.tsx` (add `KeypadProvider` + root `<KeypadHost />`)
- Modify: `mobile/components/ui/bottom_sheet.tsx` (add `<KeypadHost />` inside the `Modal`)

**Interfaces:**
- Consumes: `useKeypad` from Task 3; `NumericKeypad`, `KeypadMode` from Task 2; `appendKey`, `removeLastKey`, `formatPesoInput` from Task 1.
- Produces: `KeypadHost()`. TestIDs: `keypad-host`, `keypad-label`, `keypad-display`, `keypad-close`, `keypad-done`.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/ui/__tests__/keypad_host.test.tsx`:

```tsx
// mobile/components/ui/__tests__/keypad_host.test.tsx — W1 Task 4.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { BackHandler, Pressable, Text } from "react-native";
import { useEffect, useState } from "react";

import { KeypadProvider, useKeypad } from "@/contexts/keypad_context";
import { KeypadHost } from "../keypad_host";

/**
 * A field-shaped opener that keeps its own text, exactly as the real
 * NumericField does — including the sync effect, which is what keeps the
 * panel's copy of the text from going stale as the value grows.
 */
function Opener({
  fieldId = "amount",
  label = "Amount",
  mode = "peso" as const,
}: {
  fieldId?: string;
  label?: string;
  mode?: "peso" | "integer" | "rate";
}) {
  const { open, syncFocused, request } = useKeypad();
  const [text, setText] = useState("");
  const focused = request?.fieldId === fieldId;

  // In an effect, never during render: syncFocused calls setState, and doing
  // that in a render body is the warning-then-loop the real field avoids too.
  useEffect(() => {
    if (!focused) return;
    syncFocused(fieldId, text, setText);
  }, [focused, fieldId, text, syncFocused]);

  return (
    <>
      <Pressable
        testID={`open-${fieldId}`}
        onPress={() => open({ fieldId, label, mode, text, onChangeText: setText })}
      >
        <Text>open</Text>
      </Pressable>
      <Text testID={`value-${fieldId}`}>{text}</Text>
    </>
  );
}

function press(testID: string): void {
  fireEvent.press(screen.getByTestId(testID));
}

function display(): string {
  return String(screen.getByTestId("keypad-display").props.children);
}

function renderHost(mode: "peso" | "integer" | "rate" = "peso") {
  render(
    <KeypadProvider>
      <Opener mode={mode} />
      <KeypadHost />
    </KeypadProvider>,
  );
}

test("the panel is absent until a field opens it", () => {
  renderHost();

  expect(screen.queryByTestId("keypad-host")).toBeNull();

  press("open-amount");

  expect(screen.getByTestId("keypad-host")).toBeTruthy();
  expect(screen.getByTestId("keypad-label").props.children).toBe("Amount");
});

test("keystrokes build a peso amount and show it grouped", () => {
  renderHost();
  press("open-amount");

  for (const key of ["1", "0", "0", "0"]) press(`keypad-key-${key}`);

  expect(display()).toBe("₱1,000");
  expect(screen.getByTestId("value-amount").props.children).toBe("1000");
});

test("the decimal point survives as an intermediate state", () => {
  renderHost();
  press("open-amount");

  for (const key of ["1", "0", ".", "5"]) press(`keypad-key-${key}`);

  expect(display()).toBe("₱10.5");
});

test("backspace removes one character", () => {
  renderHost();
  press("open-amount");
  for (const key of ["1", "2", "3"]) press(`keypad-key-${key}`);

  press("keypad-backspace");

  expect(screen.getByTestId("value-amount").props.children).toBe("12");
});

test("long-pressing backspace clears", () => {
  renderHost();
  press("open-amount");
  for (const key of ["1", "2", "3"]) press(`keypad-key-${key}`);

  fireEvent(screen.getByTestId("keypad-backspace"), "longPress");

  expect(screen.getByTestId("value-amount").props.children).toBe("");
});

describe("dismissal", () => {
  // x and Done are the SAME action. The field commits on every keystroke, so
  // by the time either is pressed there is nothing uncommitted to discard.
  test("Done closes the panel and keeps the value", () => {
    renderHost();
    press("open-amount");
    for (const key of ["5", "0"]) press(`keypad-key-${key}`);

    press("keypad-done");

    expect(screen.queryByTestId("keypad-host")).toBeNull();
    expect(screen.getByTestId("value-amount").props.children).toBe("50");
  });

  test("x closes the panel and keeps the value, identically", () => {
    renderHost();
    press("open-amount");
    for (const key of ["5", "0"]) press(`keypad-key-${key}`);

    press("keypad-close");

    expect(screen.queryByTestId("keypad-host")).toBeNull();
    expect(screen.getByTestId("value-amount").props.children).toBe("50");
  });

  test("hardware back closes the panel and is consumed, not navigated", () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((_event, handler) => {
        handlers.push(handler as () => boolean);
        return { remove: () => {} } as never;
      });

    renderHost();
    press("open-amount");

    const consumed = handlers.map((handler) => handler());

    expect(consumed).toContain(true);
    expect(screen.queryByTestId("keypad-host")).toBeNull();
    spy.mockRestore();
  });
});

test("rate mode suffixes a percent sign", () => {
  renderHost("rate");
  press("open-amount");

  for (const key of ["1", "2"]) press(`keypad-key-${key}`);

  expect(display()).toBe("12%");
});

test("integer mode shows the raw number and refuses the decimal key", () => {
  renderHost("integer");
  press("open-amount");

  for (const key of ["6"]) press(`keypad-key-${key}`);
  press("keypad-key-.");

  expect(display()).toBe("6");
  expect(screen.getByTestId("value-amount").props.children).toBe("6");
});

test("only the most recently mounted host draws the panel", () => {
  render(
    <KeypadProvider>
      <Opener />
      <KeypadHost />
      <KeypadHost />
    </KeypadProvider>,
  );

  press("open-amount");

  // Two hosts are mounted; exactly one renders.
  expect(screen.getAllByTestId("keypad-host")).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest components/ui/__tests__/keypad_host.test.tsx`
Expected: FAIL — `Cannot find module '../keypad_host'`.

- [ ] **Step 3: Write the host**

Create `mobile/components/ui/keypad_host.tsx`:

```tsx
// mobile/components/ui/keypad_host.tsx — W1 Task 4.
//
// MOUNTED MORE THAN ONCE, ON PURPOSE. Once in app/_layout.tsx beside the
// Stack, and once inside bottom_sheet.tsx's Modal. contexts/keypad_context.tsx
// hands out a token per mount and only the highest live token renders, which
// is always the topmost native window. See that file's header for why a
// single root host cannot work.
//
// NO SCRIM, DELIBERATELY. The obvious design is a translucent full-screen
// backdrop that closes on tap, and it is wrong here: these forms are dense --
// the manual-entry sheet has direction toggles, a wallet picker, a category
// picker and a date field all above the amount -- and a scrim turns every one
// of those taps into a DISMISSAL instead of the action the user intended. The
// panel takes the bottom band; everything above it stays live and directly
// tappable. The cost is that tapping the background does nothing, which is
// what x, Done and hardware back are for.
//
// HARDWARE BACK IS CONSUMED WHILE OPEN. Without returning true from the
// handler, a user's first back press leaves the screen they are halfway
// through filling in.
import { useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { cssInterop } from "nativewind";

import { useKeypad } from "@/contexts/keypad_context";
import { appendKey, formatPesoInput, removeLastKey } from "@/lib/money/peso_input";
import { NumericKeypad, type KeypadMode } from "./numeric_keypad";

cssInterop(X, { className: { target: "style", nativeStyleToProp: { color: true } } });

/** What the panel's big read-out shows for the text being typed. */
function displayFor(mode: KeypadMode, text: string): string {
  if (mode === "peso") return formatPesoInput(text);
  if (mode === "rate") return `${text === "" ? "0" : text}%`;
  return text === "" ? "0" : text;
}

export function KeypadHost() {
  const { request, close, emit, registerHost, releaseHost, activeHost, setKeypadHeight } =
    useKeypad();
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState<number | null>(null);

  useEffect(() => {
    const mine = registerHost();
    setToken(mine);
    return () => releaseHost(mine);
  }, [registerHost, releaseHost]);

  const visible = request !== null && token !== null && token === activeHost;

  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true; // consumed — never a navigation
    });
    return () => subscription.remove();
  }, [visible, close]);

  // React Native's own Animated, not reanimated: a fade-and-rise needs no
  // worklet, and the project has no reanimated jest mock configured.
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, {
      toValue: visible ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [visible, rise]);

  useEffect(() => {
    if (!visible) setKeypadHeight(0);
  }, [visible, setKeypadHeight]);

  if (!visible || request === null) return null;

  return (
    <Animated.View
      testID="keypad-host"
      onLayout={(event) => setKeypadHeight(event.nativeEvent.layout.height)}
      className="absolute inset-x-0 bottom-0 gap-3 rounded-t-3xl bg-bg p-4 dark:bg-bg-dark"
      style={{
        paddingBottom: insets.bottom + 16,
        opacity: rise,
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
      }}
    >
      <View className="flex-row items-center justify-between">
        <Text testID="keypad-label" className="font-semibold text-fg dark:text-fg-dark">
          {request.label}
        </Text>
        <View className="flex-row items-center gap-2">
          {/* x and Done do the same thing. Two affordances because the panel
              reads as a dialog to some users and as a keyboard to others, and
              losing either group to a panel they cannot dismiss is worse than
              a small redundancy. Do NOT later make x a revert — that is an
              undo feature, and it turns two identical-looking buttons into a
              safe one and a destructive one with no cue telling them apart. */}
          <Pressable
            testID="keypad-close"
            accessibilityRole="button"
            accessibilityLabel="Close keypad"
            onPress={close}
            className="h-10 w-10 items-center justify-center rounded-full bg-surface dark:bg-surface-dark"
          >
            <X className="text-fg dark:text-fg-dark" size={18} />
          </Pressable>
          <Pressable
            testID="keypad-done"
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={close}
            className="rounded-xl bg-brand px-4 py-2 dark:bg-brand-dark"
          >
            <Text className="font-semibold text-on-brand dark:text-on-brand-dark">Done</Text>
          </Pressable>
        </View>
      </View>

      <Text
        testID="keypad-display"
        className="text-center text-4xl font-bold text-fg dark:text-fg-dark"
      >
        {displayFor(request.mode, request.text)}
      </Text>

      <NumericKeypad
        mode={request.mode}
        onKey={(key) => emit(appendKey(request.text, key))}
        onBackspace={() => emit(removeLastKey(request.text))}
        onClear={() => emit("")}
      />
    </Animated.View>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest components/ui/__tests__/keypad_host.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount the provider and the root host**

In `mobile/app/_layout.tsx`, wrap the existing provider stack. The current tree is `KeyboardProvider > ThemeProvider > LockProvider > …`; add `KeypadProvider` directly inside `LockProvider` so the keypad is available to every screen but is torn down with the lock:

```tsx
import { KeypadProvider } from "@/contexts/keypad_context";
import { KeypadHost } from "@/components/ui/keypad_host";

// ...

  return (
    <KeyboardProvider>
      <ThemeProvider>
        <LockProvider>
          <KeypadProvider>
            <RootLayoutInner />
          </KeypadProvider>
        </LockProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
```

And in the inner component that renders the `Stack` (the `return` around line 309), add the host as a sibling **after** the `Stack` so it paints above it:

```tsx
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {/* ...existing providers... */}
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />
        <KeypadHost />
      {/* ... */}
    </PersistQueryClientProvider>
```

- [ ] **Step 6: Mount the sheet host**

In `mobile/components/ui/bottom_sheet.tsx`, render a host as the last child inside the `Modal`, after the sheet's own content:

```tsx
import { KeypadHost } from "./keypad_host";

// ...inside the <Modal>, after the sheet body:
        <KeypadHost />
      </Modal>
```

Add a comment above it explaining why a second host exists:

```tsx
{/* A SECOND HOST, NOT A DUPLICATE. This Modal is its own native window, so
    the root host in app/_layout.tsx paints behind it. keypad_context.tsx
    gives the most recently mounted host the panel, which while this sheet is
    open is this one. */}
```

- [ ] **Step 7: Run the full suite**

Run: `cd mobile && npm test`
Expected: PASS. `app/__tests__/root_layout.test.tsx` may need the new providers accounted for; if it asserts on the provider tree, update it to expect `KeypadProvider`.

- [ ] **Step 8: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/components/ui/keypad_host.tsx mobile/components/ui/__tests__/keypad_host.test.tsx mobile/app/_layout.tsx mobile/components/ui/bottom_sheet.tsx
git commit -m "feat(mobile): float the keypad over the topmost window"
```

---

## Task 5: The numeric field

**Files:**
- Create: `mobile/components/ui/numeric_field.tsx`
- Test: `mobile/components/ui/__tests__/numeric_field.test.tsx`

**Interfaces:**
- Consumes: `useKeypad` from Task 3; `formatPesoInput` from Task 1; `KeypadMode` from Task 2.
- Produces: `NumericField(props: { testID: string; label: string; value: string; onChangeText: (text: string) => void; mode?: KeypadMode; placeholder?: string })`. Props deliberately mirror the `TextInput` shape the forms already use, so migration is a component swap rather than a state rewrite.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/ui/__tests__/numeric_field.test.tsx`:

```tsx
// mobile/components/ui/__tests__/numeric_field.test.tsx — W1 Task 5.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { TextInput } from "react-native";
import { useState } from "react";

import { KeypadProvider } from "@/contexts/keypad_context";
import { KeypadHost } from "../keypad_host";
import { NumericField } from "../numeric_field";

function Harness({ initial = "", mode = "peso" as const }) {
  const [value, setValue] = useState(initial);
  return (
    <KeypadProvider>
      <NumericField
        testID="amount"
        label="How much?"
        mode={mode}
        placeholder="Amount"
        value={value}
        onChangeText={setValue}
      />
      <KeypadHost />
    </KeypadProvider>
  );
}

test("THE GUARANTEE: the field renders no TextInput, so no OS keyboard can appear", () => {
  // showSoftInputOnFocus={false} on a real TextInput is the other way to do
  // this, and it is a prop one future edit can drop. A tree with no text
  // input in it cannot raise a keyboard no matter what anyone does later.
  render(<Harness />);

  expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
});

test("pressing the field opens the keypad with its label and mode", () => {
  render(<Harness />);

  fireEvent.press(screen.getByTestId("amount"));

  expect(screen.getByTestId("keypad-host")).toBeTruthy();
  expect(screen.getByTestId("keypad-label").props.children).toBe("How much?");
});

test("keystrokes flow back into the field's own value", () => {
  render(<Harness />);
  fireEvent.press(screen.getByTestId("amount"));

  for (const key of ["1", "0", "0", "0"]) {
    fireEvent.press(screen.getByTestId(`keypad-key-${key}`));
  }

  expect(screen.getByText("₱1,000")).toBeTruthy();
});

test("the panel stays in sync as the value grows", () => {
  render(<Harness />);
  fireEvent.press(screen.getByTestId("amount"));

  for (const key of ["9", "9"]) {
    fireEvent.press(screen.getByTestId(`keypad-key-${key}`));
  }

  expect(String(screen.getByTestId("keypad-display").props.children)).toBe("₱99");
});

test("an empty field shows its placeholder", () => {
  render(<Harness />);

  expect(screen.getByText("Amount")).toBeTruthy();
});

test("a seeded field shows the formatted amount", () => {
  render(<Harness initial="1000.50" />);

  expect(screen.getByText("₱1,000.50")).toBeTruthy();
});

test("integer mode shows the raw number, unformatted", () => {
  render(<Harness initial="6" mode="integer" />);

  expect(screen.getByText("6")).toBeTruthy();
});

test("the field is announced with its label and value", () => {
  render(<Harness initial="1000" />);

  expect(screen.getByLabelText("How much?, ₱1,000")).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest components/ui/__tests__/numeric_field.test.tsx`
Expected: FAIL — `Cannot find module '../numeric_field'`.

- [ ] **Step 3: Write the implementation**

Create `mobile/components/ui/numeric_field.tsx`:

```tsx
// mobile/components/ui/numeric_field.tsx — W1 Task 5.
//
// A Pressable. NOT a TextInput, and that is the entire mechanism.
//
// The alternative is a real TextInput with showSoftInputOnFocus={false}, and
// it works -- until someone refactors the props, or a platform ignores the
// flag, or an autofill path routes around it. A component with no text input
// anywhere in its tree cannot raise a keyboard however it is later edited,
// which turns "the OS keypad never appears on a number field" from a
// convention into a property. __tests__/numeric_field.test.tsx asserts it
// directly.
//
// THE PROPS MIRROR TextInput ON PURPOSE. Every form this replaces already
// holds its numeric state as a string and passes value/onChangeText; keeping
// that exact shape makes each migration a component swap rather than a state
// rewrite, which is what keeps eighteen form-test rewrites mechanical.
//
// THE COST, STATED: no caret, no selection, no paste. The keypad's
// press-to-backspace and hold-to-clear cover correction. A paste path is a
// later workstream, not something to smuggle in here.
import { useEffect } from "react";
import { Pressable, Text } from "react-native";

import { useKeypad } from "@/contexts/keypad_context";
import { formatPesoInput } from "@/lib/money/peso_input";
import type { KeypadMode } from "./numeric_keypad";

export type NumericFieldProps = {
  /** Also the focus identity the context compares against — must be unique on screen. */
  testID: string;
  /** Shown in the panel header and read by screen readers. */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  mode?: KeypadMode;
  placeholder?: string;
};

function shownFor(mode: KeypadMode, value: string): string {
  if (mode === "peso") return formatPesoInput(value);
  if (mode === "rate") return `${value}%`;
  return value;
}

export function NumericField({
  testID,
  label,
  value,
  onChangeText,
  mode = "peso",
  placeholder = "",
}: NumericFieldProps) {
  const { request, open, syncFocused } = useKeypad();
  const focused = request?.fieldId === testID;

  // While focused, keep the panel's copy of the text equal to ours. The
  // context holds onChangeText in a ref, so this cannot loop — see its header.
  useEffect(() => {
    if (!focused) return;
    syncFocused(testID, value, onChangeText);
  }, [focused, testID, value, onChangeText, syncFocused]);

  const empty = value === "";
  const shown = empty ? placeholder : shownFor(mode, value);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={empty ? label : `${label}, ${shown}`}
      accessibilityState={{ selected: focused }}
      onPress={() => open({ fieldId: testID, label, mode, text: value, onChangeText })}
      className={`mt-2 rounded-xl bg-surface p-3 dark:bg-surface-dark${
        focused ? " border border-brand dark:border-brand-dark" : ""
      }`}
    >
      <Text className={empty ? "text-fg-2 dark:text-fg-2-dark" : "text-fg dark:text-fg-dark"}>
        {shown}
      </Text>
    </Pressable>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest components/ui/__tests__/numeric_field.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/components/ui/numeric_field.tsx mobile/components/ui/__tests__/numeric_field.test.tsx
git commit -m "feat(mobile): add a numeric field the OS keyboard cannot reach"
```

---

## Task 6: The shared test helper

**Files:**
- Create: `mobile/test_support/keypad.ts`

**Interfaces:**
- Consumes: `@testing-library/react-native`.
- Produces: `openKeypad(testID: string): void`; `typeAmount(testID: string, text: string): void`; `clearAmount(testID: string): void`; `closeKeypad(): void`. Every migrated form test in Tasks 9–14 uses these and nothing else.

**Why this is its own task:** twenty-nine test files use `fireEvent.changeText`, and roughly eighteen drive a numeric or date field. Without one helper written first, the migration becomes eighteen separately-invented ways to drive a keypad, and every later change to the panel's testIDs breaks all of them. This is the single most likely way for W1 to cost three times its estimate.

- [ ] **Step 1: Write the helper**

Create `mobile/test_support/keypad.ts`:

```ts
// mobile/test_support/keypad.ts — W1 Task 6.
//
// THE ONE WAY FORM TESTS DRIVE A NUMERIC FIELD. Before W1 they called
// fireEvent.changeText on a TextInput; components/ui/numeric_field.tsx has no
// TextInput, so every one of them needs a new verb. Eighteen files inventing
// that verb separately is eighteen things to fix the next time the panel's
// testIDs move.
//
// Requires the tree under test to be wrapped in KeypadProvider with a
// KeypadHost mounted — components/ui/__tests__/numeric_field.test.tsx shows
// the shape.
import { fireEvent, screen } from "@testing-library/react-native";

/** Focuses a NumericField, raising the panel. */
export function openKeypad(testID: string): void {
  fireEvent.press(screen.getByTestId(testID));
}

/** Closes the panel the way a user does. Values are already committed. */
export function closeKeypad(): void {
  fireEvent.press(screen.getByTestId("keypad-done"));
}

/**
 * Focuses `testID` and presses `text` one character at a time, then closes.
 *
 * Types the characters rather than setting the value, so every test exercises
 * the same appendKey rules the user does — including the refusals. A test
 * that sets "10.555" directly would pass against a field that cannot actually
 * be typed into that way.
 */
export function typeAmount(testID: string, text: string): void {
  openKeypad(testID);
  for (const key of text) {
    fireEvent.press(screen.getByTestId(`keypad-key-${key}`));
  }
  closeKeypad();
}

/** Focuses `testID`, long-presses backspace to clear, then closes. */
export function clearAmount(testID: string): void {
  openKeypad(testID);
  fireEvent(screen.getByTestId("keypad-backspace"), "longPress");
  closeKeypad();
}
```

- [ ] **Step 2: Verify it typechecks and nothing regressed**

Run: `cd mobile && npx tsc --noEmit && npm test`
Expected: PASS. The helper has no test of its own — Tasks 9–14 are its tests.

- [ ] **Step 3: Commit**

```bash
git add mobile/test_support/keypad.ts
git commit -m "test(mobile): add one shared way to drive the keypad from form tests"
```

---

## Task 7: The keyboard- and keypad-aware form wrapper

**Files:**
- Create: `mobile/components/ui/form_screen.tsx`
- Test: `mobile/components/ui/__tests__/form_screen.test.tsx`

**Interfaces:**
- Consumes: `KeyboardAwareScrollView` from `react-native-keyboard-controller` (already mocked in `test_support/jest_setup.ts`); `useKeypad` from Task 3.
- Produces: `FormScreen({ children, testID }: { children: ReactNode; testID?: string })`.

- [ ] **Step 1: Write the failing test**

Create `mobile/components/ui/__tests__/form_screen.test.tsx`:

```tsx
// mobile/components/ui/__tests__/form_screen.test.tsx — W1 Task 7.
//
// KeyboardProvider has been mounted in app/_layout.tsx since before W1 and
// nothing consumed it: there was not one KeyboardAvoidingView,
// KeyboardAwareScrollView or keyboardShouldPersistTaps anywhere in the app,
// which is why the Save button on every long form sat under the keyboard.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { KeypadProvider } from "@/contexts/keypad_context";
import { KeypadHost } from "../keypad_host";
import { NumericField } from "../numeric_field";
import { FormScreen } from "../form_screen";

test("renders its children inside a scroll container", () => {
  render(
    <KeypadProvider>
      <FormScreen>
        <Text>body</Text>
      </FormScreen>
    </KeypadProvider>,
  );

  expect(screen.getByTestId("form-screen")).toBeTruthy();
  expect(screen.getByText("body")).toBeTruthy();
});

test("taps land on the first press while something is focused", () => {
  // keyboardShouldPersistTaps='handled': without it the first tap on a chip
  // or a Save button is eaten by the dismissal.
  render(
    <KeypadProvider>
      <FormScreen>
        <Text>body</Text>
      </FormScreen>
    </KeypadProvider>,
  );

  expect(screen.getByTestId("form-screen").props.keyboardShouldPersistTaps).toBe("handled");
});

test("pads the bottom by the keypad's height once it is open", () => {
  function Harness() {
    return (
      <KeypadProvider>
        <FormScreen>
          <NumericField testID="amount" label="Amount" value="" onChangeText={() => {}} />
        </FormScreen>
        <KeypadHost />
      </KeypadProvider>
    );
  }
  render(<Harness />);

  fireEvent.press(screen.getByTestId("amount"));
  fireEvent(screen.getByTestId("keypad-host"), "layout", {
    nativeEvent: { layout: { height: 320, width: 400, x: 0, y: 0 } },
  });

  const padding = screen.getByTestId("form-screen").props.contentContainerStyle.paddingBottom;
  expect(padding).toBeGreaterThanOrEqual(320);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd mobile && npx jest components/ui/__tests__/form_screen.test.tsx`
Expected: FAIL — `Cannot find module '../form_screen'`.

- [ ] **Step 3: Write the implementation**

Create `mobile/components/ui/form_screen.tsx`:

```tsx
// mobile/components/ui/form_screen.tsx — W1 Task 7.
//
// THE INFRASTRUCTURE WAS ALREADY PAID FOR. KeyboardProvider from
// react-native-keyboard-controller has been mounted in app/_layout.tsx since
// before W1; what was missing was any consumer. This is that consumer, and it
// is one wrapper rather than per-screen logic so the eight long forms behind
// the "buried input" screenshots cannot each get it slightly wrong.
//
// IT AVOIDS BOTH KEYBOARDS. KeyboardAwareScrollView handles the system one
// with no configuration. Our own panel is not a keyboard as far as the OS is
// concerned, so its height comes from contexts/keypad_context.tsx and is
// applied as bottom padding here. Without that second half, the keypad simply
// reproduces the burial problem it was built to fix.
import type { ReactNode } from "react";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

import { useKeypad } from "@/contexts/keypad_context";

/** Breathing room under the last control, on top of whatever is covering it. */
const BASE_PADDING = 24;

export function FormScreen({
  children,
  testID = "form-screen",
}: {
  children: ReactNode;
  testID?: string;
}) {
  const { keypadHeight } = useKeypad();

  return (
    <KeyboardAwareScrollView
      testID={testID}
      // 'handled', not 'always': a tap on a chip or Save must register on the
      // FIRST press rather than being spent dismissing whatever is focused.
      keyboardShouldPersistTaps="handled"
      bottomOffset={BASE_PADDING}
      contentContainerStyle={{ paddingBottom: keypadHeight + BASE_PADDING }}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd mobile && npx jest components/ui/__tests__/form_screen.test.tsx`
Expected: PASS. If the keyboard-controller jest mock does not forward `testID`, assert on `screen.getByText("body")`'s parent instead and adjust the padding assertion to read the mock's recorded props.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/components/ui/form_screen.tsx mobile/components/ui/__tests__/form_screen.test.tsx
git commit -m "feat(mobile): keep focused fields clear of both keyboards"
```

---

## Task 8: The date field

**Files:**
- Create: `mobile/components/ui/date_field.tsx`
- Test: `mobile/components/ui/__tests__/date_field.test.tsx`
- Modify: `mobile/package.json` (add `@react-native-community/datetimepicker`)

**Interfaces:**
- Consumes: `IsoDate` from `@/types/domain`.
- Produces: `DateField(props: { testID: string; label: string; value: IsoDate | null; onChange: (value: IsoDate) => void; placeholder?: string; minimumDate?: Date; maximumDate?: Date })`.

- [ ] **Step 1: Install the dependency**

```bash
cd mobile && npx expo install @react-native-community/datetimepicker
```

This is a native module. Note in the commit message that a **dev-client rebuild** is required — a JS reload will not pick it up.

- [ ] **Step 2: Write the failing test**

Create `mobile/components/ui/__tests__/date_field.test.tsx`:

```tsx
// mobile/components/ui/__tests__/date_field.test.tsx — W1 Task 8.
//
// NO Date OBJECT CROSSES THE BOUNDARY, and nothing calls toISOString. That
// method is UTC, so for a UTC+8 user near midnight it names the wrong
// calendar day -- the exact class of bug lib/dates.ts's header warns about.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

import { DateField } from "../date_field";

jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable, Text } = require("react-native");
  return {
    __esModule: true,
    default: ({ onChange, value }: { onChange: (event: unknown, date?: Date) => void; value: Date }) => (
      <>
        <Pressable
          testID="picker-pick"
          onPress={() => onChange({ type: "set" }, new Date(2026, 8, 30))}
        >
          <Text>pick</Text>
        </Pressable>
        <Pressable testID="picker-cancel" onPress={() => onChange({ type: "dismissed" }, undefined)}>
          <Text>cancel</Text>
        </Pressable>
        <Text testID="picker-value">{`${value.getFullYear()}`}</Text>
      </>
    ),
  };
});

function Harness({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <DateField
      testID="due"
      label="First payment due"
      placeholder="Pick a date"
      value={value}
      onChange={setValue}
    />
  );
}

test("an empty field shows its placeholder and no picker", () => {
  render(<Harness />);

  expect(screen.getByText("Pick a date")).toBeTruthy();
  expect(screen.queryByTestId("picker-pick")).toBeNull();
});

test("pressing the field opens the picker", () => {
  render(<Harness />);

  fireEvent.press(screen.getByTestId("due"));

  expect(screen.getByTestId("picker-pick")).toBeTruthy();
});

test("choosing a date yields a local YYYY-MM-DD and closes the picker", () => {
  render(<Harness />);
  fireEvent.press(screen.getByTestId("due"));

  fireEvent.press(screen.getByTestId("picker-pick"));

  expect(screen.getByText("2026-09-30")).toBeTruthy();
  expect(screen.queryByTestId("picker-pick")).toBeNull();
});

test("cancelling leaves the value alone", () => {
  render(<Harness initial="2026-08-19" />);
  fireEvent.press(screen.getByTestId("due"));

  fireEvent.press(screen.getByTestId("picker-cancel"));

  expect(screen.getByText("2026-08-19")).toBeTruthy();
});

test("the field is announced with its label and value", () => {
  render(<Harness initial="2026-08-19" />);

  expect(screen.getByLabelText("First payment due, 2026-08-19")).toBeTruthy();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd mobile && npx jest components/ui/__tests__/date_field.test.tsx`
Expected: FAIL — `Cannot find module '../date_field'`.

- [ ] **Step 4: Write the implementation**

Create `mobile/components/ui/date_field.tsx`:

```tsx
// mobile/components/ui/date_field.tsx — W1 Task 8. Replaces the five
// placeholder="YYYY-MM-DD" TextInputs the app shipped with.
//
// IsoDate IN, IsoDate OUT. No Date object crosses this boundary and nothing
// here calls toISOString: that method is UTC, and for a UTC+8 user picking a
// date late in the evening it names YESTERDAY. The conversion below reads the
// local calendar fields off the Date the picker hands back, which is the same
// rule components/transactions/day_group_header.tsx already follows.
import { useState } from "react";
import { Pressable, Text } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";

import type { IsoDate } from "@/types/domain";

/** A Date -> the LOCAL calendar day it names. Never toISOString. */
function isoDateFrom(date: Date): IsoDate {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `'YYYY-MM-DD'` -> a local Date at midnight, or today when absent/unparseable. */
function dateFrom(value: IsoDate | null): Date {
  if (value === null) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

export type DateFieldProps = {
  testID: string;
  label: string;
  value: IsoDate | null;
  onChange: (value: IsoDate) => void;
  placeholder?: string;
  /** Bounds are per-field on purpose: "any date" is wrong on every one of these. */
  minimumDate?: Date;
  maximumDate?: Date;
};

export function DateField({
  testID,
  label,
  value,
  onChange,
  placeholder = "",
  minimumDate,
  maximumDate,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const empty = value === null || value === "";

  return (
    <>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={empty ? label : `${label}, ${value}`}
        onPress={() => setOpen(true)}
        className="mt-2 rounded-xl bg-surface p-3 dark:bg-surface-dark"
      >
        <Text className={empty ? "text-fg-2 dark:text-fg-2-dark" : "text-fg dark:text-fg-dark"}>
          {empty ? placeholder : value}
        </Text>
      </Pressable>

      {open ? (
        <DateTimePicker
          value={dateFrom(value)}
          mode="date"
          display="default"
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onChange={(event, picked) => {
            // Android's dialog closes itself; the component must be unmounted
            // either way or the next press re-opens nothing.
            setOpen(false);
            if (event.type !== "set" || picked === undefined) return;
            onChange(isoDateFrom(picked));
          }}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npx jest components/ui/__tests__/date_field.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/components/ui/date_field.tsx mobile/components/ui/__tests__/date_field.test.tsx mobile/package.json mobile/package-lock.json
git commit -m "feat(mobile): pick dates from a calendar instead of typing YYYY-MM-DD

Adds @react-native-community/datetimepicker, a native module — the dev
client needs rebuilding, a JS reload will not pick it up."
```

---

## Tasks 9–14: Migration

Every migration task follows the same five steps. They are written out in full for Task 9; Tasks 10–14 give the exact field list and the specifics that differ, and repeat the step shape.

**The mechanical substitution, in both directions:**

| Before | After |
|---|---|
| `<TextInput testID="x" keyboardType="numeric" className="…" placeholder="P" value={v} onChangeText={set} />` | `<NumericField testID="x" label="…" placeholder="P" value={v} onChangeText={set} />` |
| `centavosFromDigits(v)` | `centavosFrom(v)` |
| `import { centavosFromDigits } from "@/components/ui/amount_text"` | `import { centavosFrom } from "@/lib/money/peso_input"` |
| `fireEvent.changeText(screen.getByTestId("x"), "1000")` | `typeAmount("x", "1000")` |
| `<TextInput placeholder="YYYY-MM-DD" … />` | `<DateField testID="…" label="…" placeholder="Pick a date" value={v} onChange={set} />` |

`label` is the question already rendered above the field — reuse that exact string so the panel header and the screen agree.

**Every migrated test file must wrap its subject:**

```tsx
import { KeypadProvider } from "@/contexts/keypad_context";
import { KeypadHost } from "@/components/ui/keypad_host";

function renderForm(ui: React.ReactElement) {
  return render(
    <KeypadProvider>
      {ui}
      <KeypadHost />
    </KeypadProvider>,
  );
}
```

---

### Task 9: Manual entry

**Files:**
- Modify: `mobile/components/transactions/manual_entry_form.tsx` (amount via keypad, date at `:251`)
- Modify: `mobile/app/transaction/new.tsx` (wrap in `FormScreen`, auto-open the keypad on mount)
- Test: `mobile/components/transactions/__tests__/manual_entry_form.test.tsx`, `mobile/app/__tests__/transaction_new.test.tsx`

**Interfaces:**
- Consumes: `NumericField` (Task 5), `DateField` (Task 8), `FormScreen` (Task 7), `typeAmount` (Task 6), `centavosFrom` (Task 1).
- Produces: nothing new.

- [ ] **Step 1: Update the tests to drive the keypad**

In both test files, wrap the subject as shown above, replace `fireEvent.changeText` on the amount with `typeAmount("…", "…")`, and replace date `changeText` with `fireEvent.press` on the date field followed by the mocked picker. Add one test naming the behaviour change:

```tsx
test("typing 1000 records one thousand pesos, not ten", () => {
  renderForm(<ManualEntryForm {...props} />);

  typeAmount("manual-amount", "1000");

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ amount: 100_000 }));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd mobile && npx jest components/transactions/__tests__/manual_entry_form.test.tsx app/__tests__/transaction_new.test.tsx`
Expected: FAIL — the testIDs resolve to a `Pressable` with no `changeText`, and the amount assertion is off by 100.

- [ ] **Step 3: Migrate the component**

Swap the amount `TextInput` for `NumericField` and the `YYYY-MM-DD` input at `:251` for `DateField` with `maximumDate={new Date()}` (a manual transaction is something that already happened). Replace `centavosFromDigits` with `centavosFrom`. Delete the now-unused `AmountNumpad` import and its inline render — `app/transaction/new.tsx` opens the hosted panel on mount instead:

```tsx
// The amount is deliberately the first and only thing on screen (m1c rule 1),
// so the panel is already up when the screen appears. Same landing state as
// the inline numpad this replaces, one code path instead of two, and it
// inherits FormScreen's avoidance so Save stops hiding.
useEffect(() => {
  open({ fieldId: "manual-amount", label: "How much?", mode: "peso", text: amount, onChangeText: setAmount });
  // Mount only: re-opening on every amount change would fight a user who
  // dismissed the panel to reach the category picker.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd mobile && npx jest components/transactions/__tests__/manual_entry_form.test.tsx app/__tests__/transaction_new.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/components/transactions/manual_entry_form.tsx mobile/app/transaction/new.tsx mobile/components/transactions/__tests__/manual_entry_form.test.tsx mobile/app/__tests__/transaction_new.test.tsx
git commit -m "feat(mobile): enter manual transactions in pesos on the shared keypad"
```

---

### Task 10: Loans

**Files:**
- Modify: `mobile/components/loans/loan_form.tsx`
- Test: `mobile/components/loans/__tests__/loan_form.test.tsx`, `mobile/app/__tests__/loan_routes.test.tsx`

**Fields — all six, and this is the only form that uses all three modes:**

| testID | Line | Mode | Label |
|---|---|---|---|
| `loan-principal` | 169 | `peso` | How much? |
| `loan-rate` | 207 | `rate` | Annual rate |
| `loan-term` | 215 | `integer` | Months |
| `loan-installment` | 234 | `peso` | Each payment |
| `loan-count` | 242 | `integer` | How many payments |
| `loan-interval` | 250 | `integer` | Days between payments |

Plus `DateField` for `:269` "First payment due", `minimumDate={new Date()}`.

Wrap the whole form in `FormScreen` — this is the screen in the `focused-inputs-are-getting-burried` screenshots.

- [ ] **Step 1: Update the tests** — wrap the subject, swap `changeText` for `typeAmount`, and add:

```tsx
test("a P13,437.72 loan is entered as 13437.72", () => {
  renderForm(<LoanForm {...props} />);

  typeAmount("loan-principal", "13437.72");

  expect(screen.getByTestId("loan-principal-preview").props.children).toBe("₱13,437.72");
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `cd mobile && npx jest components/loans app/__tests__/loan_routes.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Migrate the component** using the substitution table above, keeping `rateText`, `termText`, `countText` and `intervalText` as the same string state they already are.
- [ ] **Step 4: Run to verify they pass.** Run: `cd mobile && npx jest components/loans app/__tests__/loan_routes.test.tsx` — Expected: PASS.
- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/components/loans mobile/app/__tests__/loan_routes.test.tsx
git commit -m "feat(mobile): move the loan form onto the keypad and a date picker"
```

---

### Task 11: Bills and goals

**Files:**
- Modify: `mobile/components/bills/bill_form.tsx` (`:132`, `peso`), `mobile/components/bills/due_rule_picker.tsx` (`:240`, `integer`), `mobile/components/goals/goal_form.tsx` (`:74` and `:169`, both `peso`; `:94` → `DateField`, `minimumDate={new Date()}`), `mobile/components/goals/allocation_sheet.tsx` (`:105`, `peso`)
- Test: `mobile/components/bills/__tests__/bill_form.test.tsx`, `mobile/components/goals/__tests__/allocation_sheet.test.tsx`, `mobile/app/__tests__/bills_screen.test.tsx`, `mobile/app/__tests__/goal_routes.test.tsx`

`allocation_sheet.tsx` renders inside `BottomSheet` — this is the first task to exercise Task 4's second host. Assert it directly:

```tsx
test("the keypad draws above the sheet, not behind it", () => {
  renderForm(<AllocationSheet {...props} visible />);

  typeAmount("allocation-amount", "500");

  expect(screen.getByText("₱500")).toBeTruthy();
});
```

- [ ] **Step 1: Update the four test files** — wrap subjects, swap to `typeAmount`, add the sheet assertion above.
- [ ] **Step 2: Run to verify they fail.** Run: `cd mobile && npx jest components/bills components/goals app/__tests__/bills_screen.test.tsx app/__tests__/goal_routes.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Migrate the four components**, wrapping `bill_form` and `goal_form` in `FormScreen`.
- [ ] **Step 4: Run to verify they pass.** Same command — Expected: PASS.
- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/components/bills mobile/components/goals mobile/app/__tests__/bills_screen.test.tsx mobile/app/__tests__/goal_routes.test.tsx
git commit -m "feat(mobile): move the bill and goal forms onto the keypad"
```

---

### Task 12: Limits, income and onboarding

**Files:**
- Modify: `mobile/app/(tabs)/plan/limits/new.tsx` (`limit-amount` `:153` `peso`; `limit-percent` `:169` `rate`), `mobile/components/onboarding/first_limit_form.tsx` (`first-limit-amount` `:146` `peso`; `first-limit-percent` `:155` `rate`), `mobile/components/income/income_form.tsx` (`:60`, `peso`)
- Test: `mobile/app/__tests__/limit_routes.test.tsx`, `mobile/components/onboarding/__tests__/first_limit_step.test.tsx`, `mobile/components/income/__tests__/income_screen.test.tsx`, `mobile/components/onboarding/__tests__/income_quick_form.test.tsx`, `mobile/components/onboarding/__tests__/income_step.test.tsx`, `mobile/app/(onboarding)/__tests__/setup_flow_e2e.test.tsx`

This closes the `add-numpad-to-this-section` screenshot: onboarding's first-limit step stops raising the system keyboard.

`components/onboarding/income_quick_form.tsx` already renders `AmountNumpad` inline — replace it with a `NumericField` that opens the hosted panel, so `save-income-button-burried` is fixed by `FormScreen` at the same time.

- [ ] **Step 1: Update the six test files.** Wrap each subject, swap `changeText` for `typeAmount`, and add the two behaviour assertions this task exists for:

```tsx
test("the onboarding limit step never raises the Android keyboard", () => {
  renderForm(<FirstLimitForm {...props} />);

  expect(screen.UNSAFE_queryAllByType(TextInput)).toHaveLength(0);
});

test("a percent limit types on the keypad and reads back with a percent sign", () => {
  renderForm(<FirstLimitForm {...props} mode="percent" />);

  typeAmount("first-limit-percent", "50");

  expect(screen.getByText("50%")).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `cd mobile && npx jest app/__tests__/limit_routes.test.tsx components/onboarding components/income "app/(onboarding)"` — Expected: FAIL.
- [ ] **Step 3: Migrate the three components**, wrapping each screen in `FormScreen`.
- [ ] **Step 4: Run to verify they pass.** Same command — Expected: PASS.
- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add "mobile/app/(tabs)/plan/limits/new.tsx" mobile/components/onboarding mobile/components/income "mobile/app/(onboarding)/__tests__" mobile/app/__tests__/limit_routes.test.tsx
git commit -m "feat(mobile): move limits, income and onboarding onto the keypad"
```

---

### Task 13: Wallets and the balance sheets

**Files:**
- Modify: `mobile/components/wallets/wallet_form.tsx` (`:154`), `mobile/components/onboarding/quick_wallet_list.tsx` (`:163`), `mobile/components/wallets/balance_correction_sheet.tsx` (`:120`), `mobile/components/wallets/cash_reconcile_sheet.tsx` (`:105`) — all `peso`
- Test: `mobile/components/wallets/__tests__/wallet_form.test.tsx`, `.../balance_correction_sheet.test.tsx`, `.../cash_reconcile_sheet.test.tsx`, `mobile/components/onboarding/__tests__/quick_wallet_list.test.tsx`, `mobile/app/__tests__/wallet_routes.test.tsx`, `mobile/app/__tests__/wallet_detail.test.tsx`, `mobile/app/(onboarding)/__tests__/wallets_step.test.tsx`

The two sheets are the second and third `Modal`-hosted fields. This closes the `change-number-input-behavior` screenshot directly — onboarding's wallet balance is where the owner typed `100000` and got ₱1,000.00.

- [ ] **Step 1: Update the seven test files.** Add the regression by name:

```tsx
test("REGRESSION: 100000 in an opening balance is one hundred thousand pesos", () => {
  renderForm(<QuickWalletList {...props} />);

  typeAmount("wallet-balance-cash", "100000");

  expect(screen.getByText("₱100,000")).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `cd mobile && npx jest components/wallets components/onboarding/__tests__/quick_wallet_list.test.tsx app/__tests__/wallet_routes.test.tsx app/__tests__/wallet_detail.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Migrate the four components**, wrapping `wallet_form` in `FormScreen`.
- [ ] **Step 4: Run to verify they pass.** Same command — Expected: PASS.
- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/components/wallets mobile/components/onboarding/quick_wallet_list.tsx mobile/app/__tests__/wallet_routes.test.tsx mobile/app/__tests__/wallet_detail.test.tsx
git commit -m "feat(mobile): move wallet balances onto the keypad"
```

---

### Task 14: The report range picker

**Files:**
- Modify: `mobile/components/reports/range_picker.tsx` (`:125` and `:132` → two `DateField`s)
- Test: `mobile/components/reports/__tests__/range_picker.test.tsx`

The two fields bound each other: the `from` field takes `maximumDate` from the `to` value and vice versa. The file's existing string-comparison validity check (`from <= to`) stays — it is still the guard, and the bounds only stop the user reaching an invalid pair in the first place.

- [ ] **Step 1: Update the test** — swap `changeText` for date-field presses against the mocked picker (same `jest.mock` factory as Task 8's test), keep the existing `from <= to` assertions, and add the bounding one:

```tsx
test("the start field cannot be set past the end date", () => {
  render(<RangePicker from="2026-08-01" to="2026-08-19" onChange={onChange} />);

  fireEvent.press(screen.getByTestId("range-from"));

  const picker = screen.getByTestId("picker-value");
  expect(picker).toBeTruthy();
  // The bound is handed to the dialog, so an invalid pair is unreachable
  // rather than merely rejected afterwards.
  expect(screen.getByTestId("range-from-max").props.children).toBe("2026-08-19");
});
```

If exposing `range-from-max` as a `Text` purely for the test feels wrong, assert instead on the `maximumDate` prop the mocked `DateTimePicker` receives — record it in the mock factory and read it back.
- [ ] **Step 2: Run to verify it fails.** Run: `cd mobile && npx jest components/reports/__tests__/range_picker.test.tsx` — Expected: FAIL.
- [ ] **Step 3: Migrate the component.**
- [ ] **Step 4: Run to verify it passes.** Same command — Expected: PASS.
- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add mobile/components/reports
git commit -m "feat(mobile): pick report ranges from a calendar"
```

---

## Task 15: Retire the old input path and lock the constraint in

**Files:**
- Delete: `mobile/components/transactions/amount_numpad.tsx`, `mobile/components/transactions/__tests__/amount_numpad.test.tsx`
- Modify: `mobile/components/ui/amount_text.tsx` (remove `centavosFromDigits` and `MAX_SAFE_CENTAVOS`)
- Create: `mobile/components/ui/__tests__/no_numeric_keyboard.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This task removes.

- [ ] **Step 1: Write the guard test**

Create `mobile/components/ui/__tests__/no_numeric_keyboard.test.ts`:

```ts
// mobile/components/ui/__tests__/no_numeric_keyboard.test.ts — W1 Task 15.
//
// W1's Global Constraint 2 is only real if something enforces it. Without
// this, the next form to need a number reaches for keyboardType="numeric"
// because that is what every other codebase does, and the OS keypad is back
// on one screen with nothing failing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");
const SKIP = new Set(["node_modules", ".expo", "android", "ios", "test_support", ".git"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(entry) ? [path] : [];
  });
}

test("no TextInput asks for a numeric keyboard anywhere in the app", () => {
  const offenders = sourceFiles(ROOT).filter((path) =>
    /keyboardType\s*=\s*["'](numeric|number-pad|decimal-pad)["']/u.test(readFileSync(path, "utf8")),
  );

  expect(offenders).toEqual([]);
});

test("centavosFromDigits is gone — lib/money/peso_input.ts owns the way in", () => {
  const offenders = sourceFiles(ROOT).filter((path) =>
    /centavosFromDigits/u.test(readFileSync(path, "utf8")),
  );

  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd mobile && npx jest components/ui/__tests__/no_numeric_keyboard.test.ts`
Expected: FAIL — `amount_numpad.tsx` and `amount_text.tsx` still reference `centavosFromDigits`.

- [ ] **Step 3: Delete the old path**

```bash
cd mobile
rm components/transactions/amount_numpad.tsx components/transactions/__tests__/amount_numpad.test.tsx
```

Then remove `centavosFromDigits` and its `MAX_SAFE_CENTAVOS` constant from `components/ui/amount_text.tsx`, leaving `formatCentavos` and `AmountText` untouched. Update that file's header comment: it currently describes both directions, and after this it owns only the outward one — add a line pointing at `lib/money/peso_input.ts` for the way in.

- [ ] **Step 4: Run the guard test and the full suite**

Run: `cd mobile && npx jest components/ui/__tests__/no_numeric_keyboard.test.ts && npm test`
Expected: PASS, whole suite green.

- [ ] **Step 5: Typecheck and commit**

```bash
cd mobile && npx tsc --noEmit
git add -A mobile/components/transactions mobile/components/ui
git commit -m "refactor(mobile): retire the centavo-entry numpad

lib/money/peso_input.ts owns keystrokes-to-money now, and a test asserts no
TextInput anywhere asks for a numeric keyboard so the OS keypad cannot come
back one screen at a time."
```

---

## Task 16: On-device verification

**Files:**
- Modify: `docs/13-on-device-verification.md`

CI cannot cover the panel's animation, its interaction with the sheet `Modal`, the hardware-back subscription, or the platform date dialog. Add a W1 section to the on-device checklist.

- [ ] **Step 1: Add the checklist**

Append to `docs/13-on-device-verification.md`:

```markdown
## W1 — Numeric input system

Requires a dev-client rebuild: `@react-native-community/datetimepicker` is a
native module.

- [ ] Manual entry lands with the keypad already up; Save is reachable without
      scrolling under it.
- [ ] Typing `1000` in any amount field reads ₱1,000.00. Typing `1000.50`
      reads ₱1,000.50.
- [ ] The decimal key is dimmed and inert on "How many payments" and "Days
      between payments".
- [ ] Opening the keypad inside a bottom sheet (goal allocation, balance
      correction, cash reconcile) draws it ABOVE the sheet, not behind.
- [ ] Closing a sheet while the keypad is open closes the keypad too.
- [ ] Hardware back with the keypad open closes the keypad and does NOT leave
      the screen.
- [ ] Tapping a category chip or direction toggle while the keypad is open
      registers on the FIRST tap.
- [ ] The date dialog opens on every former YYYY-MM-DD field and cannot pick a
      goal deadline in the past or a transaction date in the future.
- [ ] No screen raises the Android keyboard for a number.
- [ ] STILL UNRESOLVED, diagnose here: Home's empty-state button renders "Add"
      rather than "Add manually" (roadmap §1.11). The string and the wiring are
      both correct in source; suspect a reflow when the Inter face loads. Do
      not fix by shortening the label.
```

- [ ] **Step 2: Commit**

```bash
git add docs/13-on-device-verification.md
git commit -m "docs: add the W1 on-device checklist"
```

---

## Self-Review Notes

**Spec coverage.** §1 → Task 1. §2 → Task 2. §3 → Task 3. §4 → Task 4. §5 → Task 5 (§5.1's auto-open → Task 9 Step 3). §6 → Task 7, applied in Tasks 9–13. §7 → Task 8, applied in Tasks 9, 11, 14. §8's twenty call sites → Tasks 9–14, each named with its line and mode. §9.1 → Task 1's tests. §9.2 → Task 6. §9.3 → Tasks 5 and 15. §9.4 → Task 16. §10's "no data migration" is honoured by omission — no task touches stored rows.

**Known judgement calls an executor may hit.**

- The panel uses React Native's own `Animated` rather than `react-native-reanimated`. Reanimated is installed but has no jest mock configured in `test_support/`, and a fade-and-rise needs no worklet. If a richer gesture-driven panel is ever wanted, adding the mock is the first step.
- `range_picker.tsx`'s two date fields keep the existing string `from <= to` check. Bounds prevent reaching an invalid pair; the check still catches it.
- Task 9's auto-open effect is mount-only by design. Re-running it on amount changes would re-raise a panel the user dismissed to reach the category picker.
