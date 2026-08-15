// lib/limits/limit_engine.ts — the pure math behind Limits (m2 Task 4 onward).
//
// NO CLOCK, NO DATABASE, NO I/O. Every function takes the instant it should
// reason about as a parameter (m2 Global Constraint 6), which is what makes
// February 29th, a month end, and a year end ordinary inputs rather than dates
// someone has to wait for. `lib/limits/limit_service.ts` (Task 7) is where a
// real clock and the repositories meet this file.
//
// EVERYTHING IS LOCAL TIME. A limit's "this month" is a claim about the user's
// wall calendar — the Philippines is a single zone eight hours ahead of UTC, so
// any UTC-anchored window would start and end at 8am and put the first eight
// hours of every period in the previous one.
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";
import type { Centavos, LimitBasis, LimitScope } from "@/types/domain";

/**
 * One period of a limit, as a half-open interval.
 *
 * `[start, end)` — `end` is the first instant of the NEXT period, never the
 * last of this one. That is the contract's rule for every date range (§3), and
 * here it also means a window drops straight into
 * `transactions_repo.sumSpend({ from, to })` with no ±1ms fudge. An inclusive
 * `end` would count a transaction stamped exactly at midnight on a boundary in
 * both of the periods it touches.
 */
export type PeriodWindow = {
  /** Epoch ms, INCLUSIVE. */
  start: number;
  /** Epoch ms, EXCLUSIVE — the start of the next period. */
  end: number;
  daysTotal: number;
  /** Remaining days INCLUDING the current partial one, so the final day reads 1. */
  daysLeft: number;
};

const DAY_MS = 86_400_000;

/**
 * `daysTotal` and `daysLeft` from a half-open window.
 *
 * Fixed-millisecond division is safe HERE, unlike in `lib/dates.ts`'s
 * `addDaysIso`, and the difference is worth stating: this counts whole days
 * between two local midnights rather than moving a date, and `Math.round`
 * absorbs the ±1 hour a daylight-saving jurisdiction would introduce. The
 * Philippines has no DST, so the guard is insurance rather than a live concern.
 *
 * `daysLeft` uses `Math.ceil`, which is what makes the whole of the final day
 * read as `1` instead of decaying to `0` at 00:01. A user who can still spend
 * today has a day left; "0 days left" on a day they can still transact reads as
 * "the period is over".
 */
function windowFrom(start: number, end: number, at: number): PeriodWindow {
  return {
    start,
    end,
    daysTotal: Math.round((end - start) / DAY_MS),
    daysLeft: Math.ceil((end - at) / DAY_MS),
  };
}

/**
 * The period containing `at`, anchored to the calendar (limits rule 1):
 * daily = midnight→midnight · weekly = Monday→Monday · monthly = 1st→1st ·
 * annual = Jan 1→Jan 1.
 *
 * Short months and leap years need no special case — the boundaries are built
 * by `Date`'s own calendar normalisation (day 0 of next month, month 12 of this
 * year), so February is 28 or 29 days because the calendar says so, not because
 * this file counted.
 */
export function periodWindowFor(scope: LimitScope, at: number): PeriodWindow {
  const d = new Date(at);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  switch (scope) {
    case "daily":
      // The one scope lib/dates.ts already answers exactly. Reused rather than
      // reconstructed so the two cannot disagree about where a day begins.
      return windowFrom(startOfLocalDay(at), endOfLocalDay(at), at);

    case "weekly": {
      // `(getDay() + 6) % 7` maps Mon=0 .. Sun=6. JS numbers Sunday as 0, so
      // the tempting `getDay() - 1` puts Sunday at -1 and drags it into the
      // FOLLOWING week — an off-by-one that only shows up one day in seven.
      const sinceMonday = (d.getDay() + 6) % 7;
      return windowFrom(
        new Date(year, month, day - sinceMonday).getTime(),
        new Date(year, month, day - sinceMonday + 7).getTime(),
        at,
      );
    }

    case "monthly":
      return windowFrom(
        new Date(year, month, 1).getTime(),
        new Date(year, month + 1, 1).getTime(),
        at,
      );

    case "annual":
      return windowFrom(new Date(year, 0, 1).getTime(), new Date(year + 1, 0, 1).getTime(), at);
  }
}

/**
 * The period immediately before the one containing `at` — what rollover reads
 * (limits rule 14: `carryover(N) = clamp(base(N−1) − spend(N−1), 0, base(N))`).
 *
 * DERIVED BY STEPPING ONE MILLISECOND BACK FROM THE CURRENT WINDOW'S START,
 * never by subtracting a month or a year from `at`. Subtracting a month from
 * March 31 lands on February 31, which `Date` silently normalises to March 3 —
 * so "last month" would overlap this one, and the rollover carried forward
 * would be computed from a window that never existed. Stepping back from a
 * boundary asks the calendar the same question twice and cannot drift.
 *
 * `daysLeft` is forced to 0: the period is over. Left as computed it would be
 * 1 (the millisecond this function steps back to is inside the final day), and
 * a UI would render "1 day left" for a window that closed last month.
 */
export function previousPeriodWindow(scope: LimitScope, at: number): PeriodWindow {
  const current = periodWindowFor(scope, at);
  const previous = periodWindowFor(scope, current.start - 1);
  return { ...previous, daysLeft: 0 };
}

// ===========================================================================
// Basis resolution and rollover — limits rules 9-17 (m2 Task 5)
// ===========================================================================

/**
 * Round DOWN to the nearest whole peso (limits rule 10 — "conservative").
 *
 * Down, not to nearest. Rounding up hands the user a limit larger than the
 * percentage they asked for, which is the direction that fails quietly: they
 * spend inside a cap that was never theirs, and the app agrees with them.
 */
function floorToPeso(centavos: number): Centavos {
  return Math.floor(centavos / 100) * 100;
}

/**
 * The peso base for one period, or `null` for **Paused — income unknown**.
 *
 * Fixed → `value`, which is already centavos. Percent-of-income → derived from
 * the IncomeProfile's monthly-equivalent income M (limits rule 10):
 *
 *     monthly = M × v%   ·   annual = 12M × v%
 *     weekly  = (12M ÷ 52) × v%   ·   daily = (12M ÷ 365) × v%
 *
 * `value` IS PERCENT × 100 (12.5% → 1250), per `types/domain.ts` — hence
 * `/ 10_000` rather than the `/ 100` the m2 plan's snippet uses. That plan was
 * written against a whole-percent encoding that never shipped; taking it
 * literally makes every percent-of-income limit a hundredth of its real size.
 *
 * NULL FOR ZERO INCOME AS WELL AS FOR UNKNOWN. Limits rule 12 requires a
 * non-zero `averageAmount` for a usable IncomeProfile and states outright that
 * "income is never silently treated as ₱0.00". A base of 0 is not a small
 * limit — it is a permanently breached one that alerts on the first centavo
 * forever. The upstream income repository should send `null` for an unusable
 * profile; this guard means both spellings of "we do not know" land on Paused.
 */
export function baseFor(
  args: { basis: LimitBasis; value: number; scope: LimitScope },
  monthlyIncome: Centavos | null,
): Centavos | null {
  if (args.basis === "fixed") return args.value;
  if (monthlyIncome === null || monthlyIncome <= 0) return null;

  const fraction = args.value / 10_000;
  const annualIncome = 12 * monthlyIncome;

  switch (args.scope) {
    case "monthly":
      return floorToPeso(monthlyIncome * fraction);
    case "annual":
      return floorToPeso(annualIncome * fraction);
    case "weekly":
      return floorToPeso((annualIncome / 52) * fraction);
    case "daily":
      return floorToPeso((annualIncome / 365) * fraction);
  }
}

/**
 * Rollover, exactly as limits rule 14 states it:
 *
 *     carryover(N) = clamp(base(N−1) − spend(N−1), 0, base(N))
 *
 * BOTH CLAMPS CARRY A SEPARATE RULE, and dropping either is a quiet bug:
 *
 * - The **upper** clamp against the CURRENT base is what makes rollover
 *   non-compounding (rule 16). Without it, a period that ran at an inflated
 *   effective limit and spent nothing would carry that inflated headroom
 *   forward, and a frugal user's limit would grow without bound.
 * - The **lower** clamp at zero is rule 17: a breached period contributes
 *   nothing. Without it the carryover goes negative and the next period's limit
 *   silently shrinks, with no screen anywhere saying why.
 *
 * `prevBase`, never the previous period's EFFECTIVE limit. The distinction is
 * the whole of rule 16 — but note the upper clamp holds the invariant even if a
 * caller gets that wrong, which is why the test for it feeds an inflated
 * `prevBase` deliberately.
 *
 * Expiry after exactly one period is structural: nothing accumulates, because
 * each period recomputes from its immediate predecessor alone.
 */
export function carryoverFor(args: {
  rollover: boolean;
  prevBase: Centavos;
  prevSpend: Centavos;
  base: Centavos;
}): Centavos {
  if (!args.rollover) return 0;
  const headroom = args.prevBase - args.prevSpend;
  return Math.max(0, Math.min(headroom, args.base));
}

/** `effectiveLimit(N) = base(N) + carryover(N)` (limits rule 15). */
export function effectiveLimitFor(base: Centavos, carryover: Centavos): Centavos {
  return base + carryover;
}
