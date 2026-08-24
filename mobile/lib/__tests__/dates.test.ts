// lib/__tests__/dates.test.ts — m2 Task 1.
//
// Every expectation is built with a LOCAL `new Date(y, m, d, ...)` constructor,
// never a UTC string parse and never `Date.now()`. `new Date("2026-01-31")` is
// parsed as UTC midnight, which in Manila is 8am on the 31st — so a test written
// that way would agree with a buggy implementation that also went through UTC.
import {
  addDaysIso,
  addMonthsClampedIso,
  atLocalTime,
  endOfLocalDay,
  lastDayOfMonth,
  parseDateIso,
  startOfLocalDay,
  toDateIso,
} from "../dates";

// ---------------------------------------------------------------------------
// toDateIso / parseDateIso
// ---------------------------------------------------------------------------
test("toDateIso reads the LOCAL calendar date, zero-padded", () => {
  expect(toDateIso(new Date(2026, 0, 31))).toBe("2026-01-31");
  expect(toDateIso(new Date(2026, 8, 5))).toBe("2026-09-05");
});

test("toDateIso does not shift the date for a late-evening instant", () => {
  // 11pm local on the 31st is already the 1st in UTC. A `toISOString().slice(0, 10)`
  // implementation returns "2026-02-01" here and is wrong for every PH user.
  expect(toDateIso(new Date(2026, 0, 31, 23, 30))).toBe("2026-01-31");
});

test("parseDateIso returns local midnight, not UTC midnight", () => {
  const parsed = parseDateIso("2026-01-31");

  expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([2026, 0, 31]);
  expect(parsed.getHours()).toBe(0);
  expect(parsed.getMinutes()).toBe(0);
});

test("iso round-trips through a Date unchanged", () => {
  for (const iso of ["2026-01-01", "2026-02-28", "2028-02-29", "2026-12-31"]) {
    expect(toDateIso(parseDateIso(iso))).toBe(iso);
  }
});

// ---------------------------------------------------------------------------
// addDaysIso
// ---------------------------------------------------------------------------
test("addDaysIso crosses month, year and leap boundaries", () => {
  expect(addDaysIso("2026-01-30", 3)).toBe("2026-02-02");
  expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  expect(addDaysIso("2028-03-01", -1)).toBe("2028-02-29");
  expect(addDaysIso("2026-08-02", 0)).toBe("2026-08-02");
});

test("addDaysIso is not fixed-millisecond arithmetic", () => {
  // A `+ days * 86_400_000` implementation is correct in a zone with no DST and
  // wrong the moment one is introduced; going through the local Date keeps the
  // calendar meaning of "a day" rather than a duration.
  expect(addDaysIso("2026-01-01", 365)).toBe("2027-01-01");
  expect(addDaysIso("2028-01-01", 365)).toBe("2028-12-31"); // leap year: 366 days
});

// ---------------------------------------------------------------------------
// addMonthsClampedIso — the rule bills and limits both lean on
// ---------------------------------------------------------------------------
test("addMonthsClampedIso clamps to month end and never skips a month", () => {
  // The bug this exists to prevent: `setMonth(m + 1)` on Jan 31 overflows into
  // March 3, so a monthly bill due on the 31st silently skips February.
  expect(addMonthsClampedIso("2026-01-31", 1)).toBe("2026-02-28");
  expect(addMonthsClampedIso("2028-01-31", 1)).toBe("2028-02-29");
  expect(addMonthsClampedIso("2026-10-31", 1)).toBe("2026-11-30");
});

test("addMonthsClampedIso clamps against the ORIGINAL day, not a carried-forward one", () => {
  // Two months from Jan 31 is Mar 31, not Feb 28 carried forward to Mar 28.
  expect(addMonthsClampedIso("2026-01-31", 2)).toBe("2026-03-31");
  expect(addMonthsClampedIso("2026-01-31", 3)).toBe("2026-04-30");
});

test("addMonthsClampedIso crosses years in both directions", () => {
  expect(addMonthsClampedIso("2026-12-15", 1)).toBe("2027-01-15");
  expect(addMonthsClampedIso("2026-01-15", -1)).toBe("2025-12-15");
  expect(addMonthsClampedIso("2026-03-31", -1)).toBe("2026-02-28");
  expect(addMonthsClampedIso("2026-06-15", -12)).toBe("2025-06-15");
  expect(addMonthsClampedIso("2026-06-15", 0)).toBe("2026-06-15");
});

// ---------------------------------------------------------------------------
// lastDayOfMonth
// ---------------------------------------------------------------------------
test("lastDayOfMonth knows month lengths, leap years included", () => {
  expect(lastDayOfMonth(2026, 0)).toBe(31); // January
  expect(lastDayOfMonth(2026, 1)).toBe(28); // February, common year
  expect(lastDayOfMonth(2028, 1)).toBe(29); // February, leap year
  expect(lastDayOfMonth(2100, 1)).toBe(28); // century, NOT a leap year
  expect(lastDayOfMonth(2000, 1)).toBe(29); // 400-year rule: leap after all
  expect(lastDayOfMonth(2026, 3)).toBe(30); // April
  expect(lastDayOfMonth(2026, 11)).toBe(31); // December
});

// ---------------------------------------------------------------------------
// Local-day bounds — the [from, to) window every period query uses
// ---------------------------------------------------------------------------
test("startOfLocalDay and endOfLocalDay bracket the local calendar day", () => {
  const noon = new Date(2026, 7, 2, 12, 34).getTime();

  expect(startOfLocalDay(noon)).toBe(new Date(2026, 7, 2, 0, 0).getTime());
  // Exclusive upper bound — contract §3: ranges are [from, to).
  expect(endOfLocalDay(noon)).toBe(new Date(2026, 7, 3, 0, 0).getTime());
});

test("local-day bounds are idempotent and cross month ends", () => {
  const midnight = new Date(2026, 7, 2, 0, 0).getTime();
  expect(startOfLocalDay(midnight)).toBe(midnight);

  const lastMoment = new Date(2026, 7, 2, 23, 59, 59, 999).getTime();
  expect(startOfLocalDay(lastMoment)).toBe(midnight);

  const monthEnd = new Date(2026, 0, 31, 18, 0).getTime();
  expect(endOfLocalDay(monthEnd)).toBe(new Date(2026, 1, 1, 0, 0).getTime());
});

test("atLocalTime pins a wall-clock time on an iso date", () => {
  expect(atLocalTime("2026-08-02", 9, 0)).toBe(new Date(2026, 7, 2, 9, 0).getTime());
  expect(atLocalTime("2026-08-02", 0, 0)).toBe(new Date(2026, 7, 2, 0, 0).getTime());
  // 9am reminders are scheduled through this; a UTC-based implementation would
  // fire them at 5pm the previous day in Manila.
  expect(atLocalTime("2026-12-31", 23, 59)).toBe(new Date(2026, 11, 31, 23, 59).getTime());
});

test("atLocalTime lands on the same day startOfLocalDay reports", () => {
  const at = atLocalTime("2026-02-28", 21, 30);
  expect(startOfLocalDay(at)).toBe(parseDateIso("2026-02-28").getTime());
});
