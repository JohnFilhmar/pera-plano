// lib/income/income_math.ts — the user's typical pay, and what it comes to in a
// month (m2-part2 Task 11; docs/04-features/04-income.md rules 9 and 16).
//
// EVERY FIGURE HERE ENDS UP INSIDE A LIMIT. Rule 16's monthly-equivalent M is
// what `baseFor` multiplies a percent-of-income limit by (limits rule 10), so an
// error of a few percent here silently moves the point at which the app warns
// the user — and it moves it without anything on screen changing.
//
// TWO DEVIATIONS FROM THE m2-part2 PLAN'S SIGNATURES, both forced by the spec:
//
// 1. `averageAmountFor` TAKES THE CADENCE AND `now`. The plan's signature is
//    `averageAmountFor(events)`, but rule 9's window is cadence-dependent — the
//    last 6 events for kinsenas, 8 for weekly, 4 for monthly — and its
//    irregular row is a different formula entirely, over a trailing 90 days
//    that only `now` can define. The plan's own rule 1 admits as much ("take it
//    over the most recent window it specifies") while its signature cannot
//    express it.
//
// 2. IT RETURNS `Centavos | null`. The plan says an empty list returns 0. Zero
//    is a real amount that flows into `monthlyEquivalent` and then into a
//    limit's base, and limits rule 12 says income is "never silently treated as
//    ₱0.00". Rule 9 has a "Minimum history" column precisely so that "we do not
//    know yet" is sayable, and `IncomeProfile.averageAmount` is already
//    `Centavos | null`.
import { startOfLocalDayBefore } from "@/lib/dates";
import type { Centavos, IncomeCadence } from "@/types/domain";

import type { CandidateEvent } from "./candidates";
import { collapsePaydays } from "./paydays";

/**
 * Rule 9's window sizes, in PAYDAYS (rule 11's "matched pay event"). Irregular
 * is time-based instead, and counts credits — its row says "primary-stream
 * candidates", not matched pay events.
 */
const MEDIAN_WINDOW: Record<Exclude<IncomeCadence, "irregular">, number> = {
  kinsenas: 6,
  weekly: 8,
  monthly: 4,
};

/**
 * Rule 9's "Minimum history" column — paydays for the three regular cadences,
 * credits for irregular, for the same reason the window sizes above differ.
 */
const MINIMUM_EVENTS: Record<IncomeCadence, number> = {
  kinsenas: 2,
  weekly: 2,
  monthly: 2,
  irregular: 3,
};

/** Rule 9's irregular row sums this window and divides by three. */
const IRREGULAR_WINDOW_DAYS = 90;
const IRREGULAR_MONTHS = 3;

/**
 * Nearest centavo, HALF AWAY FROM ZERO.
 *
 * `Math.round` breaks ties toward +∞, so it rounds −0.5 to −0 rather than to
 * −1 — asymmetric in a way that would bias any figure that can go negative.
 * Nothing here is negative today; the helper exists so that stays true by
 * construction rather than by luck.
 */
function roundCentavos(value: number): Centavos {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Median of integer centavos. An even count averages the two middle values and
 * ROUNDS — truncating would drift the figure downward a little on every
 * recomputation, and rule 10 recomputes on every matched pay event.
 */
function median(amounts: number[]): Centavos {
  const sorted = [...amounts].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : roundCentavos((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * The user's typical pay, or `null` when there is not yet enough history to say
 * (rule 9's "Minimum history").
 *
 * `events` are the MATCHED pay events for `cadence` — what
 * `detectCadence(...).matchedEventIds` selected — except for `irregular`, where
 * rule 9 counts every primary-stream candidate in the window.
 *
 * A MEDIAN FOR THE THREE REGULAR CADENCES, AND A SUM FOR IRREGULAR. That is not
 * an inconsistency: a salaried month has a typical payday and outliers to
 * resist (13th-month pay), whereas a gig worker's months genuinely differ and
 * the median of scattered gigs describes no month at all. Rule 9 says so
 * outright, and notes that irregular's answer IS already the monthly
 * equivalent.
 */
export function averageAmountFor(
  events: CandidateEvent[],
  cadence: IncomeCadence,
  now: number,
): Centavos | null {
  if (cadence === "irregular") {
    // A LOCAL-MIDNIGHT BOUND, not `now - 90 * DAY_MS`. Measured from the instant,
    // the cutoff walks forward with the wall clock: at 09:00 the window opens at
    // 09:00 on the boundary day and at 10:01 it opens at 10:01, so a credit that
    // landed at 10:00 that day drops out of the sum between two reads and the
    // user's income figure changes with nothing having happened. Rule 9's
    // "trailing 90 days" is a statement about the calendar, like every other
    // window in this app, so the bound is the boundary day's midnight and the
    // whole of that day is in.
    const from = startOfLocalDayBefore(now, IRREGULAR_WINDOW_DAYS);
    const withinWindow = events.filter(
      (event) => event.occurredAt >= from && event.occurredAt <= now,
    );
    if (withinWindow.length < MINIMUM_EVENTS.irregular) return null;
    const total = withinWindow.reduce((sum, event) => sum + event.amount, 0);
    return roundCentavos(total / IRREGULAR_MONTHS);
  }

  // THE MEDIAN IS OVER PAYDAYS, NOT OVER CREDITS (GAP-117). Rule 9 says "the
  // median of recent matched pay events", and rule 11 defines a matched pay
  // event as a payday — which is a local date, however many deposits the pay
  // travelled in (lib/income/paydays.ts). An employer who splits one ₱18,500
  // packet into two ₱9,250 deposits has paid ₱18,500 once, and taking the
  // median of the deposits reports half a salary. Rule 16 then doubles that
  // half into the monthly-equivalent M, so every percent-of-income Limit is
  // built on half the income the user actually has.
  //
  // The collapse is the identity for pay that arrives whole, so nothing moves
  // for a user with no split payday in their history.
  const paydays = collapsePaydays(events);
  if (paydays.length < MINIMUM_EVENTS[cadence]) return null;

  // `collapsePaydays` returns oldest first, so the window is the TAIL.
  return median(paydays.slice(-MEDIAN_WINDOW[cadence]).map((payday) => payday.amount));
}

/**
 * Monthly-equivalent income **M** (rule 16) — the figure percent-of-income
 * Limits are measured against.
 *
 * `null` travels straight through, so the "we do not know yet" state reaches
 * `baseFor` intact and becomes **Paused — income unknown** rather than a base
 * of ₱0.00.
 *
 * WEEKLY IS × 52 ÷ 12, NOT × 4. Four weeks a month under-reports by nearly 8%
 * — ₱20,000 where the real figure is ₱21,666.67 — which quietly tightens every
 * percent-of-income limit the user set. The multiply and the divide happen in
 * ONE expression and round once at the end (plan rule 4): rounding `× 52`
 * before dividing, or `÷ 12` before multiplying, both compound.
 *
 * IRREGULAR PASSES THROUGH. Rule 9 already divided its 90-day sum by three, so
 * it is a monthly figure — converting it again would triple a gig worker's
 * income.
 */
export function monthlyEquivalent(
  cadence: IncomeCadence,
  averageAmount: Centavos | null,
): Centavos | null {
  if (averageAmount === null) return null;

  switch (cadence) {
    case "kinsenas":
      return averageAmount * 2;
    case "weekly":
      return roundCentavos((averageAmount * 52) / 12);
    case "monthly":
    case "irregular":
      return averageAmount;
  }
}
