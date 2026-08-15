// lib/goals/goal_math.ts — how far along a goal is, and whether that is fast
// enough (m2b Task 2; docs/04-features/05-goals-savings.md rules 1, 2, 9-11).
//
// PURE AND CLOCK-INJECTED. `now` is a parameter, so a deadline in February, a
// goal reached the day after its date, and a payday that has not happened yet
// are all ordinary fixtures.
//
// ---------------------------------------------------------------------------
// This implements the SPEC's pace, not the m2b plan's
// ---------------------------------------------------------------------------
// The plan describes "linear expected progress between the goal's creation and
// targetDate, using the spec's tolerance band", exposes `requiredPerMonth`, and
// adds an `ahead` state. The spec describes something else entirely, and has no
// tolerance band and no `ahead`:
//
//   Rule 9 — R = (targetAmount − balance) ÷ PAYDAYS remaining, using
//            `IncomeProfile.cadence`; per MONTH when the cadence is irregular.
//   Rule 10 — Reached ≥ target · Past due when the date has passed unmet ·
//            otherwise On track when P ≥ R, Behind when P < R, where P is the
//            `contributionRule` amount or the trailing 3-period average inflow.
//
// Settled by the project owner on 2026-08-15, the way this plan's own Global
// Constraints already do: "where this plan and a spec disagree, the spec wins
// and the plan is the bug." The per-payday figure is also what rule 11's
// required copy needs — "Save ₱1,250.00 PER PAYDAY to hit June 1" — which a
// monthly number cannot produce.
//
// P IS AN INPUT, NOT SOMETHING THIS FILE FETCHES. It comes from the income
// profile and the wallet's recent inflow, both of which are database reads;
// keeping them out here is what lets every case above be a fixture.
import { lastDayOfMonth, parseDateIso, startOfLocalDay } from "@/lib/dates";
import { kinsenasAnchorsBetween } from "@/lib/income/cadence_detector";
import type { Centavos, Goal, IncomeCadence } from "@/types/domain";

/** Rule 10's four states, plus the no-deadline case rule 10 also names. */
export type GoalPace = "no_deadline" | "on_track" | "behind" | "reached" | "past_due";

export type GoalPaceInputs = {
  /**
   * The IncomeProfile's cadence. `null` when income is unknown — paced per
   * month, exactly as `irregular` is, because a month is the honest unit when
   * the app does not know when the user is paid.
   */
  cadence: IncomeCadence | null;
  /**
   * **P** — the `contributionRule` amount when one is set, otherwise the
   * average net inflow to the linked wallet per period over the trailing three
   * periods (rule 10). `null` when neither is known.
   */
  referencePace: Centavos | null;
};

export type GoalProgress = {
  /** The linked savings wallet's balance (rule 1). */
  saved: Centavos;
  target: Centavos;
  /** Floored at 0 — an overfunded goal needs nothing more. */
  remaining: Centavos;
  /** 0..1, clamped (rule 2). */
  fraction: number;
  pace: GoalPace;
  /** **R**. `null` with no deadline, when reached, or when past due. */
  requiredPerPeriod: Centavos | null;
  /** What `requiredPerPeriod` is per — drives rule 11's copy. */
  periodLabel: "payday" | "month";
  /** Local calendar days to the deadline; negative once past. `null` with no deadline. */
  daysRemaining: number | null;
};

const DAY_MS = 86_400_000;

/** Whole local calendar days between two instants. */
function dayGap(from: number, to: number): number {
  return Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / DAY_MS);
}

/**
 * How many pay periods fall between `now` and the deadline.
 *
 * Kinsenas counts REAL ANCHORS — the 15th and the last calendar day of each
 * month, shared with the cadence detector so the two cannot disagree about
 * February. Weekly and monthly count whole periods; both round UP, because a
 * partial period is still a period the user can save in.
 */
function periodsRemaining(
  cadence: IncomeCadence | null,
  now: number,
  deadline: number,
): { periods: number; label: "payday" | "month" } {
  if (cadence === "kinsenas") {
    // Strictly after `now`: a payday that already happened is not one the user
    // can still save out of.
    const anchors = kinsenasAnchorsBetween(now, deadline).filter((anchor) => anchor > now);
    return { periods: anchors.length, label: "payday" };
  }

  const days = dayGap(now, deadline);

  if (cadence === "weekly") {
    return { periods: Math.ceil(days / 7), label: "payday" };
  }

  if (cadence === "monthly") {
    return { periods: countMonths(now, deadline), label: "payday" };
  }

  // `irregular`, and `null` for "we do not know yet" (rule 9's fallback).
  return { periods: countMonths(now, deadline), label: "month" };
}

/**
 * Whole months from `now` to `deadline`, rounded UP, walking the calendar
 * rather than dividing by an average month length — the clamp matters at a
 * month end (Jan 31 + a month is Feb 28, never Mar 3).
 */
function countMonths(now: number, deadline: number): number {
  const start = new Date(startOfLocalDay(now));
  let months = 0;
  let cursor = start;

  while (cursor.getTime() < startOfLocalDay(deadline)) {
    months++;
    const nextMonth = new Date(start.getFullYear(), start.getMonth() + months, 1);
    const day = Math.min(start.getDate(), lastDayOfMonth(nextMonth.getFullYear(), nextMonth.getMonth()));
    cursor = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), day);
  }
  return months;
}

export function computeGoalProgress(
  goal: Goal,
  walletBalance: Centavos,
  now: number,
  paceInputs?: GoalPaceInputs,
): GoalProgress {
  const saved = walletBalance;
  const target = goal.targetAmount;
  const remaining = Math.max(0, target - saved);
  // `target > 0` is 001_core.sql's own CHECK, so the divide is safe — the guard
  // is for a hand-built fixture, not for the database.
  const fraction = target > 0 ? Math.min(1, Math.max(0, saved / target)) : 0;

  const cadence = paceInputs?.cadence ?? null;
  const monthlyLabel: "payday" | "month" =
    cadence === null || cadence === "irregular" ? "month" : "payday";

  // Rule 10 lists Reached first, and the order matters: a goal funded after its
  // deadline is a success, not a failure.
  if (saved >= target) {
    return {
      saved,
      target,
      remaining,
      fraction,
      pace: "reached",
      requiredPerPeriod: null,
      periodLabel: monthlyLabel,
      daysRemaining: goal.targetDate === null ? null : dayGap(now, parseDateIso(goal.targetDate).getTime()),
    };
  }

  if (goal.targetDate === null) {
    // Rule 10: "Goals without targetDate show progress only — no pace chip."
    return {
      saved,
      target,
      remaining,
      fraction,
      pace: "no_deadline",
      requiredPerPeriod: null,
      periodLabel: monthlyLabel,
      daysRemaining: null,
    };
  }

  const deadline = parseDateIso(goal.targetDate).getTime();
  const daysRemaining = dayGap(now, deadline);

  // COMPARED IN LOCAL CALENDAR DAYS, so a goal due today does not flip to Past
  // due at 00:30 while the user still has the whole day to fund it. Comparing
  // the raw instants would, because `parseDateIso` returns local midnight.
  if (daysRemaining < 0) {
    return {
      saved,
      target,
      remaining,
      fraction,
      pace: "past_due",
      // No periods left to spread the shortfall over — a division here reports
      // Infinity as a peso figure.
      requiredPerPeriod: null,
      periodLabel: monthlyLabel,
      daysRemaining,
    };
  }

  const { periods, label } = periodsRemaining(cadence, now, deadline);

  // ROUNDED UP. Following a rounded-down figure exactly leaves the user a
  // centavo short on the last payday, which is the one time the number matters.
  const required = periods > 0 ? Math.ceil(remaining / periods) : remaining;

  // Rule 10: On track when P ≥ R. `null` means neither a contribution rule nor
  // any recent inflow is known — saving nothing does not reach a target, and
  // rule 11 still owes the user the concrete figure either way.
  const referencePace = paceInputs?.referencePace ?? 0;

  return {
    saved,
    target,
    remaining,
    fraction,
    pace: referencePace >= required ? "on_track" : "behind",
    requiredPerPeriod: required,
    periodLabel: label,
    daysRemaining,
  };
}
