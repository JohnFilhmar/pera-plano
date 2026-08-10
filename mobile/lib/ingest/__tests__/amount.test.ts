// lib/ingest/__tests__/amount.test.ts — where text becomes money.
//
// ILLUSTRATIVE ONLY. Every notification-shaped string below is INVENTED for
// planning (docs/03-ingest-pipeline.md §11.4). No real GCash, Maya or bank
// notification has been captured for this project.
//
// WHAT THESE TESTS ARE GUARDING. Everything downstream of this function —
// dedupe, transfer detection, Limits, Safe-to-Spend — is arithmetic on the
// integer it returns. A bug here does not surface as an error; it surfaces
// months later as a balance the user cannot explain and cannot trace. So the
// suite is built around the two ways this function can be quietly wrong:
//
//   1. It returns a number that is off by a centavo (float arithmetic).
//   2. It returns a number at all when it should have refused (`null`).
//
// The second is why the junk cases assert `toBeNull()` and never `toBeFalsy()`:
// `0` is falsy, and `0` is also a perfectly legitimate amount.
import { countAmountTokens, parseAmountToCentavos } from "@/lib/ingest/amount";

// ---------------------------------------------------------------------------
// parseAmountToCentavos — the accepted formats
// ---------------------------------------------------------------------------

test("each accepted format converts to the right number of centavos", () => {
  // Plan Task 4 rule 1's table, verbatim. Table-driven so a format cannot be
  // fixed by breaking another — every row is asserted independently.
  const cases: ReadonlyArray<readonly [string, number]> = [
    ["₱1,234.56", 123456],
    ["PHP 1,234.56", 123456],
    ["1234.56", 123456],
    // A MISSING FRACTION IS ZERO CENTAVOS, NOT 1,234 CENTAVOS. An
    // implementation that stripped the separators and called the digits
    // centavos would return 1234 here and be wrong by a factor of 100 on every
    // whole-peso notification.
    ["1,234", 123400],
    // Bare `P`. See the note on the router's money-signal predicate below.
    ["P1,234.56", 123456],
  ];

  for (const [raw, expected] of cases) {
    expect(parseAmountToCentavos(raw)).toBe(expected);
  }
});

test("the currency marker spellings the spec names are all accepted, spaced or not", () => {
  // Spec §3 rule 3 names ₱, "PHP" and "Php"; real notifications differ on the
  // space after the marker and on whether the fraction is written at all.
  expect(parseAmountToCentavos("₱500.00")).toBe(50000);
  expect(parseAmountToCentavos("₱ 500.00")).toBe(50000);
  expect(parseAmountToCentavos("PHP500.00")).toBe(50000);
  expect(parseAmountToCentavos("Php 500")).toBe(50000);
  expect(parseAmountToCentavos("  ₱1,000.00  ")).toBe(100000);
});

test("a bare P is an amount here even though it is not a money signal to the router", () => {
  // DELIBERATE DIVERGENCE FROM source_router.ts — do not "harmonize" the two.
  //
  // The router's `MONEY_SIGNAL` refuses a bare `P` because it is the pipeline's
  // PRIVACY GATE: it decides whether an unknown app's notification is stored
  // and shown to the user at all, and `P` + digits ("P 500 plan", "P1 vs P2")
  // is far too common in ordinary text to admit a stranger's messages on.
  //
  // This function is asked a different question. By the time a string reaches
  // it, a provider template has already isolated the span as an amount, so the
  // ambiguity the router is defending against has already been resolved by
  // context. Refusing `P` here would drop real money from a known provider.
  expect(parseAmountToCentavos("P1,234.56")).toBe(123456);
  expect(parseAmountToCentavos("P500")).toBe(50000);
});

// ---------------------------------------------------------------------------
// Float safety — the regression test this function exists for
// ---------------------------------------------------------------------------

test("12.10 yields exactly 1210 centavos", () => {
  // THE FLOAT-SAFETY REGRESSION TEST. Keep the literal `12.10`.
  //
  // `12.10 * 100 === 1209.9999999999998` in IEEE-754 double arithmetic. An
  // implementation that reaches centavos by multiplying — even one that then
  // rounds, which happens to rescue this case — is one input away from
  // corrupting the ledger by a centavo, silently and permanently.
  //
  // The only safe construction is integer arithmetic: parse "12" and "10" as
  // separate integers and combine them as `12 * 100 + 10`.
  expect(parseAmountToCentavos("12.10")).toBe(1210);
  expect(parseAmountToCentavos("₱12.10")).toBe(1210);

  // The same trap at other magnitudes. Each of these is a value whose decimal
  // form has no exact binary representation.
  expect(parseAmountToCentavos("0.29")).toBe(29);
  expect(parseAmountToCentavos("1.005")).toBeNull(); // three fraction digits — see below
  expect(parseAmountToCentavos("8.20")).toBe(820);
  expect(parseAmountToCentavos("1,000.10")).toBe(100010);
  expect(parseAmountToCentavos("9,007,199.25")).toBe(900719925);
});

test("every two-decimal fraction from .00 to .99 round-trips exactly", () => {
  // Exhaustive rather than sampled: floating-point error is not uniform, so a
  // handful of spot checks can miss the exact fractions that break. One
  // hundred assertions is cheap; a wrong centavo in the ledger is not.
  for (let centavos = 0; centavos < 100; centavos += 1) {
    const fraction = String(centavos).padStart(2, "0");
    expect(parseAmountToCentavos(`₱7.${fraction}`)).toBe(700 + centavos);
  }
});

// ---------------------------------------------------------------------------
// Fraction lengths the plan leaves open (documented decisions)
// ---------------------------------------------------------------------------

test("a one-digit fraction is read as tenths of a peso, not as centavos", () => {
  // DECISION: pad right. `.5` in ordinary decimal notation unambiguously means
  // half a peso — fifty centavos — and reading it as five centavos would be
  // wrong by a factor of ten. Rejecting it outright would lose a real amount
  // for no gain, since nothing about the value is ambiguous.
  expect(parseAmountToCentavos("1,234.5")).toBe(123450);
  expect(parseAmountToCentavos("₱0.5")).toBe(50);
  expect(parseAmountToCentavos("PHP 12.1")).toBe(1210);
});

test("a fraction of three or more digits is refused rather than rounded", () => {
  // DECISION: `null`. Centavos are exactly two decimal places, so a third digit
  // cannot be represented — and any handling invents precision (round up) or
  // silently discards money (truncate).
  //
  // More to the point, a three-digit fraction in a peso notification is far
  // likelier to mean the template grabbed the wrong span — a date, a reference
  // number, a version string — than that the provider quoted sub-centavo
  // precision. Refusing sends it to the Review Queue where a human resolves it,
  // which is spec §1 principle 1: when the pipeline is unsure, it asks.
  expect(parseAmountToCentavos("1,234.567")).toBeNull();
  expect(parseAmountToCentavos("₱1.2345")).toBeNull();
  expect(parseAmountToCentavos("100.000")).toBeNull();
});

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

test("junk returns null rather than zero or NaN", () => {
  // ASSERT `toBeNull()`, NEVER `toBeFalsy()`. `0` is falsy and `0` is also a
  // legitimate amount, so a falsy assertion would pass for an implementation
  // that silently turned every unparseable string into a zero-peso ledger row.
  const junk = [
    "",
    "   ",
    "abc",
    "₱",
    "PHP",
    "P",
    "₱abc",
    ".",
    ".50", // no integer part
    "1,234.", // a decimal point with nothing after it
    "1.2.3",
    "-100.00", // signs are carried by `direction`, never by the amount
    "+100.00",
    "1 234.56", // a space is not a thousands separator here
    "1,234.56 PHP", // suffixed currency is not one of the accepted forms
    "Ref. No. 90210123",
    "NaN",
    "Infinity",
    "1e5",
  ];

  for (const raw of junk) {
    expect(parseAmountToCentavos(raw)).toBeNull();
  }
});

test("malformed thousands grouping is refused, never silently reinterpreted", () => {
  // A separator in the wrong place means the span is not what we think it is.
  // Stripping commas and carrying on would turn "12,34" into ₱1,234.00 — a
  // hundredfold error presented to the user as fact. Refusing costs one tap in
  // the Review Queue.
  expect(parseAmountToCentavos("12,34")).toBeNull();
  expect(parseAmountToCentavos("1,2345")).toBeNull();
  expect(parseAmountToCentavos("1,23,456")).toBeNull();
  expect(parseAmountToCentavos(",100")).toBeNull();
  expect(parseAmountToCentavos("1,")).toBeNull();
});

test("zero is a legitimate amount and is not confused with a refusal", () => {
  expect(parseAmountToCentavos("0.00")).toBe(0);
  expect(parseAmountToCentavos("₱0")).toBe(0);
});

test("an amount too large to hold exactly in an integer is refused", () => {
  // Beyond `Number.MAX_SAFE_INTEGER` the arithmetic stops being exact, which is
  // the precise failure this module exists to prevent. Nothing plausible is
  // lost: the guard sits far above any real peso amount.
  expect(parseAmountToCentavos("999,999,999,999,999,999.99")).toBeNull();
  // ...and the magnitudes that actually occur still pass.
  expect(parseAmountToCentavos("₱10,000,000.00")).toBe(1_000_000_000);
});

// ---------------------------------------------------------------------------
// countAmountTokens — the input to the §9.1 ambiguity penalty
// ---------------------------------------------------------------------------

test("countAmountTokens counts two tokens in a text carrying an amount and a balance", () => {
  // THE PENALTY'S DISCRIMINATOR, and it can be wrong in both directions.
  //
  // Undercount (always 1) and the §9.1 amount-ambiguity penalty never fires, so
  // a notification where the parser might have bound the BALANCE as the amount
  // auto-commits the wrong number. Overcount (every number in the text) and
  // every notification carrying a reference number or a date is penalised into
  // the Review Queue, which trains the user to ignore it.
  const text = "You sent ₱1,500.00 to JUAN D. Your new balance is ₱3,200.00."; // ILLUSTRATIVE

  expect(countAmountTokens(text)).toBe(2);
});

test("countAmountTokens counts one token in a text carrying only an amount", () => {
  expect(countAmountTokens("You paid ₱250.00 via QR. Ref. No. 90210123.")).toBe(1); // ILLUSTRATIVE
});

test("countAmountTokens ignores numbers that are not money", () => {
  // Reference numbers, dates, account suffixes and times are all digits, and
  // none of them is an amount-like token.
  const text =
    "Debited PHP 2,000.00 on 08/02 at 14:35 from account ending 1234. Ref. No. 90210123."; // ILLUSTRATIVE

  expect(countAmountTokens(text)).toBe(1);
});

test("countAmountTokens is zero for text with no money at all", () => {
  expect(countAmountTokens("Your one-time PIN is 483920. Do not share it.")).toBe(0); // ILLUSTRATIVE
  expect(countAmountTokens("")).toBe(0);
  expect(countAmountTokens("You have 500 new messages")).toBe(0);
});

test("countAmountTokens counts every currency-marked token, including three", () => {
  const text = "Sent ₱100.00, fee PHP 15.00, balance Php 885.00."; // ILLUSTRATIVE

  expect(countAmountTokens(text)).toBe(3);
});

test("countAmountTokens is stable across repeated calls on the same regex", () => {
  // A module-level global regex carries `lastIndex` between calls, so an
  // implementation using `.test()` or `.exec()` on one would return a different
  // count for the same input depending on what was scanned before it. Calling
  // twice is what catches that.
  const text = "You sent ₱1,500.00 to JUAN D. Your new balance is ₱3,200.00."; // ILLUSTRATIVE

  expect(countAmountTokens(text)).toBe(2);
  expect(countAmountTokens(text)).toBe(2);
  expect(countAmountTokens(text)).toBe(2);
});
