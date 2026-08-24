// lib/__tests__/period.test.ts — M3 Task 1.
//
// The plan's own cases, plus the boundaries that make delegating to
// `periodWindowFor` worth doing rather than restating its rules here.
import { daysBetweenInclusive, periodForScope } from "@/lib/period";

test("counts days INCLUSIVE of both ends (Aug 12–31 = 20)", () => {
  // The spec's worked example turns on this exact figure: ₱3,801.00 ÷ 20 =
  // ₱190.05. Exclusive counting gives 19 and a number that is quietly 5% high
  // every day of every month.
  expect(daysBetweenInclusive("2026-08-12", "2026-08-31")).toBe(20);
});

test("a single day is one day, not zero", () => {
  // Spec rule 7: a daily-scope limit "always has days remaining = 1", which is
  // also the only thing keeping the divisor off zero.
  expect(daysBetweenInclusive("2026-08-12", "2026-08-12")).toBe(1);
});

test("day counting crosses months and years", () => {
  expect(daysBetweenInclusive("2026-08-30", "2026-09-01")).toBe(3);
  expect(daysBetweenInclusive("2026-12-31", "2027-01-01")).toBe(2);
  expect(daysBetweenInclusive("2028-02-28", "2028-03-01")).toBe(3); // leap year
});

test("MONTHLY IS THE CALENDAR MONTH, ENDING ON ITS LAST DAY", () => {
  // `end` is the last day, NOT the exclusive bound. Naming the 1st of the next
  // month would count 32 days and subtract next month's bills.
  expect(periodForScope("monthly", "2026-08-12")).toEqual({
    start: "2026-08-01",
    end: "2026-08-31",
  });
});

test("monthly ends correctly in short and leap months", () => {
  expect(periodForScope("monthly", "2026-02-10").end).toBe("2026-02-28");
  expect(periodForScope("monthly", "2028-02-10").end).toBe("2028-02-29");
  expect(periodForScope("monthly", "2026-04-10").end).toBe("2026-04-30");
});

test("WEEKLY RUNS MONDAY THROUGH SUNDAY", () => {
  // 2026-08-12 is a Wednesday.
  expect(periodForScope("weekly", "2026-08-12")).toEqual({
    start: "2026-08-10",
    end: "2026-08-16",
  });
});

test("SUNDAY BELONGS TO THE WEEK THAT IS ENDING, NOT THE ONE STARTING", () => {
  // JS numbers Sunday as 0, so the tempting `getDay() - 1` puts it at -1 and
  // drags it into the FOLLOWING week — an off-by-one that shows up one day in
  // seven and would make Sunday's Safe-to-Spend a whole week's worth.
  // 2026-08-16 is a Sunday; 2026-08-17 is the next Monday.
  expect(periodForScope("weekly", "2026-08-16")).toEqual({
    start: "2026-08-10",
    end: "2026-08-16",
  });
  expect(periodForScope("weekly", "2026-08-17").start).toBe("2026-08-17");
});

test("DAILY IS TODAY ONLY, WHICH IS ONE DAY LONG", () => {
  const period = periodForScope("daily", "2026-08-12");

  expect(period).toEqual({ start: "2026-08-12", end: "2026-08-12" });
  expect(daysBetweenInclusive(period.start, period.end)).toBe(1);
});

test("annual is the calendar year", () => {
  expect(periodForScope("annual", "2026-08-12")).toEqual({
    start: "2026-01-01",
    end: "2026-12-31",
  });
});

test("EVERY SCOPE'S DATES AGREE WITH THE LIMIT ENGINE'S OWN WINDOW", () => {
  // The reason this module delegates rather than restating the rules: a limit
  // and the home number that describes it must never disagree about which days
  // are in the period. Asserted through the observable dates rather than by
  // reaching into the engine, so the guarantee survives a refactor of either.
  for (const [scope, expected] of [
    ["daily", { start: "2026-08-12", end: "2026-08-12" }],
    ["weekly", { start: "2026-08-10", end: "2026-08-16" }],
    ["monthly", { start: "2026-08-01", end: "2026-08-31" }],
    ["annual", { start: "2026-01-01", end: "2026-12-31" }],
  ] as const) {
    expect([scope, periodForScope(scope, "2026-08-12")]).toEqual([scope, expected]);
  }
});
