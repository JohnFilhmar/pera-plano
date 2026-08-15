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
import type { LimitAlert } from "@/types/control";
import type { Centavos, LimitBasis, LimitScope, LimitThreshold } from "@/types/domain";

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

// ===========================================================================
// Threshold crossing and alert ordering — limits rules 19-23 (m2 Task 6)
//
// LOGIC ONLY. The copy these alerts turn into lives in lib/alerts/alert_copy.ts
// with every other alert kind in the app, for two reasons worth stating: the
// m2 plan's own encryption amendment requires BOTH a locked and an unlocked
// variant (the plan's Task 6 returns one `{ title, body }` pair, which the
// amendment itself calls incomplete), and alert_copy.ts's catalogue is scanned
// programmatically by its test for any peso figure that reached a locked
// variant. Copy written here would sit outside that scan.
// ===========================================================================

/** Highest first — rule 21 fires the highest crossed threshold, so order matters. */
const THRESHOLDS_DESC: LimitThreshold[] = [100, 80, 50];

/**
 * The threshold this commit newly crossed, or `null` for silence.
 *
 * A threshold fires when spend moves from BELOW the mark to AT-OR-ABOVE it
 * (rule 19) — which is why both `prevSpend` and `newSpend` are needed; a single
 * current total cannot express a crossing.
 *
 * NOTHING AT OR BELOW THE HIGHEST ALREADY FIRED CAN FIRE. This is stronger
 * than the m2 plan's per-threshold `!alreadyFired.includes(t)`, and the
 * difference is a real user-visible bug. `alreadyFired: [80]` without 50 is
 * ordinary — one commit jumped 0 → 85% and rule 21 fired only 80. If spend then
 * dips (a deletion, an edit, a transfer link) and climbs back, the per-threshold
 * check finds 80 already fired, falls through to 50, sees 50 never fired, and
 * notifies "50% of your limit used" to someone sitting at 85% who was already
 * told about 80%. Rule 23 states the principle for the 100 case ("one breach
 * alert, then silence"); rule 20 and IA §6.2's anti-spam rule generalise it.
 * An alert that walks backwards is never right.
 *
 * That single rule also subsumes the plan's `alreadyFired.includes(100)` early
 * return: 100 is the maximum, so once it has fired nothing can exceed it.
 */
export function crossedThreshold(args: {
  prevSpend: Centavos;
  newSpend: Centavos;
  effectiveLimit: Centavos;
  alreadyFired: LimitThreshold[];
}): LimitThreshold | null {
  // Reachable while a percent-of-income limit is paused mid-recompute. Every
  // mark would be 0, so every commit would instantly "cross" 100%.
  if (args.effectiveLimit <= 0) return null;

  const highestFired = args.alreadyFired.length > 0 ? Math.max(...args.alreadyFired) : 0;

  for (const threshold of THRESHOLDS_DESC) {
    if (threshold <= highestFired) continue;
    const mark = (args.effectiveLimit * threshold) / 100;
    if (args.prevSpend < mark && args.newSpend >= mark) return threshold;
  }
  return null;
}

/** Usage as a fraction, guarded so a paused limit cannot poison a comparator. */
function usageRatio(alert: LimitAlert): number {
  return alert.effectiveLimit > 0 ? alert.spend / alert.effectiveLimit : 0;
}

/**
 * Most-severe first (limits rule 22): threshold descending, then usage ratio
 * descending.
 *
 * RATIO, NOT RAW SPEND. ₱2,000 against a ₱2,000 limit is more severe than
 * ₱9,000 against ₱20,000, and sorting on the amount gets that backwards.
 *
 * The guard in `usageRatio` matters here specifically: `spend / 0` is
 * `Infinity`, and `Infinity - Infinity` is `NaN`. A comparator that returns
 * `NaN` leaves the order unspecified, so the notification's headline limit
 * would be whatever the sort happened to land on.
 *
 * Copies before sorting — the caller still holds its own recompute list, and
 * reordering it in place would reorder whatever else it does with it.
 */
export function coalesceAlerts(alerts: LimitAlert[]): LimitAlert[] {
  return [...alerts].sort(
    (a, b) => b.threshold - a.threshold || usageRatio(b) - usageRatio(a),
  );
}

/**
 * A selection plus every descendant of every selected category (limits rule 4:
 * "picking a parent includes all its descendants").
 *
 * Walks to arbitrary DEPTH, not one level: a one-level implementation misses a
 * grandchild and silently stops counting spend the user believes is capped.
 *
 * The `seen` guard doubles as a cycle brake. Nothing should ever write a cyclic
 * category tree, but a walk that trusts its input freezes the app on a corrupt
 * row instead of failing visibly.
 *
 * An empty selection expands to nothing, NOT to every category — an empty
 * filter means "no filter" upstream, where `limits_repo` stores it as NULL.
 */
export function expandCategoryIds(
  selected: string[],
  all: { id: string; parentId: string | null }[],
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const category of all) {
    if (category.parentId === null) continue;
    const siblings = childrenOf.get(category.parentId) ?? [];
    siblings.push(category.id);
    childrenOf.set(category.parentId, siblings);
  }

  const seen = new Set<string>();
  const stack = [...selected];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return [...seen];
}
