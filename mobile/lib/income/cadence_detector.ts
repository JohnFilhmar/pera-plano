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
import { lastDayOfMonth, startOfLocalDay } from "@/lib/dates";
import type { IncomeCadence } from "@/types/domain";

import type { CandidateEvent } from "./candidates";

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

/** Every kinsenas anchor from `from` up to and including `now`, oldest first. */
function kinsenasAnchorsBetween(from: number, now: number): number[] {
  const anchors: number[] = [];
  const start = new Date(from);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);

  while (cursor.getTime() <= now) {
    for (const anchor of kinsenasAnchors(cursor.getFullYear(), cursor.getMonth())) {
      if (anchor >= from && anchor <= now) anchors.push(anchor);
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
  const from = now - DETECTION_WINDOW_DAYS * DAY_MS;
  const anchors = kinsenasAnchorsBetween(from, now);
  if (anchors.length === 0) return null;

  const matchedIds: string[] = [];
  const matchedWindows = anchors.map((anchor) => {
    const hit = events.find(
      (event) => Math.abs(dayGap(anchor, event.occurredAt)) <= PAYDAY_TOLERANCE_DAYS,
    );
    if (hit) matchedIds.push(hit.transactionId);
    return hit !== undefined;
  });

  let longestRun = 0;
  let run = 0;
  for (const matched of matchedWindows) {
    run = matched ? run + 1 : 0;
    longestRun = Math.max(longestRun, run);
  }

  const lastFive = matchedWindows.slice(-5);
  const matchedOfLastFive = lastFive.filter(Boolean).length;

  const confidence =
    matchedOfLastFive >= 4
      ? CONFIRMED_CONFIDENCE
      : longestRun >= 3
        ? CONFIRMED_CONFIDENCE
        : longestRun >= 2
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
  const from = now - DETECTION_WINDOW_DAYS * DAY_MS;
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

  const irregularFrom = now - IRREGULAR_WINDOW_DAYS * DAY_MS;
  const withinNinetyDays = recent.filter((event) => event.occurredAt >= irregularFrom);

  return {
    cadence: "irregular",
    confidence: withinNinetyDays.length >= 3 ? CONFIRMED_CONFIDENCE : UNCONFIRMED_CONFIDENCE,
    matchedEventIds: withinNinetyDays.map((event) => event.transactionId),
    // No window to project from. A number here would be a fabricated payday.
    expectedNextAt: null,
  };
}
