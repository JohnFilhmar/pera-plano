// lib/limits/__tests__/limit_engine_thresholds.test.ts — m2 Task 6.
//
// Pure alert LOGIC only: which threshold fires, and in what order several
// limits are reported. The COPY lives in lib/alerts/alert_copy.ts and is tested
// there — see this file's counterpart notes in limit_engine.ts.
import type { LimitAlert } from "@/types/control";

import { coalesceAlerts, crossedThreshold, expandCategoryIds } from "../limit_engine";

/** Effective limit ₱10,000.00, so 50/80/100% land on 500k/800k/1,000k centavos. */
const LIMIT = 1_000_000;

// ---------------------------------------------------------------------------
// crossedThreshold — limits rules 19-23
// ---------------------------------------------------------------------------
test("fires when spend crosses from below a threshold to at-or-above it", () => {
  expect(
    crossedThreshold({ prevSpend: 490000, newSpend: 500000, effectiveLimit: LIMIT, alreadyFired: [] }),
  ).toBe(50);
});

test("at-or-above, not strictly above: landing exactly on the mark fires", () => {
  // Rule 19 says "at-or-above". A `>` implementation misses the exact hit,
  // which is the common case for a round-number limit and a round-number spend.
  expect(
    crossedThreshold({ prevSpend: 0, newSpend: 800000, effectiveLimit: LIMIT, alreadyFired: [] }),
  ).toBe(80);
  expect(
    crossedThreshold({ prevSpend: 0, newSpend: 799999, effectiveLimit: LIMIT, alreadyFired: [] }),
  ).toBe(50);
});

test("does not fire below the mark, nor when spend was already at it", () => {
  expect(
    crossedThreshold({ prevSpend: 0, newSpend: 499999, effectiveLimit: LIMIT, alreadyFired: [] }),
  ).toBeNull();
  expect(
    crossedThreshold({
      prevSpend: 500000,
      newSpend: 510000,
      effectiveLimit: LIMIT,
      alreadyFired: [50],
    }),
  ).toBeNull();
});

test("a jump across several thresholds fires only the HIGHEST (rule 21)", () => {
  // 40% -> 105% in one commit: 50 and 80 were both crossed, and neither fires.
  expect(
    crossedThreshold({ prevSpend: 400000, newSpend: 1050000, effectiveLimit: LIMIT, alreadyFired: [] }),
  ).toBe(100);
});

test("a fired threshold never re-arms within its period (rule 20)", () => {
  // 50 fired earlier; a deletion dropped spend below 50%; crossing again is silent.
  expect(
    crossedThreshold({
      prevSpend: 480000,
      newSpend: 520000,
      effectiveLimit: LIMIT,
      alreadyFired: [50],
    }),
  ).toBeNull();
  // A HIGHER one can still fire.
  expect(
    crossedThreshold({
      prevSpend: 520000,
      newSpend: 800000,
      effectiveLimit: LIMIT,
      alreadyFired: [50],
    }),
  ).toBe(80);
});

test("NEVER FIRES BELOW THE HIGHEST ALREADY FIRED, even a threshold never fired itself", () => {
  // THE CASE THE PLAN'S IMPLEMENTATION GETS WRONG. `alreadyFired: [80]` without
  // 50 is reachable and ordinary: one commit jumped 0 -> 85%, and rule 21 fired
  // only 80. Now a deletion drops spend to 40%, and a new commit takes it back
  // to 85%.
  //
  // A per-threshold `!alreadyFired.includes(t)` check finds 80 already fired,
  // falls through to 50, sees 50 was never fired, and notifies "50% of your
  // limit used" to a user sitting at 85% who was already told about 80%. Rule
  // 23 states the principle for 100 ("one breach alert, then silence"); rule 20
  // and IA §6.2's anti-spam rule generalise it. An alert that walks BACKWARDS
  // is never right.
  expect(
    crossedThreshold({
      prevSpend: 400000,
      newSpend: 850000,
      effectiveLimit: LIMIT,
      alreadyFired: [80],
    }),
  ).toBeNull();
});

test("after 100 has fired the limit is silent for the rest of the period (rule 23)", () => {
  expect(
    crossedThreshold({
      prevSpend: 1050000,
      newSpend: 1500000,
      effectiveLimit: LIMIT,
      alreadyFired: [50, 80, 100],
    }),
  ).toBeNull();
  // Even when only 100 is recorded — a single commit that jumped straight past
  // every mark records 100 alone.
  expect(
    crossedThreshold({
      prevSpend: 1050000,
      newSpend: 1500000,
      effectiveLimit: LIMIT,
      alreadyFired: [100],
    }),
  ).toBeNull();
});

test("raising the effective limit un-trips the display but never re-notifies (rule 20)", () => {
  // Spend of 520,000 was over 50% of 1,000,000; the user raised the limit to
  // 1,200,000, so it is now 43%. A later commit crosses 50% of the NEW limit
  // and must stay silent.
  expect(
    crossedThreshold({
      prevSpend: 520000,
      newSpend: 620000,
      effectiveLimit: 1200000,
      alreadyFired: [50],
    }),
  ).toBeNull();
});

test("a non-positive effective limit fires nothing rather than dividing by it", () => {
  // Reachable while a percent-of-income limit is paused mid-recompute. Every
  // mark would be 0, so every commit would "cross" 100% instantly.
  expect(
    crossedThreshold({ prevSpend: 0, newSpend: 1, effectiveLimit: 0, alreadyFired: [] }),
  ).toBeNull();
});

test("spend that does not move fires nothing", () => {
  expect(
    crossedThreshold({
      prevSpend: 800000,
      newSpend: 800000,
      effectiveLimit: LIMIT,
      alreadyFired: [50],
    }),
  ).toBeNull();
});

// ---------------------------------------------------------------------------
// coalesceAlerts — limits rule 22
// ---------------------------------------------------------------------------
const mk = (over: Partial<LimitAlert>): LimitAlert => ({
  limitId: "l1",
  limitName: "Monthly",
  scope: "monthly",
  threshold: 50,
  spend: 500000,
  effectiveLimit: LIMIT,
  daysLeft: 9,
  ...over,
});

test("orders most-severe first: threshold desc, then usage ratio desc", () => {
  const out = coalesceAlerts([
    mk({ limitId: "a", threshold: 50, spend: 500000 }),
    mk({ limitId: "b", threshold: 100, spend: 1010000 }),
    mk({ limitId: "c", threshold: 80, spend: 990000 }),
    mk({ limitId: "d", threshold: 80, spend: 800000 }),
  ]);

  // c before d is the ratio tie-break doing work: same threshold, 99% vs 80%.
  // Sorting on threshold alone leaves them in input order and passes nothing.
  expect(out.map((a) => a.limitId)).toEqual(["b", "c", "d", "a"]);
});

test("the ratio tie-break compares USAGE, not raw spend", () => {
  // A ₱2,000 spend against a ₱2,000 limit is more severe than ₱9,000 against
  // ₱20,000, and an implementation sorting on `spend` gets it backwards.
  const out = coalesceAlerts([
    mk({ limitId: "big", threshold: 80, spend: 900000, effectiveLimit: 2000000 }),
    mk({ limitId: "tight", threshold: 80, spend: 200000, effectiveLimit: 200000 }),
  ]);

  expect(out.map((a) => a.limitId)).toEqual(["tight", "big"]);
});

test("does not mutate the array it is given", () => {
  const input = [mk({ limitId: "a", threshold: 50 }), mk({ limitId: "b", threshold: 100 })];

  coalesceAlerts(input);

  // The caller still holds the recompute's own list; re-ordering it in place
  // would reorder whatever else that caller does with it.
  expect(input.map((a) => a.limitId)).toEqual(["a", "b"]);
});

test("a non-positive effective limit does not produce a NaN comparator", () => {
  // `spend / 0` is Infinity and `Infinity - Infinity` is NaN; a comparator
  // returning NaN leaves the sort order unspecified, so the "most severe"
  // notification could lead with anything.
  const out = coalesceAlerts([
    mk({ limitId: "zero", threshold: 80, spend: 100, effectiveLimit: 0 }),
    mk({ limitId: "real", threshold: 80, spend: 990000, effectiveLimit: LIMIT }),
  ]);

  expect(out.map((a) => a.limitId)).toEqual(["real", "zero"]);
});

test("empty and single inputs pass straight through", () => {
  expect(coalesceAlerts([])).toEqual([]);
  expect(coalesceAlerts([mk({ limitId: "only" })]).map((a) => a.limitId)).toEqual(["only"]);
});

// ---------------------------------------------------------------------------
// expandCategoryIds — limits rule 4 ("picking a parent includes all descendants")
// ---------------------------------------------------------------------------
const TREE = [
  { id: "food", parentId: null },
  { id: "delivery", parentId: "food" },
  { id: "grabfood", parentId: "delivery" },
  { id: "transport", parentId: null },
];

test("expands NESTED descendants, not just direct children", () => {
  // grabfood is a grandchild. A one-level implementation returns
  // ["food", "delivery"] and silently stops counting the user's actual spend.
  expect(expandCategoryIds(["food"], TREE).sort()).toEqual(["delivery", "food", "grabfood"]);
});

test("a leaf selection stays itself, and several roots union", () => {
  expect(expandCategoryIds(["grabfood"], TREE)).toEqual(["grabfood"]);
  expect(expandCategoryIds(["food", "transport"], TREE).sort()).toEqual([
    "delivery",
    "food",
    "grabfood",
    "transport",
  ]);
});

test("overlapping selections do not duplicate", () => {
  // Selecting a parent AND its own child is an ordinary thing to do in a
  // multi-select tree. Duplicated ids would inflate nothing today but would
  // make an `IN (?, ?, ?)` clause lie about its own length.
  expect(expandCategoryIds(["food", "delivery"], TREE).sort()).toEqual([
    "delivery",
    "food",
    "grabfood",
  ]);
});

test("an empty selection expands to nothing", () => {
  // NOT to every category. An empty filter means "no filter" upstream
  // (limits_repo stores it as NULL); if it ever reached here, returning the
  // whole tree would silently widen the limit instead.
  expect(expandCategoryIds([], TREE)).toEqual([]);
});

test("a cycle in the tree terminates instead of hanging", () => {
  // Nothing should ever write one, but a walk that trusts its input is a walk
  // that can freeze the app on a corrupted row rather than fail visibly.
  const cyclic = [
    { id: "a", parentId: "b" },
    { id: "b", parentId: "a" },
  ];

  expect(expandCategoryIds(["a"], cyclic).sort()).toEqual(["a", "b"]);
});
