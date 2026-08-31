// lib/reports/__tests__/aggregate.test.ts — M3b Task 1.
//
// Pure report math over a list of Transactions. The single rule under test
// throughout is exclusion of rows that moved a number without moving money:
// transfer legs (docs/04-features/10-reports.md rule 1) and balance
// adjustments (017_transaction_adjustments). Every figure here must agree that
// neither is spending or income, no matter which function computes it.
import { parseDateIso } from "@/lib/dates";
import { categoryBreakdown, summarizePeriod, topMerchants, trendSeries } from "@/lib/reports/aggregate";
import type { Category, Transaction } from "@/types/domain";

let nextId = 0;

const BASE_TX: Transaction = {
  id: "tx_base",
  walletId: "wallet_1",
  categoryId: "cat_food",
  amount: 10000,
  direction: "out",
  occurredAt: 0,
  merchant: "Jollibee",
  counterparty: null,
  referenceNo: null,
  source: "manual",
  confidence: 1,
  rawNotificationId: null,
  transferLinkId: null,
  note: null,
  balanceAfter: null,
  computedBalance: null,
  isAdjustment: false,
  createdAt: 0,
  updatedAt: 0,
};

/**
 * `occurredAt` from a calendar date, so every fixture's date is unambiguous
 * regardless of the machine's timezone — the same local-time conversion the
 * module itself uses in reverse (`toDateIso(new Date(occurredAt))`).
 */
function at(iso: string): number {
  return parseDateIso(iso).getTime();
}

function tx(overrides: Partial<Transaction> & { date: string }): Transaction {
  const { date, ...rest } = overrides;
  nextId += 1;
  return { ...BASE_TX, id: `tx_${nextId}`, occurredAt: at(date), ...rest };
}

const BASE_CATEGORY: Category = {
  id: "cat_placeholder",
  name: "Placeholder",
  parentId: null,
  icon: "circle",
  isSystem: false,
  isHidden: false,
  createdAt: 0,
  updatedAt: 0,
};

function category(overrides: Partial<Category>): Category {
  return { ...BASE_CATEGORY, ...overrides };
}

const AUGUST = { from: "2026-08-01", to: "2026-08-31" };

// ---------------------------------------------------------------------------
// summarizePeriod — docs rule 4
// ---------------------------------------------------------------------------
test("summarizePeriod sums spend and income and computes net", () => {
  const transactions = [
    tx({ date: "2026-08-05", direction: "out", amount: 30000 }),
    tx({ date: "2026-08-10", direction: "out", amount: 15000 }),
    tx({ date: "2026-08-15", direction: "in", amount: 100000 }),
  ];

  const summary = summarizePeriod(transactions, AUGUST);

  expect(summary.spend).toBe(45000);
  expect(summary.income).toBe(100000);
  expect(summary.net).toBe(55000); // income - spend
  expect(summary.transactionCount).toBe(3);
  expect(summary.range).toEqual(AUGUST);
});

test("TRANSFER LEGS ARE EXCLUDED FROM SPEND (regression)", () => {
  // Rule 1: a user who moved money to another wallet of their own has not
  // spent it. Keyed on transferLinkId, the same field limit_engine.ts
  // already excludes on.
  const transactions = [
    tx({ date: "2026-08-05", direction: "out", amount: 20000 }),
    tx({ date: "2026-08-06", direction: "out", amount: 1000000, transferLinkId: "link_1" }),
  ];

  const summary = summarizePeriod(transactions, AUGUST);
  expect(summary.spend).toBe(20000);
  // Not just excluded from the total — the leg is not counted at all.
  expect(summary.transactionCount).toBe(1);
});

test("TRANSFER LEGS ARE EXCLUDED FROM INCOME (regression)", () => {
  const transactions = [
    tx({ date: "2026-08-05", direction: "in", amount: 50000 }),
    tx({ date: "2026-08-06", direction: "in", amount: 1000000, transferLinkId: "link_2" }),
  ];

  expect(summarizePeriod(transactions, AUGUST).income).toBe(50000);
});

// ---------------------------------------------------------------------------
// Balance adjustments — the owner's 2026-08-30 report, "wallet adjust balance
// counts as expense". Same rule as the two tests above, second reason.
// ---------------------------------------------------------------------------

test("BALANCE ADJUSTMENTS ARE EXCLUDED FROM SPEND (regression)", () => {
  // The reporting device's actual numbers: a ₱662.61 bill and a −₱4,964.60
  // correction, of which only the bill was money going anywhere.
  const transactions = [
    tx({ date: "2026-08-30", direction: "out", amount: 66261 }),
    tx({ date: "2026-08-30", direction: "out", amount: 496460, isAdjustment: true }),
  ];

  const summary = summarizePeriod(transactions, AUGUST);
  expect(summary.spend).toBe(66261);
  expect(summary.transactionCount).toBe(1);
});

test("BALANCE ADJUSTMENTS ARE EXCLUDED FROM INCOME (regression)", () => {
  // A correction upward is not a pay packet. Left counting, it would also
  // teach the income cadence detector a payday that never happens.
  const transactions = [
    tx({ date: "2026-08-30", direction: "in", amount: 50000 }),
    tx({ date: "2026-08-30", direction: "in", amount: 499500, isAdjustment: true }),
  ];

  expect(summarizePeriod(transactions, AUGUST).income).toBe(50000);
});

test("BALANCE ADJUSTMENTS ARE EXCLUDED FROM CATEGORY TOTALS, TRENDS AND TOP MERCHANTS", () => {
  // One assertion per surface rather than one per test: the point is that a
  // single predicate covers all of them, and a fix applied to `summarizePeriod`
  // alone would pass the two tests above while leaving the Reports tab wrong.
  const transactions = [
    tx({ date: "2026-08-05", direction: "out", amount: 20000, merchant: "Jollibee" }),
    tx({
      date: "2026-08-06",
      direction: "out",
      amount: 496460,
      merchant: "Jollibee",
      isAdjustment: true,
    }),
  ];

  const categories = [category({ id: "cat_food", name: "Food & Dining" })];

  expect(categoryBreakdown(transactions, categories, AUGUST)[0].total).toBe(20000);
  expect(trendSeries(transactions, [AUGUST])[0].spend).toBe(20000);
  expect(topMerchants(transactions, AUGUST, 5)[0]).toEqual({
    merchant: "Jollibee",
    total: 20000,
    count: 1,
  });
});

test("an empty range returns zeros, not a throw", () => {
  const transactions = [
    tx({ date: "2026-01-05", direction: "out", amount: 30000 }),
    tx({ date: "2026-01-10", direction: "in", amount: 5000 }),
  ];

  expect(summarizePeriod(transactions, AUGUST)).toEqual({
    range: AUGUST,
    spend: 0,
    income: 0,
    net: 0,
    transactionCount: 0,
  });
});

test("range bounds are inclusive on both ends", () => {
  // Rule 4, and this task's ruling: DateRange is inclusive, not the
  // interface contract's usual half-open [from, to) — see the module header.
  const transactions = [
    tx({ date: "2026-08-01", amount: 10000 }), // first day, inside
    tx({ date: "2026-08-31", amount: 20000 }), // last day, inside
    tx({ date: "2026-07-31", amount: 99999 }), // one day early
    tx({ date: "2026-09-01", amount: 99999 }), // one day late
  ];

  const summary = summarizePeriod(transactions, AUGUST);
  expect(summary.spend).toBe(30000);
  expect(summary.transactionCount).toBe(2);
});

// ---------------------------------------------------------------------------
// categoryBreakdown — rules 2, 3, 5
// ---------------------------------------------------------------------------
test("TRANSFER LEGS ARE EXCLUDED FROM CATEGORY TOTALS", () => {
  const categories = [category({ id: "cat_food", name: "Food & Dining" })];
  const transactions = [
    tx({ date: "2026-08-05", categoryId: "cat_food", amount: 20000 }),
    tx({ date: "2026-08-06", categoryId: "cat_food", amount: 500000, transferLinkId: "link_3" }),
  ];

  const breakdown = categoryBreakdown(transactions, categories, AUGUST);
  expect(breakdown).toEqual([
    { categoryId: "cat_food", categoryName: "Food & Dining", total: 20000, share: 1 },
  ]);
});

test("category shares sum to 1.0 within rounding tolerance", () => {
  const categories = [
    category({ id: "cat_a", name: "A" }),
    category({ id: "cat_b", name: "B" }),
    category({ id: "cat_c", name: "C" }),
  ];
  const transactions = [
    tx({ date: "2026-08-01", categoryId: "cat_a", amount: 333 }),
    tx({ date: "2026-08-02", categoryId: "cat_b", amount: 667 }),
    tx({ date: "2026-08-03", categoryId: "cat_c", amount: 1000 }),
  ];

  const breakdown = categoryBreakdown(transactions, categories, AUGUST);
  const totalShare = breakdown.reduce((sum, row) => sum + row.share, 0);

  expect(Math.abs(totalShare - 1)).toBeLessThan(1e-9);
});

test("CHILD CATEGORIES ROLL INTO THEIR PARENT BY DEFAULT", () => {
  // Rule 3: "a breakdown that lists eleven sub-categories of Food is not a
  // breakdown."
  const categories = [
    category({ id: "cat_food", name: "Food & Dining", parentId: null }),
    category({ id: "cat_fastfood", name: "Fast Food", parentId: "cat_food" }),
  ];
  const transactions = [
    tx({ date: "2026-08-05", categoryId: "cat_food", amount: 10000 }),
    tx({ date: "2026-08-06", categoryId: "cat_fastfood", amount: 5000 }),
  ];

  const rolledUp = categoryBreakdown(transactions, categories, AUGUST);
  expect(rolledUp).toEqual([
    { categoryId: "cat_food", categoryName: "Food & Dining", total: 15000, share: 1 },
  ]);

  // The "option to expand" rule 3 calls for: same data, every category
  // listed separately at its own level instead of rolled up.
  const expanded = categoryBreakdown(transactions, categories, AUGUST, { expand: true });
  expect(expanded).toHaveLength(2);
  expect(expanded.map((row) => row.categoryId).sort()).toEqual(["cat_fastfood", "cat_food"]);
});

test("ROLLUP WALKS TO THE TOP-LEVEL ANCESTOR, NOT JUST ONE PARENT LEVEL UP", () => {
  // A regression that clipped the walk to a single `parentId` hop would still
  // pass the two-level test above (child's parent IS the root there). This
  // pins the three-level case: grandchild -> child -> root, where a
  // one-level rollup would wrongly stop at "child".
  const categories = [
    category({ id: "cat_food", name: "Food & Dining", parentId: null }),
    category({ id: "cat_fastfood", name: "Fast Food", parentId: "cat_food" }),
    category({ id: "cat_burgers", name: "Burgers", parentId: "cat_fastfood" }),
  ];
  const transactions = [tx({ date: "2026-08-05", categoryId: "cat_burgers", amount: 7500 })];

  const breakdown = categoryBreakdown(transactions, categories, AUGUST);

  expect(breakdown).toEqual([
    { categoryId: "cat_food", categoryName: "Food & Dining", total: 7500, share: 1 },
  ]);
});

test("A DANGLING PARENT STOPS THE ROLLUP AT THE LAST CATEGORY ACTUALLY FOUND", () => {
  // "cat_fastfood" names a parent ("cat_food") that is not in the passed
  // `categories` array — e.g. a parent deleted out from under a still-live
  // child. The walk must stop AT "cat_fastfood" (a real, named Category),
  // not advance onto the missing "cat_food" id: the alternative surfaces a
  // raw, nameless id as both categoryId and categoryName in the row.
  const categories = [category({ id: "cat_fastfood", name: "Fast Food", parentId: "cat_food" })];
  const transactions = [tx({ date: "2026-08-05", categoryId: "cat_fastfood", amount: 6000 })];

  const breakdown = categoryBreakdown(transactions, categories, AUGUST);

  expect(breakdown).toEqual([
    { categoryId: "cat_fastfood", categoryName: "Fast Food", total: 6000, share: 1 },
  ]);
});

test("categoryBreakdown returns an empty array, not NaN shares, when there is no spend", () => {
  // Rule 6's "zeroed, not thrown" for the breakdown: a set that is entirely
  // transfer-linked (or entirely out of range) must reach the
  // totalSpend === 0 guard rather than divide by it.
  const categories = [category({ id: "cat_food", name: "Food & Dining" })];
  const transactions = [
    tx({ date: "2026-08-05", categoryId: "cat_food", amount: 500000, transferLinkId: "link_5" }),
  ];

  expect(categoryBreakdown(transactions, categories, AUGUST)).toEqual([]);
});

test("UNCATEGORIZED APPEARS AS ITS OWN ROW, NEVER HIDDEN", () => {
  // Rule 5. Uncategorized is passed in like any other Category — this module
  // never special-cases an id, so hiding it is structurally impossible here,
  // not just unimplemented.
  const categories = [
    category({ id: "cat_food", name: "Food & Dining" }),
    category({ id: "cat_uncategorized", name: "Uncategorized" }),
  ];
  const transactions = [
    tx({ date: "2026-08-05", categoryId: "cat_food", amount: 40000 }),
    tx({ date: "2026-08-06", categoryId: "cat_uncategorized", amount: 10000 }),
  ];

  const breakdown = categoryBreakdown(transactions, categories, AUGUST);
  const uncategorized = breakdown.find((row) => row.categoryId === "cat_uncategorized");

  expect(uncategorized).toEqual({
    categoryId: "cat_uncategorized",
    categoryName: "Uncategorized",
    total: 10000,
    share: 0.2,
  });
});

// ---------------------------------------------------------------------------
// trendSeries — rule 1 applied across periods
// ---------------------------------------------------------------------------
test("TRANSFER LEGS ARE EXCLUDED FROM TRENDS", () => {
  const july = { from: "2026-07-01", to: "2026-07-31" };
  const august = AUGUST;
  const transactions = [
    tx({ date: "2026-07-10", direction: "out", amount: 20000 }),
    tx({ date: "2026-07-11", direction: "out", amount: 800000, transferLinkId: "link_4" }),
    tx({ date: "2026-08-10", direction: "in", amount: 50000 }),
  ];

  const trend = trendSeries(transactions, [july, august]);

  expect(trend).toEqual([
    { label: "2026-07-01", range: july, spend: 20000, income: 0 },
    { label: "2026-08-01", range: august, spend: 0, income: 50000 },
  ]);
});

// ---------------------------------------------------------------------------
// topMerchants
// ---------------------------------------------------------------------------
test("topMerchants orders by total descending and respects the limit", () => {
  const transactions = [
    tx({ date: "2026-08-01", merchant: "Jollibee", amount: 30000 }),
    tx({ date: "2026-08-02", merchant: "Jollibee", amount: 20000 }),
    tx({ date: "2026-08-03", merchant: "Shopee", amount: 80000 }),
    tx({ date: "2026-08-04", merchant: "Grab", amount: 10000 }),
  ];

  const top = topMerchants(transactions, AUGUST, 2);

  expect(top).toEqual([
    { merchant: "Shopee", total: 80000, count: 1 },
    { merchant: "Jollibee", total: 50000, count: 2 },
  ]);
});

test("TRANSFER LEGS ARE EXCLUDED FROM TOP MERCHANTS", () => {
  // Rule 1 applies here too, and the brief calls it "the single rule that
  // decides whether the reports are true" across every one of the five
  // surfaces — this is the last of the five without its own regression.
  // A huge transfer-linked leg to Grab must neither inflate Grab's total nor
  // vault it past Shopee's rank.
  const transactions = [
    tx({ date: "2026-08-01", merchant: "Shopee", amount: 80000 }),
    tx({ date: "2026-08-02", merchant: "Grab", amount: 10000 }),
    tx({ date: "2026-08-03", merchant: "Grab", amount: 900000, transferLinkId: "link_6" }),
  ];

  const top = topMerchants(transactions, AUGUST, 5);

  expect(top).toEqual([
    { merchant: "Shopee", total: 80000, count: 1 },
    { merchant: "Grab", total: 10000, count: 1 },
  ]);
});
