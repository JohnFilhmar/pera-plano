// lib/limits/__tests__/limit_engine_period.test.ts — m2 Task 4.
//
// Every instant is built with a LOCAL `new Date(y, m, d, hh, mm)` constructor.
// A limit's "this month" is a statement about the user's wall calendar, so a
// UTC-parsed fixture would agree with a UTC-based bug instead of catching it —
// the same rule lib/__tests__/dates.test.ts states.
//
// Calendar facts these fixtures rest on, spelled out so a failure is readable:
//   Aug 2 2026 is a SUNDAY, Aug 3 2026 a MONDAY, Jul 27 2026 a MONDAY.
//   2026 is a common year; 2028 is a leap year.
import type { LimitScope } from "@/types/domain";

import { periodWindowFor, previousPeriodWindow } from "../limit_engine";

const ms = (y: number, m: number, d: number, hh = 0, mm = 0) =>
  new Date(y, m, d, hh, mm).getTime();

const SCOPES: LimitScope[] = ["daily", "weekly", "monthly", "annual"];

// ---------------------------------------------------------------------------
// periodWindowFor — the four scopes (limits rule 1)
// ---------------------------------------------------------------------------
test("daily: local midnight to local midnight", () => {
  const w = periodWindowFor("daily", ms(2026, 7, 2, 15, 30)); // Aug 2 2026, 3:30 PM

  expect(w.start).toBe(ms(2026, 7, 2));
  expect(w.end).toBe(ms(2026, 7, 3));
  expect(w.daysTotal).toBe(1);
  expect(w.daysLeft).toBe(1); // a partial day still counts as a day remaining
});

test("weekly: Monday 00:00 through the next Monday 00:00", () => {
  // Aug 2 is a Sunday, so its week runs Mon Jul 27 .. Mon Aug 3.
  const w = periodWindowFor("weekly", ms(2026, 7, 2, 9, 0));

  expect(w.start).toBe(ms(2026, 6, 27));
  expect(w.end).toBe(ms(2026, 7, 3));
  expect(w.daysTotal).toBe(7);
  expect(w.daysLeft).toBe(1);
});

test("weekly: a Monday belongs to the week it STARTS, not the one it ends", () => {
  // The off-by-one that `(getDay() + 6) % 7` exists to prevent: JS numbers
  // Sunday as 0, so a naive `getDay() - 1` puts Monday at 0 and Sunday at -1,
  // dragging Sunday into the following week.
  const mon = periodWindowFor("weekly", ms(2026, 7, 3, 0, 0));

  expect(mon.start).toBe(ms(2026, 7, 3));
  expect(mon.end).toBe(ms(2026, 7, 10));
  expect(mon.daysLeft).toBe(7);
});

test("weekly: a Sunday belongs to the week that started six days earlier", () => {
  const sun = periodWindowFor("weekly", ms(2026, 7, 2, 23, 59));

  expect(sun.start).toBe(ms(2026, 6, 27));
  expect(sun.daysLeft).toBe(1);
});

test("monthly: the 1st through the 1st, short months included", () => {
  const aug = periodWindowFor("monthly", ms(2026, 7, 15));
  expect(aug.start).toBe(ms(2026, 7, 1));
  expect(aug.end).toBe(ms(2026, 8, 1));
  expect(aug.daysTotal).toBe(31);
  expect(aug.daysLeft).toBe(17); // Aug 15..31 inclusive

  expect(periodWindowFor("monthly", ms(2026, 1, 10)).daysTotal).toBe(28);
  expect(periodWindowFor("monthly", ms(2028, 1, 10)).daysTotal).toBe(29);
  expect(periodWindowFor("monthly", ms(2026, 3, 10)).daysTotal).toBe(30);
});

test("monthly: December rolls into January of the next year", () => {
  const dec = periodWindowFor("monthly", ms(2026, 11, 20));

  expect(dec.start).toBe(ms(2026, 11, 1));
  expect(dec.end).toBe(ms(2027, 0, 1));
});

test("annual: Jan 1 through Jan 1, leap years counted", () => {
  const w = periodWindowFor("annual", ms(2026, 7, 2));
  expect(w.start).toBe(ms(2026, 0, 1));
  expect(w.end).toBe(ms(2027, 0, 1));
  expect(w.daysTotal).toBe(365);

  expect(periodWindowFor("annual", ms(2028, 5, 1)).daysTotal).toBe(366);
});

// ---------------------------------------------------------------------------
// daysLeft — the figure the detail screen renders (limits rule 3)
// ---------------------------------------------------------------------------
test("daysLeft equals daysTotal at the exact start of every period", () => {
  for (const scope of SCOPES) {
    const w = periodWindowFor(scope, ms(2026, 7, 3)); // a Monday, so weekly starts here too
    const atStart = periodWindowFor(scope, w.start);
    expect([scope, atStart.daysLeft]).toEqual([scope, atStart.daysTotal]);
  }
});

test("daysLeft is 1 for the whole final day of a period, down to the last millisecond", () => {
  // Not 0. The user still has today to spend in, and a "0 days left" on a day
  // they can still transact reads as "the period is over".
  const lastDayMorning = periodWindowFor("monthly", ms(2026, 7, 31, 0, 0));
  const lastDayNight = periodWindowFor("monthly", new Date(2026, 7, 31, 23, 59, 59, 999).getTime());

  expect(lastDayMorning.daysLeft).toBe(1);
  expect(lastDayNight.daysLeft).toBe(1);
});

test("daysLeft counts down one per day across a month", () => {
  expect(periodWindowFor("monthly", ms(2026, 7, 29)).daysLeft).toBe(3);
  expect(periodWindowFor("monthly", ms(2026, 7, 30)).daysLeft).toBe(2);
  expect(periodWindowFor("monthly", ms(2026, 7, 31)).daysLeft).toBe(1);
});

// ---------------------------------------------------------------------------
// The invariants Tasks 5-7 and M3's Safe-to-Spend lean on
// ---------------------------------------------------------------------------
test("`end` is EXCLUSIVE: it belongs to the NEXT period, for every scope", () => {
  // This is what lets a window plug straight into sumSpend({ from, to }) with
  // no ±1ms fudge. An inclusive `end` would double-count every transaction
  // stamped exactly at midnight on a boundary.
  for (const scope of SCOPES) {
    const w = periodWindowFor(scope, ms(2026, 7, 2, 15, 30));
    const next = periodWindowFor(scope, w.end);
    expect([scope, next.start]).toEqual([scope, w.end]);
  }
});

test("periods TILE: the previous window ends exactly where the current one starts", () => {
  // No gap and no overlap. A gap loses spend; an overlap counts it in two
  // periods, and rollover (rule 14) reads the previous period's spend.
  for (const scope of SCOPES) {
    const at = ms(2026, 7, 2, 15, 30);
    const current = periodWindowFor(scope, at);
    const previous = previousPeriodWindow(scope, at);
    expect([scope, previous.end]).toEqual([scope, current.start]);
  }
});

test("a window contains the instant it was built from, half-open", () => {
  for (const scope of SCOPES) {
    const at = ms(2026, 1, 28, 23, 59);
    const w = periodWindowFor(scope, at);
    expect([scope, w.start <= at, at < w.end]).toEqual([scope, true, true]);
  }
});

// ---------------------------------------------------------------------------
// previousPeriodWindow
// ---------------------------------------------------------------------------
test("monthly previous from March 31 is the FULL February window", () => {
  // The classic month-arithmetic bug: subtracting a month from Mar 31 lands on
  // Feb 31, which Date silently normalises to Mar 3, and "last month" becomes
  // part of this one. Anchoring to the current window's start avoids it.
  const w = previousPeriodWindow("monthly", ms(2026, 2, 31));

  expect(w.start).toBe(ms(2026, 1, 1));
  expect(w.end).toBe(ms(2026, 2, 1));
  expect(w.daysTotal).toBe(28);
});

test("weekly previous crosses a month boundary", () => {
  // Aug 4 2026 is a Tuesday; its week starts Mon Aug 3, so the previous is
  // Mon Jul 27 .. Mon Aug 3.
  const w = previousPeriodWindow("weekly", ms(2026, 7, 4));

  expect(w.start).toBe(ms(2026, 6, 27));
  expect(w.end).toBe(ms(2026, 7, 3));
  expect(w.daysTotal).toBe(7);
});

test("daily previous from March 1 is the last day of February", () => {
  const w = previousPeriodWindow("daily", ms(2026, 2, 1, 8, 0));
  expect(w.start).toBe(ms(2026, 1, 28));
  expect(w.end).toBe(ms(2026, 2, 1));

  const leap = previousPeriodWindow("daily", ms(2028, 2, 1, 8, 0));
  expect(leap.start).toBe(ms(2028, 1, 29));
});

test("annual previous from the first instant of 2026 is all of 2025", () => {
  // `at` sitting exactly on a boundary is the case a naive `at - DAY_MS` gets
  // right by luck and a naive `at - 1 year` gets wrong.
  const w = previousPeriodWindow("annual", ms(2026, 0, 1));

  expect(w.start).toBe(ms(2025, 0, 1));
  expect(w.end).toBe(ms(2026, 0, 1));
  expect(w.daysTotal).toBe(365);
});

test("a previous period has no days left", () => {
  // It is over. Anything else would let a UI render "3 days left" against a
  // window that closed last month.
  for (const scope of SCOPES) {
    expect([scope, previousPeriodWindow(scope, ms(2026, 7, 2, 15, 30)).daysLeft]).toEqual([
      scope,
      0,
    ]);
  }
});
