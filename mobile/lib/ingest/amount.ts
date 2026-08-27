// lib/ingest/amount.ts — the stage where text becomes money.
//
// Two small functions, and the whole ledger rests on the first of them. Every
// number the user ever sees — a wallet balance, a Limit's remaining spend,
// Safe-to-Spend — is arithmetic over the integers this file returns. A defect
// here does not raise an error or fail a request; it produces a plausible
// wrong number that propagates into every total and cannot be traced back
// from the app. So this module is deliberately strict and deliberately dull.
//
// ---------------------------------------------------------------------------
// WHY THERE IS NO FLOATING-POINT ARITHMETIC ANYWHERE BELOW.
//
// The obvious implementation is `Math.round(Number.parseFloat(clean) * 100)`.
// It is wrong, and it is wrong in the way that is hardest to catch:
//
//     12.10 * 100          === 1209.9999999999998
//     Number.parseFloat("12.10") * 100 === 1209.9999999999998
//
// `Math.round` rescues that particular value, which is exactly why the bug
// ships — the fix looks like it works, and the failures are sparse enough to
// look like something else. IEEE-754 doubles cannot represent most two-decimal
// values exactly, so the error is a property of the representation, not of any
// one input, and no amount of rounding makes it go away in general.
//
// The construction used here never performs decimal arithmetic at all. It
// matches the integer part and the fraction part as separate digit strings,
// parses each as an integer, and combines them with integer multiplication:
// `pesos * 100 + centavos`. Both operands are exact integers, and the product
// is exact for every value below 2^53 — which the safe-integer guard enforces.
// ---------------------------------------------------------------------------
import type { Centavos } from "@/types/domain";

/**
 * One complete peso amount, anchored — the whole string or nothing.
 *
 * ANCHORED ON PURPOSE. This function is handed a span a provider template has
 * already isolated as the amount, so trailing rubbish means the template bound
 * the wrong thing, and the honest answer is `null` rather than a number
 * salvaged from the first few characters. `"1,234.56 PHP"` and `"₱100 fee"`
 * both fail here, and both should.
 *
 * THE CURRENCY MARKER, AND THE DELIBERATE DIVERGENCE FROM THE ROUTER. `₱`,
 * `PHP` and `Php` are the three spellings spec §3 rule 3 names, matched
 * case-sensitively, plus a bare `P`. `source_router.ts` refuses a bare `P` and
 * that is not an inconsistency to be tidied away — the two predicates answer
 * different questions:
 *
 *   - The router's `MONEY_SIGNAL` is the pipeline's PRIVACY GATE. It decides
 *     whether an unknown app's notification is retained and shown to the user
 *     at all, over text with no context whatsoever. `P` + digits is ordinary
 *     English ("P 500 plan", "Gate P3"), so admitting it there would pull
 *     strangers' messages into a finance app.
 *   - This function is only ever asked about a span already known to be an
 *     amount. The ambiguity the router defends against has been resolved by
 *     the template before the string arrives, and refusing `P` here would drop
 *     real money from a known provider.
 *
 * Marker alternation order matters: `PHP` must be tried before `P`, or `P`
 * would consume the leading character of "PHP 100" and the rest would fail.
 *
 * THOUSANDS SEPARATORS MUST BE WELL FORMED — either no commas at all, or
 * strict three-digit groups. `"12,34"` is rejected rather than read as 1,234:
 * a separator in the wrong place means the span is not the amount we think it
 * is, and a hundredfold error presented to the user as fact is far worse than
 * a Review Queue item.
 *
 * NO SIGN. Direction is carried by `ParsedEvent.direction`, never by the
 * amount, and a ledger holding negative centavos would break that invariant
 * silently. `"-100.00"` is refused.
 *
 * The fraction is captured with an open `\d+` rather than `\d{2}` so that the
 * one-digit and three-digit cases can be DECIDED below rather than left to
 * whatever the regex happens to reject.
 */
const AMOUNT_PATTERN =
  /^(?:₱|PHP|Php|P)?\s*(?<pesos>\d{1,3}(?:,\d{3})+|\d+)(?:\.(?<fraction>\d+))?$/u;

/** Centavos per peso. Named so the integer combination below reads as arithmetic, not magic. */
const CENTAVOS_PER_PESO = 100;

/** Exactly how many fraction digits a peso amount can carry. */
const FRACTION_DIGITS = 2;

/**
 * Parses one peso amount into integer centavos, or `null` when the string is
 * not an amount this function will vouch for.
 *
 * Accepts `"₱1,234.56"`, `"PHP 1,234.56"`, `"1234.56"`, `"1,234"` and
 * `"P1,234.56"` (plan Task 4 rule 1). Surrounding whitespace is trimmed.
 *
 * `"1,234"` is `123400`, NOT `1234`. A missing fraction means zero centavos.
 * The alternative reading — digits stripped of separators are centavos — is
 * wrong by a factor of one hundred on every whole-peso notification, which is
 * most of them.
 *
 * FRACTION LENGTHS, DECIDED RATHER THAN INHERITED FROM THE REGEX:
 *
 *   - **One digit** (`"1,234.5"` → `123450`) is padded right. In ordinary
 *     decimal notation `.5` means half a peso; reading it as five centavos
 *     would be wrong by a factor of ten, and refusing it would discard a real
 *     amount whose value is not in doubt.
 *   - **Three or more digits** (`"1,234.567"` → `null`) is refused. Centavos
 *     are exactly two decimal places, so the third digit cannot be
 *     represented, and every way of handling it either invents precision or
 *     discards money. Beyond that, a third fraction digit in a peso
 *     notification much more likely means the template captured the wrong span
 *     — a date, a version, a reference number — than that a provider quoted
 *     sub-centavo precision. Refusing routes it to the Review Queue, which is
 *     spec §1 principle 1: when the pipeline is unsure, it asks.
 *
 * Returns `null`, never `0` or `NaN`, for anything it will not vouch for —
 * `0` is a legitimate amount and must stay distinguishable from a refusal.
 */
export function parseAmountToCentavos(raw: string): Centavos | null {
  const match = AMOUNT_PATTERN.exec(raw.trim());
  if (match?.groups === undefined) return null;

  const { pesos, fraction } = match.groups;
  if (pesos === undefined) return null;

  // More precision than centavos can hold. See the decision note above.
  if (fraction !== undefined && fraction.length > FRACTION_DIGITS) return null;

  // Two integer parses and one integer multiply — no decimal arithmetic, ever.
  // `padEnd` is what makes a one-digit fraction tenths of a peso: "5" → "50".
  const wholePesos = Number.parseInt(pesos.replaceAll(",", ""), 10);
  const centavos =
    fraction === undefined ? 0 : Number.parseInt(fraction.padEnd(FRACTION_DIGITS, "0"), 10);

  const total = wholePesos * CENTAVOS_PER_PESO + centavos;

  // Past 2^53 the arithmetic above stops being exact, which is the one failure
  // this module exists to prevent. The guard sits orders of magnitude above any
  // real peso amount, so refusing costs nothing that could ever be legitimate.
  return Number.isSafeInteger(total) ? total : null;
}

/**
 * Every amount-like token in a block of notification text, as the §9.1
 * amount-ambiguity penalty counts them.
 *
 * WHAT THIS IS FOR. Spec §4's failure-mode table: "Two amount-like tokens
 * (amount + balance-after) → Wrong amount risk". A notification reading "You
 * sent ₱1,500.00 … your balance is ₱3,200.00" contains two numbers either of
 * which a loose template might bind as the amount, and committing ₱3,200.00 as
 * a spend is a silent, unexplainable error. Counting the tokens is how the
 * parser knows to be less sure of itself.
 *
 * A CURRENCY MARKER IS REQUIRED, exactly as in the router's `MONEY_SIGNAL` and
 * for the same reason — this one also scans free-form notification text, where
 * bare digits are reference numbers, dates, account suffixes, times and unread
 * counts. Counting those would charge the 0.30 penalty against nearly every
 * notification and route the whole pipeline into the Review Queue, which trains
 * the user to ignore it. (Note this is the opposite lean from
 * `parseAmountToCentavos` above, which is strictly more permissive about the
 * marker — and again the reason is that it reads an already-isolated span while
 * this one reads raw text.)
 *
 * Both directions of error matter, so both are tested: an implementation that
 * always returned 1 would disable the penalty entirely.
 *
 * The pattern is deliberately looser than `AMOUNT_PATTERN` — it is counting
 * candidates, not vouching for them, so it tolerates the sloppy grouping the
 * strict parser refuses.
 */
const AMOUNT_TOKEN_PATTERN = /(?:₱|PHP|Php)\s?\d[\d,]*(?:\.\d{1,2})?/gu;

/**
 * One amount-like token and where it sits, so a caller can point at it in the
 * text the user is reading. `start`/`end` index the string that was scanned.
 */
export type AmountToken = {
  text: string;
  start: number;
  end: number;
};

/**
 * The tokens themselves, in reading order. See AMOUNT_TOKEN_PATTERN for what
 * counts as one and why.
 *
 * `matchAll` rather than `.exec()` in a loop: it copies the pattern before
 * scanning, so this module-level global regex's `lastIndex` is never advanced
 * and the same text cannot scan differently depending on what ran before it.
 */
export function amountTokens(text: string): AmountToken[] {
  return [...text.matchAll(AMOUNT_TOKEN_PATTERN)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/** Counts amount-like tokens. See AMOUNT_TOKEN_PATTERN for what counts and why. */
export function countAmountTokens(text: string): number {
  return amountTokens(text).length;
}
