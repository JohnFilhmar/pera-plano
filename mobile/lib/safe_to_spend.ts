// lib/safe_to_spend.ts — the number the whole app exists to show (M3 Task 1;
// docs/04-features/09-safe-to-spend.md).
//
//   Safe-to-Spend (today) =
//     (tightest limit headroom − bills due before period end
//      − planned goal contributions in period) ÷ days remaining, incl. today
//
// PURE, AND TAKES EVERY TERM AS INPUT. No database, no clock. Task 2 does the
// assembly; this module does the arithmetic, so every case in the spec — a
// filtered limit, an overdue bill, a period's last day — is an ordinary
// fixture rather than a seeded database.
//
// NO MONEY FORMATTING HERE. `formatCentavos` in components/ui/amount_text.tsx
// is "THE ONLY MONEY FORMATTER IN THE APP", so the M3 plan's `utils/money.ts`
// with its `formatPhp` is not created: a second formatter is how ₱1,234.56 and
// ₱1234.56 end up on two screens of the same app.
import type { Centavos, IsoDate, LimitScope } from "@/types/domain";

import { daysBetweenInclusive, periodForScope } from "./period";

/** Shorter scopes first — spec rule 2's tie-break. */
const SCOPE_RANK: Record<LimitScope, number> = {
  daily: 0,
  weekly: 1,
  monthly: 2,
  annual: 3,
};

/** Spec rule 4: the limit's effective value, less committed spend in its window. */
export type CandidateLimit = {
  id: string;
  scope: LimitScope;
  /**
   * `value`, plus rollover carry-in when enabled, or the figure derived from
   * the IncomeProfile for a percent-of-income basis. Already resolved by the
   * caller — spec rule 10 excludes a percent limit with no usable profile
   * from candidacy entirely, so anything arriving here is usable.
   */
  effectiveValue: Centavos;
  /** Spend matching this limit's filters, direction out, transfers excluded. */
  spendInPeriod: Centavos;
  /** True when a category or wallet filter narrows it — spec rule 3. */
  filtered: boolean;
  /** "Food & Dining", for the caption that names the filter. Null when unfiltered. */
  filterLabel: string | null;
};

export type UpcomingBill = {
  id: string;
  name: string;
  /** The fixed amount, or the current estimate for an estimated bill (rule 5). */
  amount: Centavos;
  dueDate: IsoDate;
};

export type PlannedContribution = {
  goalId: string;
  amount: Centavos;
  date: IsoDate;
};

export type SafeToSpendInput = {
  today: IsoDate;
  limits: CandidateLimit[];
  /** Unresolved only: paid and skipped cycles are excluded by the caller. */
  unpaidBills: UpcomingBill[];
  plannedContributions: PlannedContribution[];
  /** Spec rule 12 — surfaced as a caption, never subtracted. */
  reviewQueueCount: number;
};

export type SafeToSpendState = "healthy" | "tight" | "over" | "no_limit";

export type SafeToSpendResult = {
  state: SafeToSpendState;
  /** The daily figure the home screen shows. Floored at zero (rule 9). */
  perDay: Centavos;
  /** effectiveValue − spendInPeriod for the driving limit. */
  headroom: Centavos;
  billsTerm: Centavos;
  contributionsTerm: Centavos;
  daysRemaining: number;
  /**
   * The WHOLE-PERIOD shortfall when over, zero otherwise — rule 9 is explicit
   * that it is "the whole-period shortfall, not a per-day figure". Dividing it
   * would tell a user who is ₱3,499 over that they are ₱175 over.
   */
  overBy: Centavos;
  drivingLimitId: string | null;
  /** Non-null only when the driving limit is filtered — rule 3's caption. */
  drivingFilterLabel: string | null;
  periodEnd: IsoDate | null;
  /** Rule 12's "not yet counted" disclosure. */
  reviewQueueCount: number;
};

/** Spec's states table: tight once spend passes this share of the limit. */
const TIGHT_THRESHOLD_PCT = 80;

type Evaluated = {
  limit: CandidateLimit;
  headroom: Centavos;
  billsTerm: Centavos;
  contributionsTerm: Centavos;
  daysRemaining: number;
  numerator: Centavos;
  perDay: Centavos;
  periodEnd: IsoDate;
};

function evaluate(limit: CandidateLimit, input: SafeToSpendInput): Evaluated {
  const { start, end } = periodForScope(limit.scope, input.today);
  const daysRemaining = daysBetweenInclusive(input.today, end);
  const headroom = limit.effectiveValue - limit.spendInPeriod;

  // Rule 5, both halves, and the test is deliberately ONE-SIDED. (b) is "unpaid
  // bills whose due date falls on or after today and on or before the period
  // end"; (a) is unresolved OVERDUE cycles, which "keep subtracting until
  // resolved" — money owed is money not spendable (bills rules 24-25).
  //
  // The obvious `dueDate >= today && dueDate <= end` would drop exactly the
  // overdue ones, which are the bills the user most needs counted. Anything
  // already past is by definition also `<= end`, so the upper bound alone
  // expresses both halves.
  const billsTerm = input.unpaidBills
    .filter((bill) => bill.dueDate <= end)
    .reduce((sum, bill) => sum + bill.amount, 0);

  // Rule 6: scheduled contributions whose date falls in the period, "counted
  // from the START of the period" — a payday allocation on the 15th is still
  // committed money on the 20th, so it is not dropped once its date passes.
  const contributionsTerm = input.plannedContributions
    .filter((contribution) => contribution.date >= start && contribution.date <= end)
    .reduce((sum, contribution) => sum + contribution.amount, 0);

  const numerator = headroom - billsTerm - contributionsTerm;

  return {
    limit,
    headroom,
    billsTerm,
    contributionsTerm,
    daysRemaining,
    numerator,
    // Rule 9's floor. `Math.floor` on the division, not round: showing ₱190.05
    // when the honest figure is ₱190.049 is the direction that overspends.
    perDay: numerator <= 0 ? 0 : Math.floor(numerator / daysRemaining),
    periodEnd: end,
  };
}

/**
 * Spec rule 3: "Filtered Limits do not drive the home number when an unfiltered
 * Limit exists" — a category cap describes a slice, and the home number
 * describes overall spendable money. If ONLY filtered limits exist, the
 * tightest of them drives and the caption names the filter.
 */
function candidatesFor(limits: CandidateLimit[]): CandidateLimit[] {
  const unfiltered = limits.filter((limit) => !limit.filtered);
  return unfiltered.length > 0 ? unfiltered : limits;
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const candidates = candidatesFor(input.limits);

  if (candidates.length === 0) {
    return {
      state: "no_limit",
      perDay: 0,
      headroom: 0,
      billsTerm: 0,
      contributionsTerm: 0,
      daysRemaining: 0,
      overBy: 0,
      drivingLimitId: null,
      drivingFilterLabel: null,
      periodEnd: null,
      reviewQueueCount: input.reviewQueueCount,
    };
  }

  const evaluated = candidates.map((limit) => evaluate(limit, input));

  // Rule 2: the driving limit is the one yielding the LOWEST value, ties
  // breaking toward the shorter scope. The tie-break is not cosmetic — two
  // limits both floored to ₱0 have the same `perDay`, and the daily one is the
  // one whose constraint the user runs into first.
  const driving = evaluated.reduce((tightest, candidate) => {
    if (candidate.perDay !== tightest.perDay) {
      return candidate.perDay < tightest.perDay ? candidate : tightest;
    }
    return SCOPE_RANK[candidate.limit.scope] < SCOPE_RANK[tightest.limit.scope]
      ? candidate
      : tightest;
  });

  const spentPct =
    driving.limit.effectiveValue > 0
      ? (driving.limit.spendInPeriod / driving.limit.effectiveValue) * 100
      : 100;

  return {
    state:
      driving.numerator <= 0 ? "over" : spentPct >= TIGHT_THRESHOLD_PCT ? "tight" : "healthy",
    perDay: driving.perDay,
    headroom: driving.headroom,
    billsTerm: driving.billsTerm,
    contributionsTerm: driving.contributionsTerm,
    daysRemaining: driving.daysRemaining,
    overBy: driving.numerator <= 0 ? Math.abs(driving.numerator) : 0,
    drivingLimitId: driving.limit.id,
    drivingFilterLabel: driving.limit.filtered ? driving.limit.filterLabel : null,
    periodEnd: driving.periodEnd,
    reviewQueueCount: input.reviewQueueCount,
  };
}
