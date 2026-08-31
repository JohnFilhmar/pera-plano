// lib/safe_to_spend_projection.ts — the Plus projection curve (M3 Part 2
// Task 3; docs/04-features/09-safe-to-spend.md rule 17).
//
// "For each remaining day d, the plotted value is the Safe-to-Spend the user
// would see on d under the zero-further-discretionary-spend assumption, with
// Bills and scheduled contributions deducted on their scheduled dates."
//
// A FORECAST OF ALLOWANCE, NOT OF BEHAVIOUR (plan rule 1). It answers "what
// will this number say if I spend nothing else", not "what will I spend".
//
// ---------------------------------------------------------------------------
// WHY THE CURVE RISES AND NEVER DIPS
// ---------------------------------------------------------------------------
// Paying a bill does two things at once, and they cancel: the money leaves the
// wallet as an outgoing transaction, so HEADROOM drops by the bill amount — and
// the bill stops being a future obligation, so the BILLS TERM drops by the same
// amount. The numerator is therefore constant across the period, and only the
// divisor shrinks. The allowance rises, day after day, exactly as it should:
// money set aside for a bill was never spendable, so spending it changes
// nothing about what is.
//
// The tempting alternative — dipping the allowance on the day a bill falls due
// — DOUBLE-COUNTS that bill. It was already subtracted from the numerator on
// day one; subtracting it again on its due date charges the user twice for one
// Meralco bill. `billsDue` is a series of its own so the chart can mark those
// days without the allowance line lying about them.
import { addDaysIso } from "@/lib/dates";
import { daysBetweenInclusive } from "@/lib/period";
import type { SafeToSpendInput, SafeToSpendResult } from "@/lib/safe_to_spend";
import type { Centavos, IsoDate } from "@/types/domain";

export type ProjectionPoint = {
  date: IsoDate;
  /** What the hero number would read on this day, spending nothing else. */
  perDay: Centavos;
  /** Running total of `perDay` from today through this day, inclusive. */
  cumulativeAllowance: Centavos;
  /** Bills falling due ON this date — the chart's markers, not a deduction. */
  billsDue: Centavos;
};

/**
 * One point per remaining day of the driving limit's period, today first.
 *
 * PURE: same inputs, same curve, no clock and no I/O — `today` comes from the
 * input and every other date is derived from it.
 *
 * Returns EMPTY for `no_limit`, `over` and `committed` (plan rule 4). With no
 * limit there is nothing to project against; over the limit, every day's
 * allowance is ₱0.00 and a flat line at zero would suggest the shortfall is
 * somehow being worked off. The Over state's own copy — "over by ₱3,499.00
 * this period" — says the true thing instead.
 *
 * `committed` joins them for the arithmetic reason, not the editorial one: its
 * numerator is also `<= 0`, and the loop below does NOT floor `perDay`, so
 * projecting it would draw a curve of negative allowances. The hero's
 * set-aside line explains that day; a descending line would not.
 */
export function projectToPeriodEnd(
  input: SafeToSpendInput,
  result: SafeToSpendResult,
): ProjectionPoint[] {
  if (result.state === "no_limit" || result.state === "over" || result.state === "committed") {
    return [];
  }
  if (result.periodEnd === null) return [];

  // The numerator the engine already computed. Taken from the result rather
  // than recomputed so the curve cannot disagree with the hero number about
  // what it is projecting — which is also what makes rule 2 hold by
  // construction: on day one the divisor is `result.daysRemaining`, so the
  // first point IS `result.perDay`, not merely close to it.
  const numerator = result.headroom - result.billsTerm - result.contributionsTerm;

  const points: ProjectionPoint[] = [];
  let cumulative = 0;

  for (
    let date = input.today;
    date <= result.periodEnd;
    date = addDaysIso(date, 1)
  ) {
    const daysRemaining = daysBetweenInclusive(date, result.periodEnd);
    // Floored, like the engine's: a centavo a day in the user's favour is the
    // direction that overspends, and the curve must not promise more than the
    // hero number will.
    const perDay = Math.floor(numerator / daysRemaining);
    cumulative += perDay;

    points.push({
      date,
      perDay,
      cumulativeAllowance: cumulative,
      billsDue: input.unpaidBills
        .filter((bill) => bill.dueDate === date)
        .reduce((sum, bill) => sum + bill.amount, 0),
    });
  }

  return points;
}
