// lib/income/__tests__/income_math.test.ts — m2-part2 Task 11.
//
// docs/04-features/04-income.md rule 9 (averageAmount) and rule 16 (the
// monthly-equivalent M that every percent-of-income Limit is measured against).
import { averageAmountFor, monthlyEquivalent } from "../income_math";
import type { CandidateEvent } from "../candidates";

/** A candidate credit of `amount` centavos, `daysAgo` before `NOW`. */
const NOW = new Date(2026, 7, 15, 12, 0).getTime();
const DAY_MS = 86_400_000;

function credit(id: string, amount: number, daysAgo: number): CandidateEvent {
  return {
    transactionId: id,
    walletId: "w-payroll",
    amount,
    occurredAt: NOW - daysAgo * DAY_MS,
    merchant: "ACME PAYROLL",
    counterparty: null,
  };
}

// ---------------------------------------------------------------------------
// averageAmountFor — rule 9
// ---------------------------------------------------------------------------
test("the median IGNORES a single large outlier that a mean would absorb", () => {
  // The 13th-month pay, which is mandatory in the Philippines. The spec's whole
  // reason for a median: "medians resist outliers like 13th-month pay". A mean
  // here is ₱24,666.67 and would inflate every percent-of-income Limit for
  // months; the median is the ordinary payday.
  const events = [
    credit("a", 1800000, 60),
    credit("b", 1850000, 45),
    credit("c", 1850000, 30),
    credit("d", 5000000, 15), // 13th month
  ];

  const median = averageAmountFor(events, "monthly", NOW);

  expect(median).toBe(1850000);
  const mean = Math.round(events.reduce((sum, e) => sum + e.amount, 0) / events.length);
  expect(median).not.toBe(mean);
});

test("an odd count takes the middle value", () => {
  const events = [credit("a", 1000000, 30), credit("b", 1200000, 20), credit("c", 1900000, 10)];

  expect(averageAmountFor(events, "monthly", NOW)).toBe(1200000);
});

test("an even count averages the two middle values and ROUNDS, never truncates", () => {
  // Rule 2 of the plan: "never truncate, or repeated recomputation drifts
  // downward". ₱10,000.00 and ₱10,000.01 average to 1,000,000.5 centavos.
  const events = [
    credit("a", 900000, 40),
    credit("b", 1000000, 30),
    credit("c", 1000001, 20),
    credit("d", 1100000, 10),
  ];

  expect(averageAmountFor(events, "monthly", NOW)).toBe(1000001);
});

test("kinsenas takes the median of the LAST SIX matched events", () => {
  // Rule 9's window. The two oldest are far below the recent run; including
  // them would drag the median down and under-report a raise for months.
  const events = [
    credit("old1", 100000, 110),
    credit("old2", 100000, 100),
    credit("a", 1850000, 75),
    credit("b", 1850000, 60),
    credit("c", 1850000, 45),
    credit("d", 1850000, 30),
    credit("e", 1850000, 15),
    credit("f", 1850000, 1),
  ];

  expect(averageAmountFor(events, "kinsenas", NOW)).toBe(1850000);
});

test("weekly takes the last eight, monthly the last four", () => {
  const older = [credit("o1", 100000, 120), credit("o2", 100000, 115)];
  const recent = Array.from({ length: 8 }, (_, index) =>
    credit(`r${index}`, 500000, 60 - index * 7),
  );

  expect(averageAmountFor([...older, ...recent], "weekly", NOW)).toBe(500000);
  expect(averageAmountFor([...older, ...recent], "monthly", NOW)).toBe(500000);
});

test("irregular is the trailing 90 days SUMMED and divided by three", () => {
  // Rule 9's irregular row: "Sum of the trailing 90 days of primary-stream
  // candidates ÷ 3 (i.e., averageAmount IS the monthly-equivalent for irregular
  // income)". Not a median — a gig worker's months differ, and the median of
  // scattered gigs describes no month at all.
  const events = [
    credit("a", 300000, 80),
    credit("b", 450000, 50),
    credit("c", 600000, 20),
    credit("stale", 9900000, 120), // outside the 90-day window
  ];

  expect(averageAmountFor(events, "irregular", NOW)).toBe(450000); // 13,500 / 3
});

test("BELOW THE MINIMUM HISTORY THE ANSWER IS null, NOT ZERO", () => {
  // Rule 9's "Minimum history" column: 2 events for kinsenas/weekly/monthly,
  // 3 for irregular. The m2-part2 plan says an empty list returns 0, but 0 is a
  // real Centavos value that flows into `monthlyEquivalent` and then into a
  // limit's base — and limits rule 12 says income is "never silently treated as
  // ₱0.00". `IncomeProfile.averageAmount` is `Centavos | null` for this reason.
  expect(averageAmountFor([], "monthly", NOW)).toBeNull();
  expect(averageAmountFor([credit("a", 1850000, 10)], "kinsenas", NOW)).toBeNull();
  expect(averageAmountFor([credit("a", 1850000, 10)], "monthly", NOW)).toBeNull();
  expect(
    averageAmountFor([credit("a", 300000, 10), credit("b", 300000, 20)], "irregular", NOW),
  ).toBeNull();
});

test("two events are enough for kinsenas, three for irregular", () => {
  expect(
    averageAmountFor([credit("a", 1800000, 20), credit("b", 1900000, 5)], "kinsenas", NOW),
  ).toBe(1850000);
  expect(
    averageAmountFor(
      [credit("a", 300000, 30), credit("b", 300000, 20), credit("c", 300000, 10)],
      "irregular",
      NOW,
    ),
  ).toBe(300000); // 9,000 / 3
});

test("averageAmountFor does not mutate the array it is given", () => {
  const events = [credit("late", 1900000, 5), credit("early", 1800000, 40)];
  const snapshot = events.map((event) => event.transactionId);

  averageAmountFor(events, "monthly", NOW);

  expect(events.map((event) => event.transactionId)).toEqual(snapshot);
});

// ---------------------------------------------------------------------------
// monthlyEquivalent — rule 16
// ---------------------------------------------------------------------------
test("kinsenas doubles: two paydays a month", () => {
  expect(monthlyEquivalent("kinsenas", 1850000)).toBe(3700000); // ₱18,500 -> ₱37,000
});

test("weekly converts with the 52/12 factor, rounded to the centavo", () => {
  // ₱5,000.00 x 52 / 12 = ₱21,666.666... -> ₱21,666.67. A naive x4 gives
  // ₱20,000 and under-reports income by nearly 8%, which quietly tightens every
  // percent-of-income Limit.
  expect(monthlyEquivalent("weekly", 500000)).toBe(2166667);
  expect(monthlyEquivalent("weekly", 500000)).not.toBe(2000000);
});

test("monthly and irregular pass through unchanged", () => {
  // Rule 9 already made irregular a monthly figure; multiplying it again would
  // triple a gig worker's income.
  expect(monthlyEquivalent("monthly", 3000000)).toBe(3000000);
  expect(monthlyEquivalent("irregular", 450000)).toBe(450000);
});

test("rounding is applied ONCE, at the end", () => {
  // Rule 4 of the plan: "never compound intermediate rounding". Rounding
  // `amount x 52` before dividing, or `amount / 12` before multiplying, both
  // drift — this vector separates them from the single-step answer.
  expect(monthlyEquivalent("weekly", 123456)).toBe(Math.round((123456 * 52) / 12));
  expect(monthlyEquivalent("weekly", 123456)).toBe(534976);
});

test("a null average has no monthly equivalent", () => {
  // The paused case travels end to end rather than being turned into a figure.
  expect(monthlyEquivalent("kinsenas", null)).toBeNull();
  expect(monthlyEquivalent("weekly", null)).toBeNull();
});

test("zero is preserved rather than invented — the caller decides what it means", () => {
  expect(monthlyEquivalent("kinsenas", 0)).toBe(0);
});
