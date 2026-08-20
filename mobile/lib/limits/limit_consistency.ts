// lib/limits/limit_consistency.ts — "show warnings on gaps between other
// created limits" (owner, 2026-08-20).
//
// WHAT A "GAP" IS. Limits at different cadences are promises about the same
// money, and two of them can disagree. Put every limit on one scale — pesos per
// day, via `dailyRateOf` — and exactly two disagreements are worth saying out
// loud:
//
//   CONTRADICTION  the SHORTER cadence allows more per day than the longer one.
//                  Spending right up to the weekly limit blows the monthly one
//                  before the month is out. The user is being told "yes" by one
//                  limit and "no" by another, and only finds out at the end.
//
//   NEVER BINDS    the shorter cadence is much tighter, so the longer limit
//                  cannot be reached while the shorter one holds. It is not
//                  wrong, it is DECORATIVE — and a limit the user believes is
//                  protecting them while doing nothing is worth a word.
//
// ONLY COMPARABLE LIMITS ARE COMPARED. A ₱2,000/week food limit does not
// contradict a ₱20,000/month overall limit — it is a subset of it, and saying
// otherwise would fire a warning on the single most sensible way to use limits.
// Two limits are comparable only when they cover the SAME transactions, which
// here means the same category and wallet filters.
//
// THE MARGINS ARE NOT ZERO, ON PURPOSE. Derived limits (limit_derivation.ts)
// are consistent by construction but round to the centavo at each cadence, and
// a year is 52 weeks AND 365 days, which do not reconcile. A bare `>` would
// therefore fire on a set the app itself just created, which is the fastest way
// to teach someone to ignore warnings.
import { dailyRateOf, valueAtScope } from "./limit_derivation";
import type { Centavos, Limit, LimitScope } from "@/types/domain";

/**
 * A limit with its peso base already resolved.
 *
 * THE BASE IS PASSED IN, NOT COMPUTED. A percent-of-income limit has no amount
 * until income is known, and resolving it means reaching for the income service
 * — so callers hand over what `baseFor`/`getLimitStatuses` already worked out.
 * That keeps this module pure arithmetic over numbers it can be tested with.
 */
export type ResolvedLimit = {
  id: string;
  scope: LimitScope;
  base: Centavos;
  categoryFilter: string[] | null;
  walletFilter: string[] | null;
};

export type LimitGap = {
  kind: "contradiction" | "never-binds";
  /** The shorter-cadence limit in the pair. */
  shorterId: string;
  /** The longer-cadence limit in the pair. */
  longerId: string;
  shorterScope: LimitScope;
  longerScope: LimitScope;
  /** Ready to render — the screens do not restate this. */
  message: string;
};

/** Longest last, so "shorter" and "longer" in a pair are decided by index. */
const SCOPE_ORDER: readonly LimitScope[] = ["daily", "weekly", "monthly", "annual"];

const SCOPE_NOUN: Record<LimitScope, string> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  annual: "annual",
};

/**
 * How much looser per day the shorter limit must be before it CONTRADICTS the
 * longer one. 1% absorbs the centavo-level rounding a derived set carries.
 */
const CONTRADICTION_MARGIN = 1.01;

/**
 * How much looser per day the longer limit must be before it NEVER BINDS. 15%
 * rather than anything tighter because deliberate headroom is normal — a
 * monthly limit a little above four weekly ones is a choice, not a mistake.
 */
const SLACK_MARGIN = 1.15;

/** Same transactions covered? Only then are two limits about the same money. */
function sameCoverage(a: ResolvedLimit, b: ResolvedLimit): boolean {
  const key = (filter: string[] | null) => (filter === null ? "" : [...filter].sort().join(","));
  return (
    key(a.categoryFilter) === key(b.categoryFilter) && key(a.walletFilter) === key(b.walletFilter)
  );
}

function pesos(centavos: number): string {
  return `₱${(Math.round(centavos) / 100).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/**
 * Every disagreement between the given limits, worst first.
 *
 * Pass only limits the user is actually being held to — active, not archived.
 * The caller decides that; this module has no opinion about which limits matter.
 */
export function findLimitGaps(limits: readonly ResolvedLimit[]): LimitGap[] {
  const gaps: LimitGap[] = [];

  for (let i = 0; i < limits.length; i++) {
    for (let j = i + 1; j < limits.length; j++) {
      const a = limits[i];
      const b = limits[j];
      if (!sameCoverage(a, b)) continue;
      if (a.scope === b.scope) continue;

      const [shorter, longer] =
        SCOPE_ORDER.indexOf(a.scope) < SCOPE_ORDER.indexOf(b.scope) ? [a, b] : [b, a];

      const shorterDaily = dailyRateOf(shorter.scope, shorter.base);
      const longerDaily = dailyRateOf(longer.scope, longer.base);
      if (shorterDaily <= 0 || longerDaily <= 0) continue;

      const common = {
        shorterId: shorter.id,
        longerId: longer.id,
        shorterScope: shorter.scope,
        longerScope: longer.scope,
      };

      if (shorterDaily > longerDaily * CONTRADICTION_MARGIN) {
        // What the longer limit would have to be for the two to agree — a
        // number the user can act on, rather than "these disagree". Computed
        // with the DERIVATION's own inverse, so acting on the suggestion
        // actually clears the warning instead of landing just short of it.
        const wouldNeed = valueAtScope(longer.scope, shorterDaily);
        gaps.push({
          ...common,
          kind: "contradiction",
          message:
            `Your ${SCOPE_NOUN[shorter.scope]} limit allows more spending than your ` +
            `${SCOPE_NOUN[longer.scope]} one does. Spending up to it would go over your ` +
            `${SCOPE_NOUN[longer.scope]} limit by the end of the period — raise the ` +
            `${SCOPE_NOUN[longer.scope]} limit to about ${pesos(wouldNeed)}, or lower the ` +
            `${SCOPE_NOUN[shorter.scope]} one.`,
        });
      } else if (longerDaily > shorterDaily * SLACK_MARGIN) {
        gaps.push({
          ...common,
          kind: "never-binds",
          message:
            `Your ${SCOPE_NOUN[longer.scope]} limit will never be reached while your ` +
            `${SCOPE_NOUN[shorter.scope]} one holds — the ${SCOPE_NOUN[shorter.scope]} limit is ` +
            `the one actually doing the work.`,
        });
      }
    }
  }

  // Contradictions first: one of them means the user is about to be told they
  // overspent by a limit they were never warned they were approaching.
  return gaps.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === "contradiction" ? -1 : 1));
}

/** The shape `findLimitGaps` wants, from a limit and its resolved base. */
export function resolvedLimitFrom(limit: Limit, base: Centavos): ResolvedLimit {
  return {
    id: limit.id,
    scope: limit.scope,
    base,
    categoryFilter: limit.categoryFilter,
    walletFilter: limit.walletFilter,
  };
}
