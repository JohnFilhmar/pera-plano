// lib/reports/reports_service.ts — the service layer over report aggregation
// (M3b Task 2; docs/04-features/10-reports.md).
//
// THIS FILE SELECTS RANGES AND DELEGATES (brief rule 4). Every figure in the
// return value comes straight from lib/reports/aggregate.ts's pure functions
// (Task 1) — summarizePeriod, categoryBreakdown, trendSeries, topMerchants.
// The only arithmetic below is CALENDAR arithmetic — which month is
// "current," what range a `'YYYY-MM'` month string names, which months a
// trailing window covers — never money arithmetic. Same split
// lib/safe_to_spend_service.ts draws over lib/safe_to_spend.ts: an assembly
// layer with no engine of its own.
//
// TWO GATES, NOT ONE, AND THEY DO DIFFERENT JOBS. This file is the tier
// call-site docs/05-monetization.md §4 means by "gated call-sites ask a
// question here": it decides WHICH RANGE a Free user is even allowed to ask
// for (current month only; `customAllowed` is always false). It does NOT
// separately enforce the 90-day visibility floor — `listTransactions`
// (lib/db/repos/transactions_repo.ts) already clamps every read to
// `historyWindowDays()` on its own, keyed off the same `getTier()`. Reimplementing
// that clamp here would be a second place deciding the same question, exactly
// what rule 4 forbids. The two gates are complementary: this one picks the
// month, that one picks how far back inside it a Free read may actually see
// (moot for a bounded ≤31-day month, but the guarantee — visibility only,
// nothing ever deleted — is real and is what the "no deletion" test below
// pins).
//
// CLOCK DISCIPLINE: `today` is a parameter everywhere. Nothing here reads
// `Date.now()` — the composition edge that supplies a real clock is a later
// task's hook (mirrors buildSafeToSpendInput's `today`/`now` parameters).
import { listCategories } from "@/lib/db/repos/categories_repo";
import { listTransactions } from "@/lib/db/repos/transactions_repo";
import { addMonthsClampedIso, endOfLocalDay, parseDateIso } from "@/lib/dates";
import { getTier, type Tier } from "@/lib/entitlements";
import { periodForScope } from "@/lib/period";
import {
  categoryBreakdown,
  summarizePeriod,
  topMerchants,
  trendSeries,
  type CategoryTotal,
  type DateRange,
  type MerchantTotal,
  type PeriodSummary,
  type TrendPoint,
} from "@/lib/reports/aggregate";
import type { IsoDate, Transaction } from "@/types/domain";

/**
 * What a caller is asking to see: one calendar month (named `'YYYY-MM'`, e.g.
 * `'2026-08'`) or an arbitrary inclusive date range. `DateRange` here is the
 * same inclusive-calendar-dates shape aggregate.ts defines and uses
 * everywhere else in Reports — see that file's header for why this is
 * deliberately NOT the contract's half-open `[from, to)`.
 */
export type ReportScope = { kind: "month"; month: string } | { kind: "custom"; range: DateRange };

export type ReportResult = {
  summary: PeriodSummary;
  categories: CategoryTotal[];
  trend: TrendPoint[];
  merchants: MerchantTotal[];
  /** True when the requested scope was NOT honored as asked — see rule 1. */
  truncatedByTier: boolean;
};

export type AvailableScopes = {
  months: string[];
  customAllowed: boolean;
};

/**
 * Flow B's default bar count ("Bars render for the last 6 periods (toggle to
 * 12)," docs/04-features/10-reports.md). `getReport` has no "periods" input
 * to carry a toggle, so this picks the doc's stated DEFAULT rather than its
 * upper bound — a future toggle is a hook/UI concern, not this service's.
 */
const TREND_TRAILING_MONTHS = 6;

/**
 * Not specified by the brief or the docs table (which lists "top merchants"
 * with no count). Five keeps the list a glanceable top-N rather than a full
 * re-listing of every merchant seen in the period.
 */
const TOP_MERCHANTS_LIMIT = 5;

/**
 * How many trailing months Plus's month picker offers. Reuses the docs'
 * larger trend toggle (12) rather than inventing a third number — "Unlimited"
 * history still needs A bound for a picker list, and the doc already commits
 * to 12 as the app's other standard window.
 */
const AVAILABLE_MONTHS_PLUS = 12;

/** `'2026-08-31'` → `'2026-08'`. Safe on any `IsoDate` — always zero-padded. */
function monthKey(iso: IsoDate): string {
  return iso.slice(0, 7);
}

/** The full calendar month containing `iso`, as an inclusive `DateRange`. */
function calendarMonthOf(iso: IsoDate): DateRange {
  const period = periodForScope("monthly", iso);
  return { from: period.start, to: period.end };
}

/**
 * The `count` trailing calendar months ending at (and including) `today`'s
 * month, oldest first — the order a trend chart reads left to right.
 *
 * Anchored on the 1st of each month specifically so `addMonthsClampedIso`'s
 * day-clamping never engages (every month has a 1st); nothing here needs that
 * clamp, so nothing here is exposed to its edge cases.
 */
function trailingMonths(today: IsoDate, count: number): DateRange[] {
  const firstOfCurrent = `${monthKey(today)}-01`;
  const ranges: DateRange[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    ranges.push(calendarMonthOf(addMonthsClampedIso(firstOfCurrent, -i)));
  }
  return ranges;
}

/**
 * Resolves what the caller asked for into what they are actually allowed to
 * see (rule 1).
 *
 * FREE sees the current month, full stop — a request for a different month,
 * OR a custom range at all (`customAllowed` is always false for Free), both
 * silently clamp to the current month rather than throwing: a user tapping
 * "last month" on a locked screen should see an explanation
 * (`truncatedByTier`), not a crash.
 *
 * PLUS gets exactly what it asked for: the named month's calendar range, or
 * the custom range verbatim.
 */
function resolveScope(
  scope: ReportScope,
  today: IsoDate,
  tier: Tier,
): { range: DateRange; truncatedByTier: boolean } {
  if (tier === "free") {
    const isCurrentMonth = scope.kind === "month" && scope.month === monthKey(today);
    return { range: calendarMonthOf(today), truncatedByTier: !isCurrentMonth };
  }

  if (scope.kind === "custom") {
    return { range: scope.range, truncatedByTier: false };
  }
  return { range: calendarMonthOf(`${scope.month}-01`), truncatedByTier: false };
}

/**
 * Every Transaction that could matter across `ranges`, in one read — a
 * single `listTransactions` call over the ranges' outer envelope rather than
 * one call per range, so a report with an overlapping trend window costs one
 * query, not several.
 *
 * `excludeTransferLinked` is deliberately NOT set. aggregate.ts's header is
 * explicit that transfer exclusion is its whole point and lives in exactly
 * one place; filtering transfer legs here too would be a second place making
 * the same decision; for no benefit.
 *
 * The half-open conversion is the one place inclusive calendar dates meet the
 * contract's `[from, to)` instants: `range.to`'s local midnight is the day
 * itself, so it goes through `endOfLocalDay` to become the EXCLUSIVE bound
 * that names the day after — matching straight through to `range.to` (as
 * `parseDateIso` would) drops every transaction on the last day.
 */
async function fetchTransactions(ranges: DateRange[]): Promise<Transaction[]> {
  const from = Math.min(...ranges.map((range) => parseDateIso(range.from).getTime()));
  const to = Math.max(...ranges.map((range) => endOfLocalDay(parseDateIso(range.to).getTime())));
  return listTransactions({ from, to });
}

/**
 * Assembles one report: a period summary, its category breakdown, a trend
 * series, and top merchants — for whatever range `scope` resolves to under
 * the caller's tier.
 *
 * TREND IS INDEPENDENT OF THE REQUESTED SCOPE (rule 3). Trends is its own tab
 * in the spec (Flow B), not a property of the period the user is looking at,
 * so it always spans the trailing window ending at `today`'s month on Plus —
 * even if `scope` named an older month or a custom range — and collapses to
 * exactly the current month on Free, which is also what `range` already is
 * there (rule 1), so nothing extra is fetched for it.
 */
export async function getReport(scope: ReportScope, today: IsoDate): Promise<ReportResult> {
  const tier = getTier();
  const { range, truncatedByTier } = resolveScope(scope, today, tier);
  const trendRanges = tier === "plus" ? trailingMonths(today, TREND_TRAILING_MONTHS) : [range];

  const [transactions, categories] = await Promise.all([
    fetchTransactions([range, ...trendRanges]),
    // Hidden included: a report can reference a category the user has since
    // archived, and naming it here beats categoryBreakdown falling back to a
    // raw uuid (its own `?? categoryId`) when it can't find one.
    listCategories({ includeHidden: true }),
  ]);

  return {
    summary: summarizePeriod(transactions, range),
    categories: categoryBreakdown(transactions, categories, range),
    trend: trendSeries(transactions, trendRanges),
    merchants: topMerchants(transactions, range, TOP_MERCHANTS_LIMIT),
    truncatedByTier,
  };
}

/**
 * What a period picker may offer: Free gets exactly the current month with
 * custom ranges off; Plus gets a trailing 12-month list with custom ranges
 * on (rule 1).
 */
export async function availableScopes(today: IsoDate): Promise<AvailableScopes> {
  if (getTier() === "free") {
    return { months: [monthKey(today)], customAllowed: false };
  }
  return {
    months: trailingMonths(today, AVAILABLE_MONTHS_PLUS).map((range) => monthKey(range.from)),
    customAllowed: true,
  };
}
