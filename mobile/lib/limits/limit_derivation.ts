// lib/limits/limit_derivation.ts — one limit, every cadence (owner decision,
// 2026-08-20).
//
// THE REPORT THIS ANSWERS: "limits are still not automated to auto insert to
// user's database ... a user in onboarding gets asked explicitly and optionally
// a monthly limit ... and after entering it, navigating to plan->limits only
// shows the entered onboarding data, not calculated."
//
// So entering one limit creates the equivalent at the other three cadences, and
// Plan -> Limits is populated rather than showing a single row. Each derived
// limit is an ORDINARY limit the moment it is written — the owner's wording,
// "user can update it anyways", and their explicit choice that editing one
// leaves the others alone. Nothing here re-derives anything later.
//
// ---------------------------------------------------------------------------
// THE ARITHMETIC IS NOT INVENTED HERE. It is `baseFor`'s, in limit_engine.ts,
// which already resolves a percent-of-income limit per scope:
//
//     monthly = M × v%   ·   annual = 12M × v%
//     weekly  = (12M ÷ 52) × v%   ·   daily = (12M ÷ 365) × v%
//
// Reusing those exact ratios is what keeps a derived FIXED limit agreeing with
// the equivalent PERCENT limit. The tempting alternative — "proper" calendar
// constants, 30.4375 days a month and 365.25 a year — would be more accurate in
// the abstract and WRONG here, because it would put the two kinds of limit
// permanently and invisibly out of step for anyone holding one of each. When
// the engine's convention changes, this changes with it; that is the point of
// deriving the constants from the same place rather than restating them.
//
// A YEAR IS 365 DAYS AND 52 WEEKS, which do not reconcile (52 × 7 = 364). That
// is the engine's existing inconsistency, not a new one, and it is under a day
// a year — small beside the fact that a spending limit is a decision, not a
// measurement.
// ---------------------------------------------------------------------------
import type { LimitScope, Limit } from "@/types/domain";
import type { NewLimit } from "@/types/control";

const ALL_SCOPES: readonly LimitScope[] = ["daily", "weekly", "monthly", "annual"];

/**
 * How many of a scope's periods fit in a year, using `baseFor`'s conventions.
 *
 * Kept as periods-per-year rather than days-per-period so the numbers here are
 * literally the 12, 52 and 365 that appear in `baseFor`'s own documented
 * formulas, and a reader can check the two against each other by eye.
 */
const PERIODS_PER_YEAR: Record<LimitScope, number> = {
  daily: 365,
  weekly: 52,
  monthly: 12,
  annual: 1,
};

/**
 * A limit's amount expressed as pesos-per-day, so limits at different cadences
 * can be compared at all.
 *
 * FIXED BASIS ONLY. A percent-of-income limit has no amount until income is
 * known; `limit_consistency.ts` resolves those through `baseFor` first and
 * passes the resulting peso base in here.
 */
export function dailyRateOf(scope: LimitScope, value: number): number {
  return (value * PERIODS_PER_YEAR[scope]) / 365;
}

/**
 * The inverse: a daily rate back into one period's worth at `scope`.
 *
 * Exported for limit_consistency.ts, which uses it to answer "what would the
 * monthly limit have to be for these two to agree?" — a number the user can act
 * on, and one that has to be computed the same way the derivation computes it
 * or the suggestion would not actually resolve the warning.
 */
export function valueAtScope(scope: LimitScope, dailyRate: number): number {
  return Math.round((dailyRate * 365) / PERIODS_PER_YEAR[scope]);
}

/**
 * The same limit, restated at the cadences that do not have one yet.
 *
 * Returns `NewLimit`s ready for `createLimit`, each carrying `derivedFrom:
 * source.id` — which is what keeps them off the free tier's cap
 * (lib/entitlements.ts). Never returns a row for the source's own scope.
 *
 * `occupiedScopes` IS NOT OPTIONAL POLISH — IT IS WHAT STOPS THE LIST
 * COMPOUNDING. Onboarding runs this once against an empty set and gets all
 * three. But the manual create route runs it too, and without this a user who
 * already had the full set and then added one more limit by hand would get
 * three MORE rows, then three more again — every deliberate limit spawning
 * duplicates at cadences that were already covered. Passing the scopes already
 * in use makes the rule "fill in what is missing", which is the same answer in
 * onboarding and stays sane forever after it.
 */
export function derivedLimitsFrom(
  source: Limit,
  occupiedScopes: readonly LimitScope[] = [],
): NewLimit[] {
  return ALL_SCOPES.filter(
    (scope) => scope !== source.scope && !occupiedScopes.includes(scope),
  ).map((scope) => ({
    scope,
    basis: source.basis,
    // A PERCENT KEEPS ITS PERCENT. This is the case that looks like a bug and
    // is the opposite of one: `baseFor` already applies the cadence ratio to a
    // percent-of-income limit, so scaling `value` here as well would apply it
    // TWICE — making a derived daily limit a thirtieth of what the user meant,
    // with nothing throwing and no screen saying why. Only a `fixed` limit
    // carries its amount in its own units and therefore needs converting.
    //
    // `Math.max(..., 1)` because 001_core.sql CHECKs `value > 0`: a small
    // enough source (₱1/year) rounds to nothing at a shorter cadence, and a
    // constraint violation on a convenience feature would fail the user's real
    // save. One centavo is the smallest limit the schema can hold.
    value:
      source.basis === "percent-of-income"
        ? source.value
        : Math.max(valueAtScope(scope, dailyRateOf(source.scope, source.value)), 1),
    categoryFilter: source.categoryFilter,
    walletFilter: source.walletFilter,
    // NOT INHERITED. Rollover carries unused headroom into the next period, so
    // switching it on for three cadences the user never chose it for quietly
    // changes how much they may spend — in three places, from one answer about
    // a different one. They can turn it on per limit, which is where the
    // decision belongs.
    rollover: false,
    isActive: source.isActive,
    derivedFrom: source.id,
  }));
}
