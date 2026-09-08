// lib/bills/due_rules.ts — when a Bill is due (m2c Task 2).
//
// Pure calendar arithmetic: a rule plus a date in, ISO dates out. No database,
// no clock — every function takes the date it should reason from, so every case
// in the test file is a fixture rather than a stubbed today.
//
// ---------------------------------------------------------------------------
// The output is the ADJUSTED date, everywhere
// ---------------------------------------------------------------------------
// Spec rule 3: "Reminders and the auto-match date window are computed from the
// adjusted date", and `bill_cycles.due_date` stores it (migration 006). So the
// weekday shift is applied here, once, and nothing downstream has to remember
// to apply it — the unadjusted date is recomputable from the rule for the one
// screen that shows it "for transparency".
//
// ORDER: clamp, then adjust. Only one of those orders is even computable —
// February has no 31st to ask the weekday of — and the other would produce a
// date outside the month.
//
// ADJUSTMENT NEVER LEAVES THE MONTH. A Sunday the 31st moved "later" would be
// the 1st of the next month, which puts two due dates in that month and none in
// this one: it breaks the one-per-month promise (spec rule 2's "clamping never
// skips a month") and collides with the next month's own cycle on the
// `UNIQUE (bill_id, due_date)` that identifies a cycle. It falls back to the
// nearest weekday inside the month instead.
import { addDaysIso, lastDayOfMonth, parseDateIso, toDateIso } from "@/lib/dates";
import type { DueRule, IsoDate, WeekdayAdjust } from "@/types/domain";

/**
 * How far either side of a window to generate before filtering. The weekday
 * shift moves a date by at most two days (spec rule 3), so a base occurrence up
 * to two days outside the window can land inside it.
 */
const ADJUST_SLACK_DAYS = 3;

function isoOf(year: number, monthIndex: number, day: number): IsoDate {
  return toDateIso(new Date(year, monthIndex, day));
}

function weekdayOf(iso: IsoDate): number {
  return parseDateIso(iso).getDay();
}

/** Clamps a day-of-month to the month's real length (spec rule 2). */
function clampedDay(year: number, monthIndex: number, day: number): IsoDate {
  return isoOf(year, monthIndex, Math.min(day, lastDayOfMonth(year, monthIndex)));
}

/**
 * The weekend shift, kept inside the month.
 *
 * Falls back in the OPPOSITE direction when the requested one would leave the
 * month — the fallback is still a weekday and still within two days, which is
 * the only pair of promises spec rule 3 actually makes.
 */
function applyWeekdayAdjust(iso: IsoDate, adjust: WeekdayAdjust): IsoDate {
  if (adjust === "none") return iso;

  const day = weekdayOf(iso);
  if (day !== 0 && day !== 6) return iso;

  const date = parseDateIso(iso);
  const monthIndex = date.getMonth();
  // Saturday moves 1 back or 2 forward; Sunday moves 2 back or 1 forward.
  const shift = adjust === "earlier" ? (day === 6 ? -1 : -2) : day === 6 ? 2 : 1;

  const moved = addDaysIso(iso, shift);
  if (parseDateIso(moved).getMonth() === monthIndex) return moved;

  // Would have left the month. The other direction is the nearest weekday that
  // does not, and it cannot also leave: a weekend at one end of a month has a
  // weekday at the other end within two days.
  return addDaysIso(iso, adjust === "earlier" ? (day === 6 ? 2 : 1) : day === 6 ? -1 : -2);
}

function adjustOf(rule: DueRule): WeekdayAdjust {
  // Week-based rules ignore it: the spec scopes the adjustment to month-based
  // rules, and a user who set a weekly bill to Sunday chose Sunday.
  if (rule.kind === "every-n-weeks") return "none";
  return rule.weekdayAdjust ?? "none";
}

/**
 * The UNADJUSTED occurrences of a month-shaped rule within one month.
 * Week-based rules do not go through here — they are not anchored to months.
 */
function baseOccurrencesInMonth(rule: DueRule, year: number, monthIndex: number): IsoDate[] {
  switch (rule.kind) {
    case "day-of-month":
      return [clampedDay(year, monthIndex, rule.day)];
    case "last-day-of-month":
      return [clampedDay(year, monthIndex, 31)];
    case "semi-monthly":
      // The 15th and KATAPUSAN — the last calendar day, not the 30th. February
      // pays on the 28th, and a 31-day month pays on the 31st.
      return [isoOf(year, monthIndex, 15), clampedDay(year, monthIndex, 31)];
    case "every-n-months": {
      // `anchorMonth` is 1-12 and fixes the phase: every 3 months from January
      // is a different bill from every 3 months from February.
      const offset = monthIndex - (rule.anchorMonth - 1);
      const phase = ((offset % rule.n) + rule.n) % rule.n;
      return phase === 0 ? [clampedDay(year, monthIndex, rule.day)] : [];
    }
    case "every-n-weeks":
      return [];
  }
}

/** Whole-day steps from the anchor, in ISO space rather than milliseconds. */
function weekOccurrencesBetween(
  rule: Extract<DueRule, { kind: "every-n-weeks" }>,
  fromDate: IsoDate,
  toDate: IsoDate,
): IsoDate[] {
  // An anchor off its own weekday would put a "Friday" bill on Wednesdays
  // forever. The form should not produce one; a promoted or hand-edited rule
  // can, so it is normalised forward onto the rule's weekday.
  const anchorDrift = (rule.weekday - weekdayOf(rule.anchorDate) + 7) % 7;
  const anchor = addDaysIso(rule.anchorDate, anchorDrift);

  const step = rule.n * 7;
  const dates: IsoDate[] = [];

  // Jump straight to the first step at or after `fromDate` rather than walking
  // from the anchor: a fortnightly bill anchored years ago should not cost
  // hundreds of iterations to list one month of.
  const daysFromAnchor = Math.round(
    (parseDateIso(fromDate).getTime() - parseDateIso(anchor).getTime()) / 86_400_000,
  );
  const stepsToSkip = Math.max(0, Math.ceil(daysFromAnchor / step));

  for (let i = stepsToSkip; ; i += 1) {
    const date = addDaysIso(anchor, i * step);
    if (date > toDate) break;
    if (date >= fromDate) dates.push(date);
    // An anchor far in the future: the first candidate already overshoots.
    if (i > stepsToSkip + 1000) break;
  }
  return dates;
}

/**
 * Every occurrence between two calendar dates, INCLUSIVE OF BOTH BOUNDS.
 *
 * Deliberately not the app's usual half-open `[from, to)` (contract §3): these
 * are calendar dates a person reads off a screen, not instants. "Bills due
 * between the 15th and the 15th" has to include both 15ths.
 */
export function occurrencesBetween(
  rule: DueRule,
  fromDate: IsoDate,
  toDate: IsoDate,
): IsoDate[] {
  if (toDate < fromDate) return [];

  const adjust = adjustOf(rule);

  if (rule.kind === "every-n-weeks") {
    return weekOccurrencesBetween(rule, fromDate, toDate);
  }

  // Generate over a padded window, because a base date just outside it can be
  // shifted into range — and one just inside can be shifted out.
  const start = parseDateIso(addDaysIso(fromDate, -ADJUST_SLACK_DAYS));
  const end = parseDateIso(addDaysIso(toDate, ADJUST_SLACK_DAYS));

  const dates = new Set<IsoDate>();
  for (
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    cursor <= end;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    for (const base of baseOccurrencesInMonth(rule, cursor.getFullYear(), cursor.getMonth())) {
      const due = applyWeekdayAdjust(base, adjust);
      if (due >= fromDate && due <= toDate) dates.add(due);
    }
  }

  return [...dates].sort();
}

/**
 * The date an occurrence would have fallen on BEFORE the weekday shift.
 *
 * Spec rule 3: "Weekday adjustment moves the due date at most 2 days; the
 * UNADJUSTED date is still shown in the bill detail for transparency." Only the
 * adjusted date is stored (migration 006), because every downstream date is
 * computed from it — so the base date is recovered from the rule here, which is
 * exactly what this file's header says it is recoverable for.
 *
 * Returns `adjustedDate` unchanged whenever nothing moved: a rule with no
 * adjustment, a week-based rule (which ignores the shift by design), or a date
 * that never landed on a weekend. The detail screen shows the line only when
 * the two differ, so "unchanged" reads as "there was no shift".
 */
export function unadjustedOccurrence(rule: DueRule, adjustedDate: IsoDate): IsoDate {
  const adjust = adjustOf(rule);
  if (adjust === "none") return adjustedDate;

  // The shift never leaves the month (see the header), so the base occurrence
  // is among that month's own — no neighbouring month can have produced it.
  const date = parseDateIso(adjustedDate);
  for (const base of baseOccurrencesInMonth(rule, date.getFullYear(), date.getMonth())) {
    if (applyWeekdayAdjust(base, adjust) === adjustedDate) return base;
  }

  // No base occurrence adjusts onto this date: the rule was edited while an
  // older cycle was still open (rule 25), so the stored date is the only fact
  // left. Reporting it is honest; inventing a base for a rule that no longer
  // produces this occurrence is not.
  return adjustedDate;
}

/**
 * The first occurrence STRICTLY AFTER `afterDate`.
 *
 * Strictly, because a bill due today has already been enumerated: an inclusive
 * answer would keep returning today and the reminder scheduler would never
 * advance past it.
 *
 * Spec rule 1 — "a bill's next due date is always computable and displayed;
 * there is never a bill without a known next due date" — is why this returns a
 * date rather than `null`. The search window widens rather than giving up: a
 * yearly rule can be eleven months away, and a 3-year fortnightly gap cannot
 * happen at all.
 */
export function nextOccurrence(rule: DueRule, afterDate: IsoDate): IsoDate {
  const from = addDaysIso(afterDate, 1);
  for (const span of [45, 400, 1500]) {
    const found = occurrencesBetween(rule, from, addDaysIso(from, span));
    if (found.length > 0) return found[0];
  }
  // Unreachable for every variant of DueRule: the widest gap any of them can
  // produce is `every-n-months` with a large n, and 1500 days covers n = 48.
  throw new Error(`no occurrence of ${rule.kind} within four years of ${afterDate}`);
}

/**
 * Spec rule 21: a cycle becomes overdue at the START OF THE DAY AFTER its
 * (adjusted) due date, if it is neither paid nor skipped.
 *
 * The parameter is `resolved`, not the plan's `paid`. A cycle also resolves by
 * being SKIPPED or paid outside every tracked wallet; called with `paid` a
 * caller would naturally pass `state === "paid"` and leave a skipped cycle
 * nagging the user forever.
 */
export function isOverdue(dueDate: IsoDate, resolved: boolean, today: IsoDate): boolean {
  if (resolved) return false;
  return dueDate < today;
}

/**
 * Whole calendar days from `today` to `dueDate` — negative once past, zero on
 * the day itself.
 *
 * Counted in calendar squares rather than as a duration divided by 86,400,000.
 * The two agree in a zone with no daylight saving, which the Philippines is,
 * but they encode different claims and only one of them is what "3 days before
 * the due date" means.
 */
export function daysUntil(dueDate: IsoDate, today: IsoDate): number {
  const from = parseDateIso(today);
  const to = parseDateIso(dueDate);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}
