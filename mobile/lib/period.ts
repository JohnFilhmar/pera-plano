// lib/period.ts — calendar periods as DATE RANGES (M3 Task 1).
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT A SECOND COPY OF THE SCOPE RULES
// ---------------------------------------------------------------------------
// `lib/limits/limit_engine.ts::periodWindowFor` already decides where a week,
// month or year begins, and every limit in the app is evaluated against it. The
// M3 plan's `periodForScope` restates those rules from scratch — and two
// implementations of "when does a week start" drift on exactly one day in
// seven, silently, in the one number the home screen exists to show.
//
// So this delegates. `periodWindowFor` answers in INSTANTS with a half-open
// `[from, to)` range (contract §3), because that is what a SQL predicate needs;
// Safe-to-Spend needs INCLUSIVE CALENDAR DATES, because it counts days a person
// can see on a calendar and compares them against bill due dates. The
// conversion is the whole of this module's first function.
//
// The plan also lists `parseDate`, `formatDate`, `addDays` and `lastDayOfMonth`
// here. All four already exist in `lib/dates.ts` as `parseDateIso`,
// `toDateIso`, `addDaysIso` and `lastDayOfMonth` — shipped, tested, and
// deliberately local-time. They are NOT re-exported under second names: one
// function with two import paths is how half a codebase ends up on each.
import { parseDateIso, toDateIso } from "@/lib/dates";
import { periodWindowFor } from "@/lib/limits/limit_engine";
import type { IsoDate, LimitScope } from "@/types/domain";

const DAY_MS = 86_400_000;

export type PeriodDates = {
  /** First calendar day of the period. */
  start: IsoDate;
  /** LAST calendar day, inclusive — not the exclusive bound. */
  end: IsoDate;
};

/**
 * The scope's window as inclusive calendar dates.
 *
 * Spec rule 1: daily = today, weekly = the current week, monthly = the calendar
 * month, annual = the calendar year, all in device-local time.
 *
 * `end` is the LAST DAY, taken one millisecond back from the window's exclusive
 * upper bound. Converting that bound directly would name the first day of the
 * NEXT period, and a monthly Safe-to-Spend would quietly count 32 days and
 * subtract next month's bills.
 */
export function periodForScope(scope: LimitScope, today: IsoDate): PeriodDates {
  const window = periodWindowFor(scope, parseDateIso(today).getTime());
  return {
    start: toDateIso(new Date(window.start)),
    end: toDateIso(new Date(window.end - 1)),
  };
}

/**
 * Days from `from` to `to`, counting BOTH ends: `daysBetweenInclusive(x, x)` is
 * 1, not 0.
 *
 * Inclusive because it answers "how many days do I have left", and the day you
 * are standing on is one of them — spec rule 7: "days remaining includes
 * today", which is also what makes a daily limit's divisor 1 rather than 0.
 *
 * Rounded rather than floored: local midnights are exactly 24h apart in a zone
 * with no daylight saving, which the Philippines is, but rounding costs nothing
 * and survives a device whose zone rules say otherwise.
 */
export function daysBetweenInclusive(from: IsoDate, to: IsoDate): number {
  const span = parseDateIso(to).getTime() - parseDateIso(from).getTime();
  return Math.round(span / DAY_MS) + 1;
}
