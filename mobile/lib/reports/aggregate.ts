// lib/reports/aggregate.ts — pure report math over the ledger (M3b Task 1).
//
// NO CLOCK, NO DATABASE, NO UI. Every function takes the Transactions (and,
// for the breakdown, the Categories) it should reason about; a real
// repository and the tier-window rules meet this file at
// lib/reports/reports_service.ts (Task 2), which is not this file's concern.
//
// ---------------------------------------------------------------------------
// TRANSFER EXCLUSION IS THE WHOLE POINT
// ---------------------------------------------------------------------------
// docs/04-features/10-reports.md rule 1: a Transaction carrying a
// `transferLinkId` is the user's own money moving between wallets, not
// spending or income, and it is dropped from every figure in this file —
// spend, income, category totals, trends, top merchants. Keyed on
// `transferLinkId !== null`, the same field `lib/limits/limit_engine.ts`'s
// callers already exclude on. A user who moved ₱10,000 from GCash to a
// savings wallet has not spent ₱10,000, and a report that counted it would be
// lying about the one number it exists to get right.
//
// ---------------------------------------------------------------------------
// RANGES ARE INCLUSIVE CALENDAR DATES, NOT THE CONTRACT'S [from, to)
// ---------------------------------------------------------------------------
// Interface contract §3 says date ranges are half-open `[from, to)` — but
// that rule governs epoch-MILLISECOND ranges, the shape a SQL predicate
// consumes. `DateRange` here is a pair of `'YYYY-MM-DD'` strings, what a
// person reads off a screen: "spending from the 1st to the 31st" has to
// include the 31st, and a half-open reading would silently drop the last day
// of every month from every report. Two shipped precedents already read
// date-string ranges this way — `occurrencesBetween` in
// lib/bills/due_rules.ts and `daysBetweenInclusive` in lib/period.ts — so
// this is not a new convention, it is the existing one applied a third time.
//
// A Transaction's `occurredAt` is an epoch ms; converting it to the calendar
// date it falls on goes through `toDateIso(new Date(occurredAt))`
// (lib/dates.ts), which is LOCAL TIME. `toISOString().slice(0, 10)` would
// report the previous day for anything before 8am in the Philippines
// (UTC+8) — a 2am transaction would count against the wrong day, and near a
// month boundary, the wrong month's report.
import { toDateIso } from "@/lib/dates";
import type { Category, Centavos, IsoDate, Transaction } from "@/types/domain";

export type DateRange = {
  from: IsoDate;
  to: IsoDate;
};

export type CategoryTotal = {
  categoryId: string;
  categoryName: string;
  total: Centavos;
  /**
   * Fraction of total spend, 0..1 — UNROUNDED. Rounding for display is the
   * caller's job: components/ui/amount_text.tsx is the only money formatter
   * in the app, and this module formats nothing.
   */
  share: number;
};

export type PeriodSummary = {
  range: DateRange;
  spend: Centavos;
  income: Centavos;
  net: Centavos;
  transactionCount: number;
};

export type TrendPoint = {
  label: string;
  range: DateRange;
  spend: Centavos;
  income: Centavos;
};

export type MerchantTotal = {
  merchant: string;
  total: Centavos;
  count: number;
};

export type CategoryBreakdownOptions = {
  /**
   * `false` (default — rule 3): child categories roll into their top-level
   * ancestor. `true`: every category is its own row at its own level, the
   * drill-down view rule 3's "option to expand" calls for.
   */
  expand?: boolean;
};

/** The local calendar date a Transaction falls on — rule 4's conversion. */
function dateOf(transaction: Transaction): IsoDate {
  return toDateIso(new Date(transaction.occurredAt));
}

/**
 * `range.from <= date <= range.to`, compared as strings.
 *
 * Safe because `IsoDate` is always zero-padded `'YYYY-MM-DD'`
 * (`toDateIso`), so lexicographic and calendar order agree — the same trick
 * `occurrencesBetween` (lib/bills/due_rules.ts) relies on. An invalid range
 * (`from` after `to`) is not special-cased: it simply matches nothing, which
 * is rule 6's "zeroed, not thrown" for free.
 */
function inRange(transaction: Transaction, range: DateRange): boolean {
  const date = dateOf(transaction);
  return date >= range.from && date <= range.to;
}

/** A Transfer Link leg — excluded everywhere in this file (rule 1). */
function isTransfer(transaction: Transaction): boolean {
  return transaction.transferLinkId !== null;
}

/**
 * Spend, income and net for one range (docs rule 4).
 *
 * `transactionCount` counts every committed, non-transfer Transaction in
 * range — both directions — because it answers "how many rows sit behind
 * this figure," not "how many were spends."
 *
 * A range that matches nothing returns every field at zero rather than
 * throwing (rule 6): nothing here needs a non-empty input to be well-defined,
 * the loop simply accumulates nothing.
 */
export function summarizePeriod(transactions: Transaction[], range: DateRange): PeriodSummary {
  let spend: Centavos = 0;
  let income: Centavos = 0;
  let transactionCount = 0;

  for (const transaction of transactions) {
    if (isTransfer(transaction)) continue;
    if (!inRange(transaction, range)) continue;

    transactionCount += 1;
    if (transaction.direction === "out") {
      spend += transaction.amount;
    } else {
      income += transaction.amount;
    }
  }

  return { range, spend, income, net: income - spend, transactionCount };
}

/**
 * Walks `parentId` to the top-level ancestor — the same tree
 * `expandCategoryIds` (lib/limits/limit_engine.ts) walks in the opposite
 * direction (parent → every descendant, rather than child → root).
 *
 * The `seen` guard doubles as a cycle brake for the same reason it does
 * there: nothing should ever write a cyclic category tree, but a walk that
 * trusts its input freezes the report on a corrupt row instead of failing
 * visibly.
 *
 * A DANGLING `parentId` — one that points at a category absent from `byId`
 * — stops the walk at `current`, the last id the walk actually found A
 * CATEGORY FOR, rather than advancing onto the missing id and returning
 * that. Advancing would still keep the transaction's total (nothing here
 * drops the money), but the row it lands on would show a raw, nameless id
 * as both `categoryId` and `categoryName` (via `categoryBreakdown`'s
 * `?? categoryId` fallback) — a uuid where a Category name belongs. Stopping
 * one step early keeps the total attached to the nearest Category the user
 * can actually see.
 */
function rootCategoryId(categoryId: string, byId: Map<string, Category>): string {
  const seen = new Set<string>();
  let current = categoryId;
  while (!seen.has(current)) {
    seen.add(current);
    const category = byId.get(current);
    if (!category || category.parentId === null) return current;
    // Don't walk onto a parent this map doesn't know about — see above.
    if (!byId.has(category.parentId)) return current;
    current = category.parentId;
  }
  return current;
}

/**
 * Spend per category for one range, rolled into top-level ancestors by
 * default (rule 3 — "a breakdown that lists eleven sub-categories of Food is
 * not a breakdown"). Pass `{ expand: true }` for the drill-down view that
 * lists every category at its own level instead.
 *
 * SPEND ONLY (docs rule 5): income is never attributed to a spending
 * category in MVP, so `direction: "in"` rows are skipped even though
 * `summarizePeriod` counts them toward `transactionCount`.
 *
 * Uncategorized is an ordinary Category to this function — nothing here
 * special-cases its id. That is deliberate (rule 5's "never hidden"): the
 * moment this function starts branching on category identity instead of
 * treating every row the same way, excluding Uncategorized becomes one `if`
 * away instead of structurally impossible.
 *
 * `share` divides by the total spend THIS FUNCTION computed, not
 * `summarizePeriod`'s — the two agree because both apply the same filters,
 * but computing it locally means this function has no hidden dependency on
 * being called alongside `summarizePeriod`. Shares are left unrounded; they
 * sum to 1.0 within floating-point tolerance because each is an exact
 * fraction of the same integer total, and rounding for display is the
 * caller's job.
 */
export function categoryBreakdown(
  transactions: Transaction[],
  categories: Category[],
  range: DateRange,
  options: CategoryBreakdownOptions = {},
): CategoryTotal[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const totals = new Map<string, Centavos>();

  for (const transaction of transactions) {
    if (isTransfer(transaction)) continue;
    if (transaction.direction !== "out") continue;
    if (!inRange(transaction, range)) continue;

    const key = options.expand
      ? transaction.categoryId
      : rootCategoryId(transaction.categoryId, byId);
    totals.set(key, (totals.get(key) ?? 0) + transaction.amount);
  }

  const totalSpend = [...totals.values()].reduce((sum, value) => sum + value, 0);
  // No spend in range: nothing to break down. Also guards the division below
  // — an empty range must return zeros, not NaN shares (rule 6).
  if (totalSpend === 0) return [];

  return [...totals.entries()]
    .map(([categoryId, total]) => ({
      categoryId,
      categoryName: byId.get(categoryId)?.name ?? categoryId,
      total,
      share: total / totalSpend,
    }))
    .sort((a, b) => b.total - a.total || a.categoryName.localeCompare(b.categoryName));
}

/**
 * Spend and income per range, reusing `summarizePeriod` rather than
 * re-filtering — one place decides what counts as a Transaction's money, so
 * a trend bar can never disagree with the period view it is a series of.
 *
 * `label` is the range's own `from` date, not a formatted month name: date
 * PRESENTATION belongs to whichever caller draws the trend (lib/datetime.ts's
 * header draws the same split for instants), and this module, like
 * lib/safe_to_spend.ts, formats nothing. The reports screen turns this into
 * "Jan", "Feb" for a chart axis.
 */
export function trendSeries(transactions: Transaction[], ranges: DateRange[]): TrendPoint[] {
  return ranges.map((range) => {
    const summary = summarizePeriod(transactions, range);
    return { label: range.from, range, spend: summary.spend, income: summary.income };
  });
}

/**
 * The highest-spend merchants in a range — spend-only and transfer-excluded
 * for the same reason `categoryBreakdown` is (docs table: "Period spend ...
 * top merchants" sits under the spend report, never the in-vs-out one).
 *
 * A `null` merchant (the schema allows it — some captured Transactions never
 * resolve one) is skipped rather than bucketed under a placeholder: an
 * "Unknown merchant" row nobody asked for would out-rank real merchants it
 * happened to tie with, and the spec defines no such bucket.
 *
 * Ties break on merchant name so the result is deterministic across calls —
 * an unspecified tie order would let the UI's top-N list reshuffle between
 * renders of the exact same data.
 */
export function topMerchants(
  transactions: Transaction[],
  range: DateRange,
  limit: number,
): MerchantTotal[] {
  const totals = new Map<string, { total: Centavos; count: number }>();

  for (const transaction of transactions) {
    if (isTransfer(transaction)) continue;
    if (transaction.direction !== "out") continue;
    if (transaction.merchant === null) continue;
    if (!inRange(transaction, range)) continue;

    const entry = totals.get(transaction.merchant) ?? { total: 0, count: 0 };
    entry.total += transaction.amount;
    entry.count += 1;
    totals.set(transaction.merchant, entry);
  }

  return [...totals.entries()]
    .map(([merchant, { total, count }]) => ({ merchant, total, count }))
    .sort((a, b) => b.total - a.total || a.merchant.localeCompare(b.merchant))
    .slice(0, Math.max(0, limit));
}
