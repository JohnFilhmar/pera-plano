// lib/bills/__tests__/due_rules.test.ts — m2c Task 2.
//
// "The calendar is where date code goes wrong. Every rule below has a test
// because every one of them has bitten a real app." Fixtures are pinned to
// 2026-2029 and every weekday claim in a comment is a fact about those dates,
// not an assumption — 2026-01-01 is a Thursday.
import {
  daysUntil,
  isOverdue,
  nextOccurrence,
  occurrencesBetween,
  periodDays,
  unadjustedOccurrence,
} from "@/lib/bills/due_rules";
import type { DueRule } from "@/types/domain";

const DAY_31: DueRule = { kind: "day-of-month", day: 31 };
const DAY_15: DueRule = { kind: "day-of-month", day: 15 };

// ---------------------------------------------------------------------------
// Month-length clamping — plan rules 1-2, spec rule 2
// ---------------------------------------------------------------------------
test("day-of-month 31 CLAMPS TO 28 IN A NON-LEAP FEBRUARY", () => {
  // Never rolls into the next month: a bill due the 31st is not due on March
  // 3rd, which is what `Date.setMonth` produces if left to overflow.
  expect(nextOccurrence(DAY_31, "2027-02-01")).toBe("2027-02-28");
});

test("day-of-month 31 CLAMPS TO 29 IN A LEAP FEBRUARY", () => {
  expect(nextOccurrence(DAY_31, "2028-02-01")).toBe("2028-02-29");
});

test("day-of-month 31 clamps to 30 in April", () => {
  expect(nextOccurrence(DAY_31, "2026-04-01")).toBe("2026-04-30");
});

test("day-of-month 15 in a 31-day month is unchanged", () => {
  expect(nextOccurrence(DAY_15, "2026-01-01")).toBe("2026-01-15");
});

test("CLAMPING NEVER SKIPS A MONTH", () => {
  // Spec rule 2's second half. The failure it guards against is silent: a
  // monthly bill due the 31st that produces no February occurrence at all is
  // one missed payment with no error anywhere.
  expect(occurrencesBetween(DAY_31, "2026-01-01", "2026-04-30")).toEqual([
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
  ]);
});

test("clamping is measured from the ORIGINAL day, not a previous clamp", () => {
  // Two months on from the 31st is the 31st again, not the 28th. Carrying a
  // clamp forward walks a month-end schedule backwards a few days a year.
  expect(occurrencesBetween(DAY_31, "2026-02-01", "2026-03-31")).toEqual([
    "2026-02-28",
    "2026-03-31",
  ]);
});

// ---------------------------------------------------------------------------
// The month-shaped rules — spec's due-rule table
// ---------------------------------------------------------------------------
test("SEMI-MONTHLY YIELDS THE 15TH AND THE LAST DAY — KINSENAS AND KATAPUSAN", () => {
  // The spec is explicit that the second date is KATAPUSAN, the last calendar
  // day, not the 30th: February pays on the 28th, not on a date that does not
  // exist, and a 31-day month pays on the 31st.
  expect(occurrencesBetween({ kind: "semi-monthly" }, "2026-01-01", "2026-02-28")).toEqual([
    "2026-01-15",
    "2026-01-31",
    "2026-02-15",
    "2026-02-28",
  ]);
});

test("last-day-of-month yields 28, 29, 30 or 31 depending on the month", () => {
  const rule: DueRule = { kind: "last-day-of-month" };
  expect(occurrencesBetween(rule, "2026-01-01", "2026-04-30")).toEqual([
    "2026-01-31",
    "2026-02-28",
    "2026-03-31",
    "2026-04-30",
  ]);
  expect(nextOccurrence(rule, "2028-02-01")).toBe("2028-02-29");
});

test("EVERY N MONTHS LANDS ON THE ANCHOR'S QUARTERS, NOT ON EVERY MONTH", () => {
  // Quarterly insurance and tuition. `anchorMonth` is what makes "every 3
  // months on the 10th" a different bill starting in January than in February.
  const rule: DueRule = { kind: "every-n-months", n: 3, day: 10, anchorMonth: 1 };
  expect(occurrencesBetween(rule, "2026-01-01", "2026-12-31")).toEqual([
    "2026-01-10",
    "2026-04-10",
    "2026-07-10",
    "2026-10-10",
  ]);

  const february: DueRule = { kind: "every-n-months", n: 3, day: 10, anchorMonth: 2 };
  expect(occurrencesBetween(february, "2026-01-01", "2026-12-31")).toEqual([
    "2026-02-10",
    "2026-05-10",
    "2026-08-10",
    "2026-11-10",
  ]);
});

test("ANNUAL ON FEBRUARY 29 FALLS BACK TO FEBRUARY 28 IN A NON-LEAP YEAR", () => {
  // Annual is `every-n-months` with n = 12; the pinned union has no separate
  // variant and does not need one.
  const rule: DueRule = { kind: "every-n-months", n: 12, day: 29, anchorMonth: 2 };
  expect(nextOccurrence(rule, "2028-01-01")).toBe("2028-02-29");
  expect(nextOccurrence(rule, "2029-01-01")).toBe("2029-02-28");
});

test("EVERY N WEEKS COUNTS WHOLE DAYS FROM THE ANCHOR", () => {
  // 2026-01-02 is a Friday. Fortnightly means every 14th day from it — not
  // "the first and third Friday", which drifts in five-Friday months.
  const rule: DueRule = { kind: "every-n-weeks", n: 2, weekday: 5, anchorDate: "2026-01-02" };
  expect(occurrencesBetween(rule, "2026-01-01", "2026-02-28")).toEqual([
    "2026-01-02",
    "2026-01-16",
    "2026-01-30",
    "2026-02-13",
    "2026-02-27",
  ]);
});

test("a weekly rule is every-n-weeks with n = 1", () => {
  const rule: DueRule = { kind: "every-n-weeks", n: 1, weekday: 5, anchorDate: "2026-01-02" };
  expect(occurrencesBetween(rule, "2026-01-01", "2026-01-31")).toEqual([
    "2026-01-02",
    "2026-01-09",
    "2026-01-16",
    "2026-01-23",
    "2026-01-30",
  ]);
});

test("an anchor that is not on the rule's own weekday is moved onto it", () => {
  // The form should never produce this, but a hand-edited or promoted rule can.
  // Silently counting fortnights from a Wednesday would put a "Friday" bill on
  // Wednesdays forever.
  const rule: DueRule = { kind: "every-n-weeks", n: 2, weekday: 5, anchorDate: "2026-01-01" };
  expect(occurrencesBetween(rule, "2026-01-01", "2026-01-31")).toEqual([
    "2026-01-02",
    "2026-01-16",
    "2026-01-30",
  ]);
});

// ---------------------------------------------------------------------------
// Weekday adjustment — spec rule 3, plan rule 4
// ---------------------------------------------------------------------------
test("EARLIER MOVES A SUNDAY DUE DATE TO THE PRECEDING FRIDAY", () => {
  // 2026-02-15 is a Sunday. The kinsenas earner's story: pay while
  // over-the-counter and payroll timing still work.
  const rule: DueRule = { kind: "day-of-month", day: 15, weekdayAdjust: "earlier" };
  expect(nextOccurrence(rule, "2026-02-01")).toBe("2026-02-13");
});

test("LATER MOVES A SATURDAY DUE DATE TO THE FOLLOWING MONDAY", () => {
  // 2026-08-01 is a Saturday.
  const rule: DueRule = { kind: "day-of-month", day: 1, weekdayAdjust: "later" };
  expect(nextOccurrence(rule, "2026-07-15")).toBe("2026-08-03");
});

test("A WEEKDAY IS LEFT ALONE, AND THE SHIFT IS AT MOST TWO DAYS", () => {
  // Spec rule 3. 2026-02-20 is a Friday; 2026-02-21 is a Saturday.
  const earlier: DueRule = { kind: "day-of-month", day: 20, weekdayAdjust: "earlier" };
  expect(nextOccurrence(earlier, "2026-02-01")).toBe("2026-02-20");

  const saturday: DueRule = { kind: "day-of-month", day: 21, weekdayAdjust: "earlier" };
  expect(nextOccurrence(saturday, "2026-02-01")).toBe("2026-02-20");
});

test("WEEKDAY ADJUSTMENT NEVER CROSSES A MONTH BOUNDARY", () => {
  // 2026-05-31 is a Sunday. "later" would be June 1 — which would put TWO due
  // dates in June and none in May, breaking both the one-per-month promise and
  // the cycle key (`bill_cycles` is UNIQUE on bill + adjusted due date).
  // Falls back to the nearest weekday inside the month: Friday the 29th.
  const later: DueRule = { kind: "last-day-of-month", weekdayAdjust: "later" };
  expect(nextOccurrence(later, "2026-05-01")).toBe("2026-05-29");

  // And the mirror: 2026-02-01 is a Sunday, so "earlier" would be January 30.
  const earlier: DueRule = { kind: "day-of-month", day: 1, weekdayAdjust: "earlier" };
  expect(nextOccurrence(earlier, "2026-01-15")).toBe("2026-02-02");
});

test("ADJUSTMENT HAPPENS AFTER CLAMPING, NOT BEFORE", () => {
  // Order matters and only one order is even computable: February has no 31st
  // to ask the weekday of. Clamped first to the 28th — a Saturday in 2026 —
  // then moved earlier to Friday the 27th.
  const rule: DueRule = { kind: "day-of-month", day: 31, weekdayAdjust: "earlier" };
  expect(nextOccurrence(rule, "2026-02-01")).toBe("2026-02-27");
});

test("SEMI-MONTHLY ADJUSTS BOTH OF ITS DATES", () => {
  // 2026-02-15 is a Sunday and 2026-02-28 is a Saturday — the month where a
  // kinsenas bill needs the shift twice.
  const rule: DueRule = { kind: "semi-monthly", weekdayAdjust: "earlier" };
  expect(occurrencesBetween(rule, "2026-02-01", "2026-02-28")).toEqual([
    "2026-02-13",
    "2026-02-27",
  ]);
});

test("A WEEK-BASED RULE IGNORES WEEKDAY ADJUSTMENT ENTIRELY", () => {
  // Spec: the adjustment "applies to month-based rules". A user who picked
  // Sunday for a weekly bill picked Sunday; shifting it to Friday would
  // overrule the only thing that rule says.
  const rule: DueRule = {
    kind: "every-n-weeks",
    n: 1,
    weekday: 0,
    anchorDate: "2026-01-04",
    weekdayAdjust: "earlier",
  };
  expect(occurrencesBetween(rule, "2026-01-01", "2026-01-25")).toEqual([
    "2026-01-04",
    "2026-01-11",
    "2026-01-18",
    "2026-01-25",
  ]);
});

// ---------------------------------------------------------------------------
// Boundaries and rollover
// ---------------------------------------------------------------------------
test("DECEMBER ROLLS OVER INTO JANUARY OF THE NEXT YEAR", () => {
  expect(nextOccurrence(DAY_15, "2026-12-20")).toBe("2027-01-15");
  expect(occurrencesBetween(DAY_15, "2026-12-01", "2027-01-31")).toEqual([
    "2026-12-15",
    "2027-01-15",
  ]);
});

test("nextOccurrence is STRICTLY after the date it is given", () => {
  // A bill due today has already been enumerated; asking what comes next must
  // not answer "today" forever, or the reminder scheduler never advances.
  expect(nextOccurrence(DAY_15, "2026-01-15")).toBe("2026-02-15");
});

test("occurrencesBetween is INCLUSIVE OF BOTH BOUNDS", () => {
  // Deliberately not the app's usual half-open `[from, to)`. These are calendar
  // dates a person reads off a screen, not instants: "bills due between the
  // 15th and the 15th" has to include both 15ths.
  expect(occurrencesBetween(DAY_15, "2026-01-15", "2026-03-15")).toEqual([
    "2026-01-15",
    "2026-02-15",
    "2026-03-15",
  ]);
});

test("an empty window yields nothing, and never throws", () => {
  expect(occurrencesBetween(DAY_15, "2026-01-16", "2026-02-14")).toEqual([]);
  expect(occurrencesBetween(DAY_15, "2026-03-01", "2026-01-01")).toEqual([]);
});

test("occurrences are unique and ascending even when adjustment collides", () => {
  // Two base dates can land on the same weekday-adjusted date in principle;
  // a duplicate would create a second cycle for one occurrence, which the
  // `UNIQUE (bill_id, due_date)` in migration 006 would then reject at write
  // time rather than here.
  const dates = occurrencesBetween(
    { kind: "semi-monthly", weekdayAdjust: "later" },
    "2026-01-01",
    "2026-12-31",
  );
  expect(new Set(dates).size).toBe(dates.length);
  expect([...dates].sort()).toEqual(dates);
});

// ---------------------------------------------------------------------------
// Overdue and countdown — spec rules 7, 21
// ---------------------------------------------------------------------------
test("A BILL DUE TODAY IS NEVER OVERDUE", () => {
  // Spec rule 21: a cycle becomes overdue at the START OF THE DAY AFTER its
  // due date. The user has the whole day to pay it.
  expect(isOverdue("2026-08-15", false, "2026-08-15")).toBe(false);
});

test("an unresolved bill due yesterday is overdue", () => {
  expect(isOverdue("2026-08-14", false, "2026-08-15")).toBe(true);
});

test("A RESOLVED CYCLE IS NEVER OVERDUE, WHICHEVER WAY IT RESOLVED", () => {
  // The plan's parameter is `paid`; a cycle also resolves by being SKIPPED
  // (rule 21) or paid outside every tracked wallet. Naming it `paid` would
  // invite a caller to pass `state === "paid"` and leave a skipped cycle
  // nagging the user forever.
  expect(isOverdue("2026-08-14", true, "2026-08-15")).toBe(false);
  expect(isOverdue("2020-01-01", true, "2026-08-15")).toBe(false);
});

test("a future bill is not overdue", () => {
  expect(isOverdue("2026-09-01", false, "2026-08-15")).toBe(false);
});

test("daysUntil is negative for a past date, zero today, positive ahead", () => {
  expect(daysUntil("2026-08-14", "2026-08-15")).toBe(-1);
  expect(daysUntil("2026-08-15", "2026-08-15")).toBe(0);
  expect(daysUntil("2026-08-20", "2026-08-15")).toBe(5);
});

test("daysUntil counts CALENDAR days across a month and a year boundary", () => {
  // Whole calendar squares, not a duration divided by 86,400,000 — the two
  // agree in a zone with no daylight saving and encode different claims.
  expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
  expect(daysUntil("2026-03-01", "2026-02-28")).toBe(1); // 2026 is not a leap year
  expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2); // 2028 is
});

// ---------------------------------------------------------------------------
// The unadjusted date — spec rule 3 (GAP-085)
// ---------------------------------------------------------------------------
// "Weekday adjustment moves the due date at most 2 days; the UNADJUSTED date is
// still shown in the bill detail for transparency." Only the adjusted date is
// stored (migration 006), so the detail screen recovers the base one from the
// rule — which this file's header has always said it can.
test("THE UNADJUSTED DATE IS RECOVERED FROM THE RULE", () => {
  // 2026-02-21 is a Saturday, so "earlier" pulls it back to Friday the 20th.
  const rule: DueRule = { kind: "day-of-month", day: 21, weekdayAdjust: "earlier" };
  expect(occurrencesBetween(rule, "2026-02-01", "2026-02-28")).toEqual(["2026-02-20"]);

  expect(unadjustedOccurrence(rule, "2026-02-20")).toBe("2026-02-21");
});

test("`later` is recovered too", () => {
  // 2026-02-22 is a Sunday; "later" pushes it to Monday the 23rd.
  const rule: DueRule = { kind: "day-of-month", day: 22, weekdayAdjust: "later" };
  expect(occurrencesBetween(rule, "2026-02-01", "2026-02-28")).toEqual(["2026-02-23"]);

  expect(unadjustedOccurrence(rule, "2026-02-23")).toBe("2026-02-22");
});

test("A DATE THAT NEVER MOVED COMES BACK UNCHANGED", () => {
  // The detail screen renders the transparency line only when the two differ,
  // so this is what "there was no shift" looks like. 2026-02-20 is a Friday.
  const rule: DueRule = { kind: "day-of-month", day: 20, weekdayAdjust: "earlier" };
  expect(unadjustedOccurrence(rule, "2026-02-20")).toBe("2026-02-20");
  expect(unadjustedOccurrence({ kind: "day-of-month", day: 21 }, "2026-02-21")).toBe(
    "2026-02-21",
  );
});

test("THE MONTH-BOUNDARY FALLBACK IS RECOVERED IN THE DIRECTION IT REALLY WENT", () => {
  // 2026-05-31 is a Sunday. "later" would be June 1st, which leaves the month
  // and breaks the one-per-month promise, so due_rules falls back the OTHER
  // way — to Friday the 29th. Recovering "the day after the adjusted date"
  // would have answered the 30th, a Saturday the rule never produces.
  const rule: DueRule = { kind: "last-day-of-month", weekdayAdjust: "later" };
  expect(occurrencesBetween(rule, "2026-05-01", "2026-05-31")).toEqual(["2026-05-29"]);

  expect(unadjustedOccurrence(rule, "2026-05-29")).toBe("2026-05-31");
});

test("a week-based rule has no unadjusted date to recover", () => {
  // The spec scopes the shift to month-based rules, and `adjustOf` returns
  // "none" here whatever the field says — so the stored date IS the base date.
  const rule: DueRule = {
    kind: "every-n-weeks",
    n: 2,
    weekday: 0,
    anchorDate: "2026-02-22",
    weekdayAdjust: "earlier",
  };
  expect(unadjustedOccurrence(rule, "2026-02-22")).toBe("2026-02-22");
});

test("an edited rule that no longer produces an open cycle reports the stored date", () => {
  // Rule 25 keeps an old cycle open while the rule underneath it changes.
  // Inventing a base for an occurrence the rule cannot make would be a
  // fabricated fact on a screen whose whole job here is transparency.
  const rule: DueRule = { kind: "day-of-month", day: 21, weekdayAdjust: "earlier" };
  expect(unadjustedOccurrence(rule, "2026-02-11")).toBe("2026-02-11");
});

// ---------------------------------------------------------------------------
// The period a rule implies — spec rule 15's "half the bill's period" (GAP-112)
// ---------------------------------------------------------------------------
// `DueRule` says WHEN, never HOW OFTEN, so the number rule 15's clamp needs has
// to come out of the schedule itself. Every expectation below is the gap the
// rule really produces, averaged over 52 weeks — not a table someone typed.
test("EVERY DUE RULE REPORTS THE PERIOD ITS OWN SCHEDULE PRODUCES", () => {
  const weekly: DueRule = { kind: "every-n-weeks", n: 1, weekday: 5, anchorDate: "2026-02-20" };
  expect(periodDays(weekly, "2026-02-20")).toBe(7);
  expect(periodDays({ ...weekly, n: 2 }, "2026-02-20")).toBe(14);

  // Twelve occurrences a year whatever the month lengths do, which is the point
  // of averaging: the gap from a February due date to the next is 28 days and
  // from a March one 31, and a monthly bill's window must not flinch between
  // them. Half of 30.33 is over 15, so neither of rule 15's maxima moves.
  expect(periodDays(DAY_15, "2026-02-15")).toBeCloseTo(30.33, 2);
  expect(periodDays(DAY_15, "2026-03-15")).toBeCloseTo(30.33, 2);

  // Katapusan, the spec's other month-shaped rule: still twelve a year.
  expect(periodDays({ kind: "last-day-of-month" }, "2026-01-31")).toBeCloseTo(30.33, 2);

  // Kinsenas-katapusan alternates 15 and 16 days; the average is neither, and
  // half of it is the one figure both halves of the month can agree on.
  expect(periodDays({ kind: "semi-monthly" }, "2026-02-15")).toBeCloseTo(15.17, 2);

  expect(periodDays({ kind: "every-n-months", n: 3, day: 20, anchorMonth: 2 }, "2026-02-20")).toBe(
    91,
  );
});

test("a rule with no occurrence in a year is reported as annual, not as zero", () => {
  // Unreachable from the create form — `dueRuleForCadence` caps n at 12 — but a
  // migrated or hand-edited rule could produce it, and dividing by the count
  // would hand rule 15's clamp a division by zero. Annual makes every clamp
  // derived from it non-binding, which is the safe direction: 7 and 15 are
  // already the maxima, so a wrong answer here can only fail to tighten.
  const biennial: DueRule = { kind: "every-n-months", n: 24, day: 20, anchorMonth: 2 };
  expect(periodDays(biennial, "2026-03-20")).toBe(364);
});
