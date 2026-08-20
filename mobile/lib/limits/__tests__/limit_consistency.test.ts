// lib/limits/__tests__/limit_consistency.test.ts — "show warnings on gaps
// between other created limits" (owner, 2026-08-20).
import { findLimitGaps, type ResolvedLimit } from "../limit_consistency";
import { derivedLimitsFrom } from "../limit_derivation";
import type { Limit, LimitScope } from "@/types/domain";

function resolved(
  id: string,
  scope: LimitScope,
  base: number,
  filters: Partial<Pick<ResolvedLimit, "categoryFilter" | "walletFilter">> = {},
): ResolvedLimit {
  return {
    id,
    scope,
    base,
    categoryFilter: filters.categoryFilter ?? null,
    walletFilter: filters.walletFilter ?? null,
  };
}

test("a weekly limit looser than the monthly one is a contradiction", () => {
  // ₱10,000/week is ~₱1,425/day; ₱20,000/month is ~₱657/day. Spending to the
  // weekly cap blows the monthly one before the month is out.
  const gaps = findLimitGaps([
    resolved("weekly", "weekly", 1_000_000),
    resolved("monthly", "monthly", 2_000_000),
  ]);

  expect(gaps).toHaveLength(1);
  expect(gaps[0].kind).toBe("contradiction");
  expect(gaps[0].shorterId).toBe("weekly");
  expect(gaps[0].longerId).toBe("monthly");
});

test("the contradiction names a figure that would actually resolve it", () => {
  // A warning that says only "these disagree" leaves the user guessing. The
  // suggested monthly figure is computed with the derivation's own inverse, so
  // taking it clears the warning rather than landing just short.
  const gaps = findLimitGaps([
    resolved("weekly", "weekly", 1_000_000),
    resolved("monthly", "monthly", 2_000_000),
  ]);

  // ₱10,000/week × 52 ÷ 12 = ~₱43,333/month.
  expect(gaps[0].message).toContain("₱43,333");
});

test("a monthly limit far looser than the weekly one never binds", () => {
  // ₱2,000/week is ~₱285/day; ₱50,000/month is ~₱1,643/day. The monthly limit
  // is real but unreachable — decorative, and worth saying so.
  const gaps = findLimitGaps([
    resolved("weekly", "weekly", 200_000),
    resolved("monthly", "monthly", 5_000_000),
  ]);

  expect(gaps).toHaveLength(1);
  expect(gaps[0].kind).toBe("never-binds");
  expect(gaps[0].message).toContain("never be reached");
});

test("A DERIVED SET WARNS ABOUT NOTHING — the margins exist for exactly this", () => {
  // THE TEST THAT KEEPS THE FEATURE CREDIBLE. Onboarding creates all four
  // cadences from one answer, and they are consistent by construction — but
  // they round to the centavo at each cadence, and a year is 52 weeks AND 365
  // days, which do not reconcile. A bare `>` would fire a warning on the set
  // the app itself just built, which is how users learn to ignore warnings.
  const source: Limit = {
    id: "l-source",
    scope: "monthly",
    basis: "fixed",
    value: 2_000_000,
    categoryFilter: null,
    walletFilter: null,
    rollover: false,
    isActive: true,
    thresholdsFired: [],
    archivedAt: null,
    derivedFrom: null,
    createdAt: 0,
    updatedAt: 0,
  };

  const all = [
    resolved(source.id, source.scope, source.value),
    ...derivedLimitsFrom(source).map((d, i) => resolved(`d-${i}`, d.scope, d.value)),
  ];

  expect(findLimitGaps(all)).toEqual([]);
});

test("a category limit does not contradict an overall limit", () => {
  // ₱2,000/week on food is tighter per day than ₱20,000/month overall, which
  // would read as "never binds" if coverage were ignored. It is not a gap: the
  // food limit is a SUBSET of the overall one, and warning here would fire on
  // the single most sensible way to use limits.
  const gaps = findLimitGaps([
    resolved("food", "weekly", 200_000, { categoryFilter: ["c-food"] }),
    resolved("overall", "monthly", 2_000_000),
  ]);

  expect(gaps).toEqual([]);
});

test("limits on the same category ARE compared", () => {
  // The other half of the rule above — filtering by coverage must not silently
  // disable the whole feature for anyone using category limits.
  const gaps = findLimitGaps([
    resolved("food-week", "weekly", 1_000_000, { categoryFilter: ["c-food"] }),
    resolved("food-month", "monthly", 2_000_000, { categoryFilter: ["c-food"] }),
  ]);

  expect(gaps).toHaveLength(1);
  expect(gaps[0].kind).toBe("contradiction");
});

test("filter order does not decide whether two limits are comparable", () => {
  const gaps = findLimitGaps([
    resolved("a", "weekly", 1_000_000, { categoryFilter: ["c-food", "c-transport"] }),
    resolved("b", "monthly", 2_000_000, { categoryFilter: ["c-transport", "c-food"] }),
  ]);

  expect(gaps).toHaveLength(1);
});

test("two limits at the same cadence are not compared to each other", () => {
  // Two monthly limits are not a cadence disagreement; whatever else they are,
  // this module has nothing to say about them.
  const gaps = findLimitGaps([
    resolved("a", "monthly", 2_000_000),
    resolved("b", "monthly", 9_000_000),
  ]);

  expect(gaps).toEqual([]);
});

test("contradictions are listed before slack", () => {
  // A contradiction means the user is heading for an overspend they were never
  // warned about; a decorative limit is merely untidy.
  const gaps = findLimitGaps([
    resolved("daily", "daily", 1_000), // ₱10/day — very tight
    resolved("weekly", "weekly", 1_000_000), // ₱10,000/week — very loose
    resolved("monthly", "monthly", 2_000_000), // ₱20,000/month
  ]);

  expect(gaps.length).toBeGreaterThan(1);
  expect(gaps[0].kind).toBe("contradiction");
  expect(gaps[gaps.length - 1].kind).toBe("never-binds");
});

test("a zero or negative base is skipped rather than dividing into nonsense", () => {
  // A paused percent-of-income limit resolves to no base at all; the caller
  // should not pass it, and this is what happens if it does.
  const gaps = findLimitGaps([
    resolved("weekly", "weekly", 0),
    resolved("monthly", "monthly", 2_000_000),
  ]);

  expect(gaps).toEqual([]);
});

test("one limit on its own can disagree with nothing", () => {
  expect(findLimitGaps([resolved("only", "monthly", 2_000_000)])).toEqual([]);
  expect(findLimitGaps([])).toEqual([]);
});
