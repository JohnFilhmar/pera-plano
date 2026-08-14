// components/transactions/__tests__/amount_numpad.test.tsx — m1c plan Task 8,
// rules 2 and 5.
//
// THE 100× ERROR IS THE ONE THIS FILE EXISTS TO CATCH. Reading `1`,`2`,`3`,`4`
// as ₱1,234.00 instead of ₱12.34 throws nothing, renders a plausible number,
// and is only ever noticed as "the app thinks I spent a hundred times what I
// did". So the keystrokes and the peso string are asserted together, in both
// directions, and the centavos handed to the caller are asserted with them.
//
// THE THREE KEYS ARE THREE DIFFERENT BEHAVIOURS. Backspace removes ONE digit,
// long-press clears EVERYTHING, and a digit appends. Wiring long-press to the
// backspace handler is the plausible mistake — it passes a "clearing works"
// test that only checks the field ends up empty, because on a one-digit amount
// the two are identical. Every case here is written to be different.
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

import { centavosFromDigits } from "@/components/ui/amount_text";

import { AmountNumpad, appendDigit, NUMPAD_MAX_DIGITS, removeLastDigit } from "../amount_numpad";

const onChange = jest.fn();

/**
 * The numpad is controlled on the RAW DIGIT STRING, so the harness holds that
 * string — exactly as the form does. Nothing here ever converts a formatted
 * display back into a number; that is the bug the whole design avoids.
 */
function Harness({ initial = "" }: { initial?: string }) {
  const [digits, setDigits] = useState(initial);
  return (
    <AmountNumpad
      digits={digits}
      onDigitsChange={(next) => {
        onChange(next);
        setDigits(next);
      }}
    />
  );
}

function type(keys: string): void {
  for (const key of keys) {
    fireEvent.press(screen.getByTestId(`numpad-key-${key}`));
  }
}

function displayed(): string {
  return String(screen.getByTestId("numpad-amount").props.children);
}

beforeEach(() => {
  onChange.mockClear();
});

describe("building centavos from keystrokes", () => {
  test("`1`,`2`,`3`,`4` displays ₱12.34 and yields 1234 centavos", () => {
    render(<Harness />);

    type("1234");

    // Both halves of rule 2, together. The peso string is what the user checks
    // their spending against; the centavos are what the ledger stores.
    expect(displayed()).toBe("₱12.34");
    expect(onChange).toHaveBeenLastCalledWith("1234");
    expect(centavosFromDigits("1234")).toBe(1234);
  });

  test("a single digit is centavos, not pesos", () => {
    render(<Harness />);

    type("5");

    // ₱0.05. The 100× error's smallest and clearest form.
    expect(displayed()).toBe("₱0.05");
  });

  test("an untouched numpad reads ₱0.00 rather than blank", () => {
    render(<Harness />);

    // The amount is the landing state (rule 1) and it has to say something the
    // moment the screen opens. An empty field reads as "not loaded yet".
    expect(displayed()).toBe("₱0.00");
  });

  test("digits keep grouping and centavos as the number grows", () => {
    render(<Harness />);

    type("123456");

    expect(displayed()).toBe("₱1,234.56");
  });
});

describe("backspace and clear are different keys", () => {
  test("backspace removes the LAST digit only", () => {
    render(<Harness initial="1234" />);

    fireEvent.press(screen.getByTestId("numpad-backspace"));

    // ₱1.23, not ₱0.00 — and the shift is the point: every remaining digit
    // moves one place right, which is what makes this a real inverse of typing.
    expect(onChange).toHaveBeenLastCalledWith("123");
    expect(displayed()).toBe("₱1.23");
  });

  test("long-press CLEARS, and it is not the backspace handler", () => {
    render(<Harness initial="1234" />);

    fireEvent(screen.getByTestId("numpad-backspace"), "longPress");

    // One event, four digits gone. Wired to the same handler this would read
    // "123" and the user would be left deleting a mistyped amount one key at a
    // time while the numbers shift under them.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(displayed()).toBe("₱0.00");
  });

  test("backspace on an empty amount does nothing at all", () => {
    render(<Harness />);

    fireEvent.press(screen.getByTestId("numpad-backspace"));

    expect(displayed()).toBe("₱0.00");
  });

  test("typing after a clear starts from scratch", () => {
    render(<Harness initial="9999" />);

    fireEvent(screen.getByTestId("numpad-backspace"), "longPress");
    type("50");

    // ₱0.50, not ₱99.99 with something appended. A clear that only blanks the
    // DISPLAY while keeping the digits is the failure this catches.
    expect(displayed()).toBe("₱0.50");
  });
});

describe("the digit rules", () => {
  test("leading zeros never accumulate", () => {
    expect(appendDigit("", "0")).toBe("");
    expect(appendDigit("0", "5")).toBe("5");
    expect(appendDigit("", "7")).toBe("7");
  });

  test("appending is exactly what the display then shows", () => {
    expect(appendDigit("12", "3")).toBe("123");
    expect(centavosFromDigits(appendDigit("12", "3"))).toBe(123);
  });

  test("removing the last digit is not clearing", () => {
    expect(removeLastDigit("1234")).toBe("123");
    expect(removeLastDigit("1")).toBe("");
    expect(removeLastDigit("")).toBe("");
  });

  test("a keystroke past the safe ceiling is REFUSED, not silently dropped", () => {
    const full = "9".repeat(NUMPAD_MAX_DIGITS);

    // `centavosFromDigits` clamps to a safe integer, so a 16th digit would be
    // shown and then not saved — the display and the ledger quietly disagreeing
    // about the number the user is looking at. Refusing the keystroke keeps
    // what is on screen equal to what will be written.
    expect(appendDigit(full, "9")).toBe(full);
    expect(Number.isSafeInteger(centavosFromDigits(full))).toBe(true);
  });
});

describe("the keys a finger and a screen reader can find", () => {
  test.each(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"])("key %s is labelled", (key) => {
    render(<Harness />);

    expect(screen.getByTestId(`numpad-key-${key}`).props.accessibilityLabel).toBe(key);
  });

  test("the backspace key says what a long press does", () => {
    render(<Harness />);

    const backspace = screen.getByTestId("numpad-backspace");
    // TalkBack reads the label; a key whose second, destructive behaviour is
    // undiscoverable is a key that clears someone's amount by accident.
    expect(backspace.props.accessibilityLabel).toMatch(/delete/i);
    expect(backspace.props.accessibilityHint).toMatch(/clear/i);
  });
});
