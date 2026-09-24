// lib/income/cadence_detector.ts — how often the user gets paid (m2-part2
// Task 10; docs/04-features/04-income.md rules 4-8).
//
// PURE, CLOCK-INJECTED, ORDER-INDEPENDENT. `now` is a parameter, the input
// array is never mutated, and the events are sorted internally — so February
// 29th, a 30-day month and a payday that slid across a long weekend are all
// ordinary fixtures rather than dates someone has to wait for.
//
// WHY KINSENAS IS TESTED FIRST. Rule 5 fixes the precedence
// (kinsenas → weekly → monthly → irregular) because Philippine payroll
// overwhelmingly lands on the 15th and the last day of the month. Getting the
// order wrong is not a cosmetic mistake: rule 16 converts a cadence into the
// monthly-equivalent income M that every percent-of-income Limit is measured
// against, and kinsenas doubles `averageAmount` where monthly passes it
// through. Calling a monthly stream "kinsenas" hands the user a limit twice the
// size they asked for.
//
// THE TOLERANCE IS ±3 DAYS, SYMMETRIC. The m2-part2 plan's own rule 2 says the
// window "is asymmetric — earlier tolerance is wider than later"; the spec's
// rule 6 says "the 15th ±3 days (12th-18th)" and "katapusan ±3 days". This
// plan's Global Constraints settle it: "where this plan and that spec disagree,
// the spec wins and the plan is the bug."
import { lastDayOfMonth, startOfLocalDay, startOfLocalDayBefore } from "@/lib/dates";
import type { IncomeCadence } from "@/types/domain";

import type { CandidateEvent } from "./candidates";
import { collapsePaydays } from "./paydays";

export type CadenceEvidence = {
  cadence: IncomeCadence;
  /** 0..1 — see the three exported levels below. */
  confidence: number;
  matchedEventIds: string[];
  /** Epoch ms of the next expected payday; `null` for `irregular`. */
  expectedNextAt: number | null;
};

/**
 * The spec talks in `provisional` / `confirmed` (rule 6's evidence columns);
 * this module's pinned interface returns a number. These three constants are
 * the whole mapping, exported so `income_service` can branch on them without
 * magic numbers appearing in two files.
 */
export const CONFIRMED_CONFIDENCE = 1;
export const PROVISIONAL_CONFIDENCE = 0.6;
export const UNCONFIRMED_CONFIDENCE = 0.2;

/** Rule 5: "Detection evaluates the trailing 120 days of candidate events". */
const DETECTION_WINDOW_DAYS = 120;
/** Rule 6's irregular row counts the trailing 90 days. */
const IRREGULAR_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

/** Rules 6 and 7: the 15th ±3, and katapusan ±3 anchored to the last calendar day. */
const PAYDAY_TOLERANCE_DAYS = 3;

type Attempt = {
  cadence: IncomeCadence;
  confidence: number;
  matchedEventIds: string[];
  expectedNextAt: number | null;
};

/** Whole local days between two instants, ignoring the time of day. */
function dayGap(earlier: number, later: number): number {
  return Math.round((startOfLocalDay(later) - startOfLocalDay(earlier)) / DAY_MS);
}

/**
 * Has the window around `anchor` finished, as of `now`?
 *
 * A window is the anchor ±`toleranceDays`, so it is still OPEN on its last day
 * — rule 7's whole point is that pay legitimately arrives up to three days off
 * the anchor, and a window cannot have "passed with no matched pay event"
 * (rule 13) while pay could still arrive inside it and match.
 */
function windowClosed(anchor: number, now: number, toleranceDays: number): boolean {
  return dayGap(anchor, now) > toleranceDays;
}

// ---------------------------------------------------------------------------
// Kinsenas
// ---------------------------------------------------------------------------

/**
 * The 15th and the last calendar day of `month`, as local midnights.
 *
 * The last day is COMPUTED, never assumed to be the 30th. Rule 6 anchors
 * katapusan to "the last calendar day for short months, incl. February"; a
 * hard-coded 30 mis-classifies February every year and the seven 31-day months
 * besides.
 */
function kinsenasAnchors(year: number, monthIndex: number): number[] {
  return [
    new Date(year, monthIndex, 15).getTime(),
    new Date(year, monthIndex, lastDayOfMonth(year, monthIndex)).getTime(),
  ];
}

/**
 * Every kinsenas anchor in `[from, to]`, oldest first.
 *
 * EXPORTED so `lib/goals/goal_math.ts` can count the paydays remaining before a
 * goal's deadline (goals rule 9) without writing a second copy of "the 15th and
 * the last calendar day". Two copies of that would drift on the first February.
 */
export function kinsenasAnchorsBetween(from: number, to: number): number[] {
  const anchors: number[] = [];
  const start = new Date(from);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor.getTime() <= to) {
    for (const anchor of kinsenasAnchors(cursor.getFullYear(), cursor.getMonth())) {
      if (anchor >= from && anchor <= to) anchors.push(anchor);
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return anchors.sort((a, b) => a - b);
}

/** The first kinsenas anchor strictly after `now`. */
function nextKinsenasAnchor(now: number): number {
  const today = new Date(now);
  for (let monthOffset = 0; monthOffset <= 1; monthOffset++) {
    const cursor = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    for (const anchor of kinsenasAnchors(cursor.getFullYear(), cursor.getMonth())) {
      if (anchor > now) return anchor;
    }
  }
  // Unreachable: the following month always contributes two anchors after `now`.
  return now;
}

/**
 * Rule 6's kinsenas row. Matches events to expected windows, then reads the two
 * evidence thresholds off the run of windows:
 *   provisional — 3 CONSECUTIVE matched windows
 *   confirmed   — 4 of the LAST 5 expected windows matched
 *
 * Both are counted over WINDOWS rather than over events, which is what enforces
 * "credits landing ALTERNATELY in the two pay windows". Counting events instead
 * lets four deposits on the 15th look like kinsenas — and rule 16 would then
 * double the user's income.
 */
function tryKinsenas(events: CandidateEvent[], now: number): Attempt | null {
  const from = startOfLocalDayBefore(now, DETECTION_WINDOW_DAYS);
  const anchors = kinsenasAnchorsBetween(from, now);
  if (anchors.length === 0) return null;

  // ONE PAYDAY PER WINDOW, NOT ONE CREDIT (GAP-117). A window is matched by the
  // pay that arrived, and a payday is a local date however many deposits it
  // travelled in (lib/income/paydays.ts). Recording only the first credit is
  // what left `averageAmountFor` taking the median of HALF a payday for an
  // employer who splits every one — a figure rule 16 then doubles into every
  // percent-of-income limit.
  //
  // The credits of ONE date, never every credit in the window: the 14th and the
  // 16th both sit inside the 15th's window and are two paydays, not one.
  const paydays = collapsePaydays(events);
  const matchedIds: string[] = [];
  const windows = anchors.map((anchor) => {
    const hit = paydays.find(
      (payday) => Math.abs(dayGap(anchor, payday.credits[0].occurredAt)) <= PAYDAY_TOLERANCE_DAYS,
    );
    if (hit) matchedIds.push(...hit.credits.map((credit) => credit.transactionId));
    return { matched: hit !== undefined, closed: windowClosed(anchor, now, PAYDAY_TOLERANCE_DAYS) };
  });

  // A WINDOW THAT HAS NOT CLOSED YET IS NOT EVIDENCE OF ANYTHING, so it is
  // dropped from the scoring below rather than counted as a miss. On the morning
  // of the 15th the 15th's anchor is already in `anchors` (it is <= now) while
  // its window runs to the 18th; scored as unmatched it resets `longestRun` to
  // zero and knocks `matchedOfLastFive` down by one, so a confirmed kinsenas
  // profile demoted itself on payday morning and re-confirmed once the credit
  // landed — the income figure changing for a reason nothing on screen explains.
  //
  // IT IS ONLY DROPPED FROM THE SCORING, never from `matchedIds`: an early
  // credit sitting in a still-open window is exactly the one `maybeEmitPayday`
  // needs to find in `matchedEventIds` before it will announce a payday, and
  // dropping it there would silently stop payday auto-allocation for on-time pay.
  const matchedWindows = windows.filter((w) => w.matched || w.closed).map((w) => w.matched);

  let longestRun = 0;
  let run = 0;
  for (const matched of matchedWindows) {
    run = matched ? run + 1 : 0;
    longestRun = Math.max(longestRun, run);
  }

  // Rule 6's two kinsenas thresholds are DIFFERENT MEASURES, not one measure
  // at two levels, and collapsing them breaks the lapse in rule 13.
  // Confirmed asks about the RECENT past — "4 of the last 5 expected windows" —
  // so it stops being true as soon as paydays stop arriving. Provisional asks
  // whether a run ever happened — "3 consecutive matched windows" — which stays
  // true forever once it has. Treating a 3-run as confirmation means a profile
  // that has been silent for two months still reads as confirmed and never
  // lapses.
  const matchedOfLastFive = matchedWindows.slice(-5).filter(Boolean).length;

  const confidence =
    matchedOfLastFive >= 4
      ? CONFIRMED_CONFIDENCE
      : longestRun >= 3
        ? PROVISIONAL_CONFIDENCE
        : null;

  if (confidence === null) return null;
  return {
    cadence: "kinsenas",
    confidence,
    matchedEventIds: matchedIds,
    expectedNextAt: nextKinsenasAnchor(now),
  };
}

// ---------------------------------------------------------------------------
// Weekly and monthly
// ---------------------------------------------------------------------------

/**
 * Rule 6's weekly row: "Gaps of 7 ±1 days between events, same weekday ±1".
 * Provisional at 3 events (2 qualifying gaps), confirmed at 4 (3 gaps).
 */
function tryWeekly(events: CandidateEvent[]): Attempt | null {
  if (events.length < 3) return null;

  let qualifyingGaps = 0;
  for (let index = 1; index < events.length; index++) {
    const gap = dayGap(events[index - 1].occurredAt, events[index].occurredAt);
    const weekdayShift = Math.abs(
      new Date(events[index].occurredAt).getDay() - new Date(events[index - 1].occurredAt).getDay(),
    );
    // A 6-day gap moves the weekday by one in either direction, so the shift is
    // compared modulo the week — 0, 1 or 6 are all "same weekday ±1".
    const sameWeekday = weekdayShift <= 1 || weekdayShift >= 6;
    if (gap >= 6 && gap <= 8 && sameWeekday) qualifyingGaps++;
  }

  if (qualifyingGaps < 2) return null;
  const last = events[events.length - 1];
  return {
    cadence: "weekly",
    confidence: qualifyingGaps >= 3 ? CONFIRMED_CONFIDENCE : PROVISIONAL_CONFIDENCE,
    matchedEventIds: events.map((event) => event.transactionId),
    expectedNextAt: startOfLocalDay(last.occurredAt) + 7 * DAY_MS,
  };
}

/**
 * Rule 6's monthly row: "One event per month, gap 28-33 days, same calendar
 * date ±3 (clamped for short months)". Provisional at 2 events, confirmed at 3.
 *
 * `expectedNextAt` adds one month to the last event and CLAMPS — January 31 + a
 * month is February 28, never March 3, which is what an unclamped `setMonth`
 * produces and what would make a monthly stream skip February entirely.
 */
function tryMonthly(events: CandidateEvent[]): Attempt | null {
  if (events.length < 2) return null;

  let qualifyingGaps = 0;
  for (let index = 1; index < events.length; index++) {
    const gap = dayGap(events[index - 1].occurredAt, events[index].occurredAt);
    const previousDate = new Date(events[index - 1].occurredAt);
    const currentDate = new Date(events[index].occurredAt);
    const clampedPreviousDay = Math.min(
      previousDate.getDate(),
      lastDayOfMonth(currentDate.getFullYear(), currentDate.getMonth()),
    );
    const sameDayOfMonth = Math.abs(currentDate.getDate() - clampedPreviousDay) <= 3;
    if (gap >= 28 && gap <= 33 && sameDayOfMonth) qualifyingGaps++;
  }

  if (qualifyingGaps < 1) return null;

  const last = new Date(events[events.length - 1].occurredAt);
  const nextMonth = new Date(last.getFullYear(), last.getMonth() + 1, 1);
  const clampedDay = Math.min(
    last.getDate(),
    lastDayOfMonth(nextMonth.getFullYear(), nextMonth.getMonth()),
  );

  return {
    cadence: "monthly",
    confidence: qualifyingGaps >= 2 ? CONFIRMED_CONFIDENCE : PROVISIONAL_CONFIDENCE,
    matchedEventIds: events.map((event) => event.transactionId),
    expectedNextAt: new Date(
      nextMonth.getFullYear(),
      nextMonth.getMonth(),
      clampedDay,
    ).getTime(),
  };
}

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

/**
 * The user's pay rhythm, judged over the trailing 120 days.
 *
 * Rule 5's precedence, exactly: the first CONFIRMED pattern wins; failing that
 * the strongest PROVISIONAL in the same order; failing that the irregular
 * fallback.
 *
 * IRREGULAR IS A REAL ANSWER, NOT A FAILURE (rule 6's own row, and this plan's
 * rule 6). A gig worker genuinely has no cadence, and rule 11 gives `irregular`
 * its own payday test — so with ≥3 primary-stream events in the trailing 90
 * days it is CONFIRMED, not a shrug. Below that threshold the answer is still
 * `irregular` but unconfirmed, because rule 4 forbids guessing a cadence from a
 * single deposit: `expectedNextAt` drives the payday event and the goals
 * auto-allocation prompt, and inventing one manufactures a payday.
 */
export function detectCadence(events: CandidateEvent[], now: number): CadenceEvidence {
  // LOCAL MIDNIGHT, not `now - 120 * DAY_MS`. Rule 5's "trailing 120 days" is a
  // span of the user's calendar; measured from the instant, the cutoff slides
  // forward through the boundary day as the clock runs, so the same ledger
  // classifies differently at 09:59 and at 10:01 with nothing having changed.
  const from = startOfLocalDayBefore(now, DETECTION_WINDOW_DAYS);
  const recent = [...events]
    .filter((event) => event.occurredAt >= from && event.occurredAt <= now)
    .sort((a, b) => a.occurredAt - b.occurredAt);

  const attempts = [tryKinsenas(recent, now), tryWeekly(recent), tryMonthly(recent)];

  const confirmed = attempts.find(
    (attempt) => attempt !== null && attempt.confidence === CONFIRMED_CONFIDENCE,
  );
  if (confirmed) return confirmed;

  const provisional = attempts.find((attempt) => attempt !== null);
  if (provisional) return provisional;

  const irregularFrom = startOfLocalDayBefore(now, IRREGULAR_WINDOW_DAYS);
  const withinNinetyDays = recent.filter((event) => event.occurredAt >= irregularFrom);

  return {
    cadence: "irregular",
    confidence: withinNinetyDays.length >= 3 ? CONFIRMED_CONFIDENCE : UNCONFIRMED_CONFIDENCE,
    matchedEventIds: withinNinetyDays.map((event) => event.transactionId),
    // No window to project from. A number here would be a fabricated payday.
    expectedNextAt: null,
  };
}

// ---------------------------------------------------------------------------
// The lapse count (rule 13)
// ---------------------------------------------------------------------------

/** Rule 6's spacing for the two cadences whose windows are evenly spaced. */
const NOMINAL_WINDOW_DAYS: Record<"weekly" | "monthly", number> = {
  weekly: 7,
  monthly: 30,
};

/** Rule 6's half-widths: weekly is "7 ±1 days", monthly "same calendar date ±3". */
const NOMINAL_WINDOW_TOLERANCE_DAYS: Record<"weekly" | "monthly", number> = {
  weekly: 1,
  monthly: 3,
};

/**
 * How many expected windows have CLOSED since `lastEventAt` with no pay event
 * in them — rule 13's "two consecutive expected windows pass with no matched
 * pay event", counted the way rule 13 words it.
 *
 * IT LIVES HERE BECAUSE RULE 6 DOES. What an expected window is — the 15th and
 * katapusan for kinsenas, seven days for weekly, a month for monthly, each with
 * its own tolerance — is this module's subject, and `income_service` counting
 * windows for itself would be a second implementation of rule 6 free to
 * disagree with the one that does the matching.
 *
 * WHY NOT `floor(elapsedDays / windowDays)`, which is what this replaces. That
 * form starts the clock at the credit rather than at the window, and it ignores
 * the tolerance entirely. Worked through with the spec's own arithmetic: a
 * kinsenas stream whose last credit landed on August 12th matched the August
 * 15th window (12th-18th). The next two expected windows are katapusan
 * (August 28th - September 3rd) and the 15th (September 12th - 18th), so the
 * second one passes unmatched at the end of September 18th and the profile
 * lapses on the 19th. `floor(30 / 15)` reaches two on September 11th — eight
 * days early, with the "we haven't seen your usual pay" prompt firing while the
 * user's pay is not yet even late.
 *
 * `irregular` has no windows at all (rule 11), so it can never lapse.
 */
export function missedWindowsSince(
  cadence: IncomeCadence,
  lastEventAt: number,
  now: number,
): number {
  if (cadence === "irregular") return 0;

  if (cadence === "kinsenas") {
    // From the credit's own local day, so the anchor the credit matched is in
    // the list and is then excluded by the tolerance test below rather than
    // being counted as a miss — an August 12th credit did not miss August 15th.
    return kinsenasAnchorsBetween(startOfLocalDay(lastEventAt), now).filter(
      (anchor) =>
        windowClosed(anchor, now, PAYDAY_TOLERANCE_DAYS) &&
        Math.abs(dayGap(anchor, lastEventAt)) > PAYDAY_TOLERANCE_DAYS,
    ).length;
  }

  // Evenly spaced cadences need no anchor list: the k-th window opens
  // `k * spacing` days after the last credit and closes `tolerance` days later,
  // so the count is how many whole windows fit before today.
  const spacing = NOMINAL_WINDOW_DAYS[cadence];
  const tolerance = NOMINAL_WINDOW_TOLERANCE_DAYS[cadence];
  const elapsedDays = dayGap(lastEventAt, now);
  return Math.max(0, Math.ceil((elapsedDays - tolerance) / spacing) - 1);
}
