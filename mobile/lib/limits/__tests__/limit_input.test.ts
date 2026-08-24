// lib/limits/__tests__/limit_input.test.ts — m2 Task 8.
import { percentToValue, valueToPercent } from "../limit_input";

test("a whole percent becomes percent x 100", () => {
  // THE TEST THE m2 PLAN'S CREATE SCREEN FAILS. Its `Math.round(Number(text))`
  // returns 20 here, and every percent-of-income limit built from it is a
  // hundredth of its real size with nothing throwing.
  expect(percentToValue("20")).toBe(2000);
  expect(percentToValue("100")).toBe(10000);
  expect(percentToValue("5")).toBe(500);
});

test("a fractional percent keeps both decimal places", () => {
  // The reason the domain type stores x100 at all: 12.5% cannot be expressed
  // in a whole-percent encoding.
  expect(percentToValue("12.5")).toBe(1250);
  expect(percentToValue("12.55")).toBe(1255);
  expect(percentToValue("0.5")).toBe(50);
  expect(percentToValue(".5")).toBe(50);
});

test("extra decimals are TRUNCATED, never rounded up", () => {
  // Rounding up hands the user a larger limit than they typed. Limits round
  // conservatively everywhere else (rule 10).
  expect(percentToValue("12.567")).toBe(1256);
  expect(percentToValue("12.999")).toBe(1299);
});

test("float multiplication is avoided, not merely rounded away", () => {
  // `1.15 * 100` is 114.99999999999999. An implementation that multiplies and
  // rounds gets this right by accident and the next one wrong.
  expect(percentToValue("1.15")).toBe(115);
  expect(percentToValue("2.29")).toBe(229);
  expect(percentToValue("8.07")).toBe(807);
});

test("an empty or non-numeric entry is zero, which the form treats as unsaveable", () => {
  expect(percentToValue("")).toBe(0);
  expect(percentToValue("abc")).toBe(0);
  expect(percentToValue(".")).toBe(0);
});

test("stray characters are dropped rather than rejected", () => {
  // Some Android keyboards emit a separator on a numeric keypad; a field that
  // refused the keystroke would look broken.
  expect(percentToValue("20%")).toBe(2000);
  expect(percentToValue(" 12.5 ")).toBe(1250);
});

test("valueToPercent is the inverse for what a user can type", () => {
  for (const text of ["20", "12.5", "0.5", "100", "1.15"]) {
    expect(valueToPercent(percentToValue(text))).toBe(String(Number(text)));
  }
});

test("valueToPercent drops a trailing zero rather than writing 12.50", () => {
  expect(valueToPercent(2000)).toBe("20");
  expect(valueToPercent(1250)).toBe("12.5");
  expect(valueToPercent(1255)).toBe("12.55");
});
