// lib/dates.ts — calendar arithmetic for the control plane (m2 Task 1).
//
// NOT A DUPLICATE OF lib/datetime.ts, and the two must not be merged.
// `datetime.ts` turns an instant into something a person reads ("Aug 11, 2026",
// "2:05 PM"); its output is a label. This file does arithmetic on the calendar
// itself and its output is another machine value — an ISO date or an epoch
// millisecond that a query, a period window, or a scheduled reminder consumes.
// One is presentation, one is domain logic, and a bug in each looks completely
// different.
//
// EVERYTHING HERE IS LOCAL TIME, for the same reason datetime.ts says so: the
// Philippines is a single zone eight hours ahead of UTC, so `toISOString()`
// reports the *previous* day for every instant before 8am local. A limit's
// "this month", a bill's "due on the 15th", and an alert's "9am reminder" are
// all statements about the user's wall calendar, never about UTC.
//
// Dates cross this module as `'YYYY-MM-DD'` strings and instants as epoch
// milliseconds — interface contract §1. A `Date` object is only ever an
// intermediate here; none of these functions returns one except `parseDateIso`,
// whose whole job is to produce it.

/** `2026-01-31`. The LOCAL calendar date of a `Date`, zero-padded. */
export function toDateIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * `'2026-01-31'` → local midnight on that date.
 *
 * Built from the three numbers rather than handed to `new Date(iso)`, which the
 * spec requires be parsed as UTC for the bare `YYYY-MM-DD` form — that returns
 * 8am Manila on the 31st, and every calculation downstream inherits the shift.
 */
export function parseDateIso(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Adds (or, negative, subtracts) whole days to an ISO date.
 *
 * Goes through `Date.setDate`, NOT `+ days * 86_400_000`. The two agree in a
 * zone with no daylight saving, which the Philippines currently is — but the
 * millisecond version encodes "a day is a fixed duration", which is a different
 * claim from "the next square on the calendar", and it is the wrong one for
 * every function here. `setDate` also normalises overflow for free: day 32 of
 * January is February 1st.
 */
export function addDaysIso(iso: string, days: number): string {
  const d = parseDateIso(iso);
  d.setDate(d.getDate() + days);
  return toDateIso(d);
}

/**
 * How many days that month has. Leap years included, century rule included —
 * `new Date(y, m + 1, 0)` is day zero of the *next* month, which is the last
 * day of this one, and the engine does the arithmetic.
 *
 * `monthIndex` is 0-based, matching `Date.getMonth()`, so a caller never has to
 * convert between two month conventions in the same expression.
 */
export function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Adds months, CLAMPING the day to the target month's length.
 *
 * THE BUG THIS EXISTS TO PREVENT: `d.setMonth(d.getMonth() + 1)` on January 31st
 * produces March 3rd, because February has no 31st and `Date` overflows forward.
 * A monthly bill due on the 31st would silently skip February entirely — no
 * error, no reminder, one missed payment. Clamped, it lands on the 28th (29th in
 * a leap year), which is what "the end of the month" means to the person who set
 * it.
 *
 * Clamping is measured against the ORIGINAL day, not a previously clamped one:
 * two months from January 31st is March 31st, not March 28th. Carrying the
 * clamp forward would walk a month-end schedule backwards a few days per year.
 */
export function addMonthsClampedIso(iso: string, months: number): string {
  const d = parseDateIso(iso);

  // Absolute month index from the original date, so negative `months` works
  // without a separate branch. `Math.floor` (not `Math.trunc`) and the
  // `((x % 12) + 12) % 12` idiom are both there because JS `%` keeps the sign
  // of the dividend: -1 % 12 is -1, which is not a month.
  const targetMonth = d.getMonth() + months;
  const year = d.getFullYear() + Math.floor(targetMonth / 12);
  const monthIndex = ((targetMonth % 12) + 12) % 12;
  const day = Math.min(d.getDate(), lastDayOfMonth(year, monthIndex));

  return toDateIso(new Date(year, monthIndex, day));
}

/** Local midnight opening the day that `ms` falls in. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Local midnight opening the NEXT day — an EXCLUSIVE upper bound.
 *
 * Contract §3: date ranges are `[from, to)` everywhere, settled by the
 * foundation's implementation. Returning 23:59:59.999 instead would drop any
 * transaction stamped in that final millisecond, and would make two adjacent
 * days' windows fail to tile.
 */
export function endOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/**
 * A wall-clock time on an ISO date, as an instant — how a 9am bill reminder
 * becomes something the scheduler can hold.
 */
export function atLocalTime(iso: string, hour: number, minute: number): number {
  const d = parseDateIso(iso);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute).getTime();
}
