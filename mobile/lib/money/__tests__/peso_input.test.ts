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
