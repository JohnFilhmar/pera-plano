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
  /**
   * The limit's category filter, ALREADY EXPANDED to include descendants —
   * the same set `limit_service.ts` hands `sumSpend`, so the money this limit
   * counts and the commitments deducted from it are decided by one list.
   * `null` means no category filter: the limit measures all spending.
   */
  categoryIds: string[] | null;
};

export type UpcomingBill = {
  id: string;
  name: string;
  /** The fixed amount, or the current estimate for an estimated bill (rule 5). */
  amount: Centavos;
  dueDate: IsoDate;
  /**
   * The category the payment will be recorded under (`Bill.categoryId`) — what
   * decides whether this bill can consume a given limit's headroom.
   */
  categoryId: string;
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

/**
 * `committed` is the shortfall that is NOT the user's spending.
 *
 * A filtered limit measures one slice of spending (rule 3). Bills and goal
 * contributions are not that slice — a goal contribution is a transfer, which
 * invariant I2 keeps out of every limit's spend — so when commitments alone
 * take a filtered limit's headroom to zero, "you are over your Food & Dining
 * limit" is a false sentence about a user who has not spent anything there.
 * `committed` says the true one: the money is spoken for.
 *
 * It is deliberately NOT raised for an unfiltered limit, which does describe
 * overall spendable money — there, commitments genuinely exhaust the
 * allowance, and the spec's worked example (explicitly "no filters") keeps
 * reporting "over by ₱3,499.00".
 */
export type SafeToSpendState = "healthy" | "tight" | "over" | "committed" | "no_limit";

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
  // SCOPED TO WHAT THIS LIMIT MEASURES (rule 5a). A commitment is deducted
  // only if paying it would actually consume this limit's headroom. A ₱3,400
  // electricity bill cannot eat a Food & Dining cap, so subtracting it there
  // compares two different pots and drives a number the user cannot act on —
  // the owner's 2026-09-01 report, where every limit sat at 0% consumed and
  // Safe-to-Spend still read ₱0.00.
  //
  // An unfiltered limit measures all spending, so every bill can consume it
  // and the set is unchanged — which is what keeps the spec's canonical
  // worked example at ₱190.05.
  const billsTerm = input.unpaidBills
    .filter((bill) => bill.dueDate <= end)
    .filter((bill) => limit.categoryIds === null || limit.categoryIds.includes(bill.categoryId))
    .reduce((sum, bill) => sum + bill.amount, 0);

  // Rule 6: scheduled contributions whose date falls in the period, "counted
  // from the START of the period" — a payday allocation on the 15th is still
  // committed money on the 20th, so it is not dropped once its date passes.
  //
  // NEVER AGAINST A FILTERED LIMIT (rule 6a). A goal contribution is committed
  // as two legs joined by `linkTransfer` (lib/goals/goals_service.ts), and
  // invariant I2 keeps transfer legs out of every limit's spend. It therefore
  // carries no category and can never consume a category slice's headroom —
  // so reserving it there is money charged against a budget it will never
  // touch. On the reporting device that was ₱2,500 taken out of a ₱1,965.38
  // weekly category cap, which zeroed a number that had nothing wrong with it.
  //
  // An unfiltered limit keeps reserving it: that limit is the closest thing to
  // "your whole budget", which is the reading the canonical formula is written
  // against, and dropping it there would silently stop protecting savings for
  // every user who has one.
  const contributionsTerm = limit.filtered
    ? 0
    : input.plannedContributions
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

  // Rule 9 floors the number at zero either way; what differs is WHY it is
  // zero, and therefore what the screen is entitled to say.
  //
  // `headroom > 0` is the test for "the user has not overspent this limit".
  // Combined with `numerator <= 0` it means the shortfall came entirely from
  // bills and contributions. On a FILTERED limit that is not an overspend at
  // all — see `SafeToSpendState` — so it gets its own state and no "over by"
  // figure. Zero headroom is excluded on purpose: an allowance spent exactly
  // to its cap is exhausted, not set aside.
  const shortfall = driving.numerator <= 0;
  const commitmentDriven = shortfall && driving.limit.filtered && driving.headroom > 0;

  return {
    state: commitmentDriven
      ? "committed"
      : shortfall
        ? "over"
        : spentPct >= TIGHT_THRESHOLD_PCT
          ? "tight"
          : "healthy",
    perDay: driving.perDay,
    headroom: driving.headroom,
    billsTerm: driving.billsTerm,
    contributionsTerm: driving.contributionsTerm,
    daysRemaining: driving.daysRemaining,
    // Only a real overspend has an "over by". `committed` reports zero, and the
    // hero's set-aside line carries the figure that actually explains the day.
    overBy: shortfall && !commitmentDriven ? Math.abs(driving.numerator) : 0,
    drivingLimitId: driving.limit.id,
    drivingFilterLabel: driving.limit.filtered ? driving.limit.filterLabel : null,
    periodEnd: driving.periodEnd,
    reviewQueueCount: input.reviewQueueCount,
  };
}
