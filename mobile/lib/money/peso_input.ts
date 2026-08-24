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
 * `100000` gives `"1000"` and NOT `"1000.00"`: a seeded `"1000.00"` is already
 * at the fraction cap, so every further digit would be refused on a field the
 * user has not touched yet. It is also simply the shorter thing to read.
 *
 * THAT IS NO LONGER THE WHOLE ANSWER, and this function is not where the rest
 * of it lives. `649` still has to give `"6.49"`, and a detected income is an
 * average, so a non-round seed is the COMMON case for an edit field -- which
 * lands in exactly the refusal above. The UI layer handles it by replacing a
 * seeded value on the first keystroke instead of appending to it; see
 * `untouched` in contexts/keypad_context.tsx. Deliberately not here: this
 * module is a pure function of (string, key) and has no way to know whether a
 * string was seeded or typed.
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
