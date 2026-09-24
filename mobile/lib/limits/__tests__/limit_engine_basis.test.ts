// lib/limits/__tests__/limit_engine_basis.test.ts — m2 Task 5.
//
// `value` IS PERCENT x 100. types/domain.ts: "basis 'percent-of-income':
// percent x 100 as an integer (12.5% -> 1250). Kept integer so nothing
// money-adjacent is a float." The m2 plan's own fixtures pass `value: 20` for
// 20% and divide by 100; against the shipped domain type that computes every
// percent-of-income limit 100x too small. 20% is 2000 here.
import type { LimitScope } from "@/types/domain";

import { baseFor, carryoverFor, effectiveLimitFor } from "../limit_engine";

/** ₱37,000.00 monthly-equivalent income, in centavos — the spec's own figure. */
const M = 3_700_000;
/** 20%, in the domain's percent x 100 encoding. */
const TWENTY_PERCENT = 2000;

const SCOPES: LimitScope[] = ["daily", "weekly", "monthly", "annual"];

// ---------------------------------------------------------------------------
// baseFor — limits rules 9-12
// ---------------------------------------------------------------------------
test("fixed basis: the base is the value, for every scope, income irrelevant", () => {
  for (const scope of SCOPES) {
    expect([scope, baseFor({ basis: "fixed", value: 800000, scope }, null)]).toEqual([
      scope,
      800000,
    ]);
    expect([scope, baseFor({ basis: "fixed", value: 800000, scope }, M)]).toEqual([scope, 800000]);
  }
});

test.each([
  ["monthly", 740000], //  M x 20%          = ₱7,400.00
  ["annual", 8880000], //  12M x 20%        = ₱88,800.00
  ["weekly", 170700], //   (12M / 52) x 20% = ₱1,707.69... -> floor ₱1,707.00
  ["daily", 24300], //     (12M / 365) x 20% = ₱243.28... -> floor ₱243.00
] as const)("percent basis, %s scope is %i centavos", (scope, expected) => {
  // The spec's own acceptance criterion (limits, M = ₱37,000.00, 20%). The
  // weekly and daily figures are the ones that pin ROUNDING DOWN — both have a
  // non-zero centavo remainder that a `Math.round` implementation would carry
  // upward, handing the user a larger limit than the conservative rule allows.
  expect(baseFor({ basis: "percent-of-income", value: TWENTY_PERCENT, scope }, M)).toBe(expected);
});

test("percent basis rounds DOWN to the whole peso, never to the nearest", () => {
  // ₱243.28 floors to ₱243.00. Rounding to nearest gives ₱243.00 too, so the
  // daily case alone does not discriminate — this one does: ₱1,707.69 rounds
  // UP to ₱1,708.00 and must not.
  expect(baseFor({ basis: "percent-of-income", value: TWENTY_PERCENT, scope: "weekly" }, M)).toBe(
    170700,
  );
  expect(
    baseFor({ basis: "percent-of-income", value: TWENTY_PERCENT, scope: "weekly" }, M),
  ).not.toBe(170800);
});

test("percent basis handles a fractional percent, which is why value is x100", () => {
  // 12.5% of ₱37,000.00 = ₱4,625.00. A whole-percent encoding cannot express
  // this input at all — it is the reason the domain type stores percent x 100.
  expect(baseFor({ basis: "percent-of-income", value: 1250, scope: "monthly" }, M)).toBe(462500);
  expect(baseFor({ basis: "percent-of-income", value: 10000, scope: "monthly" }, M)).toBe(M);
});

test("percent basis lands ON an exact peso boundary a float intermediate misses", () => {
  // Both pairs are exact multiples of ₱1.00 — there is no remainder for the
  // conservative floor to take. A `value / 10_000` fraction is an inexact
  // binary value, though, so the old float path arrived a hair BELOW the
  // boundary and the floor then took a whole peso off: 0.29 x 100000 is
  // 28999.999999999996, not 29000. The ₱37,000 pairs above cannot show this —
  // they all have a genuine centavo remainder, which hides the one-peso drop
  // inside rounding that was going to happen anyway.
  //
  // ₱1,000.00 at 29% is ₱290.00; the float path returned ₱289.00.
  expect(baseFor({ basis: "percent-of-income", value: 2900, scope: "monthly" }, 100_000)) //
    .toBe(29_000);
  // ₱15,000.00 at 14.5% is ₱2,175.00; the float path returned ₱2,174.00.
  expect(baseFor({ basis: "percent-of-income", value: 1450, scope: "monthly" }, 1_500_000)) //
    .toBe(217_500);
});

test("percent basis agrees with exact BigInt arithmetic on every scope", () => {
  // The two pinned pairs above are members of a class, not curiosities: the
  // drop hits a few thousandths of a percent of inputs, which is exactly the
  // density hand-picked cases miss. BigInt is the oracle because it cannot
  // round at all — 12, 52 and 365 belong in the divisor so there is a single
  // division, and it is integral.
  const divisorFor: Record<LimitScope, bigint> = {
    monthly: 1_000_000n,
    annual: 1_000_000n,
    weekly: 52_000_000n,
    daily: 365_000_000n,
  };

  for (let peso = 1_000; peso <= 40_000; peso += 1_000) {
    const income = peso * 100;
    for (let value = 50; value <= 10_000; value += 250) {
      for (const scope of SCOPES) {
        const numerator = BigInt(scope === "monthly" ? income : 12 * income) * BigInt(value);
        const exact = Number(numerator / divisorFor[scope]) * 100;
        // Income, percent and scope ride along in the tuple so a failure names
        // the offending pair instead of reporting two bare centavo figures.
        expect([income, value, scope, baseFor({ basis: "percent-of-income", value, scope }, income)])
          .toEqual([income, value, scope, exact]);
      }
    }
  }
});

test("percent basis with UNKNOWN income is paused (null), never ₱0.00", () => {
  for (const scope of SCOPES) {
    expect([scope, baseFor({ basis: "percent-of-income", value: TWENTY_PERCENT, scope }, null)]) //
      .toEqual([scope, null]);
  }
});

test("percent basis with ZERO income is ALSO paused, not a base of ₱0.00", () => {
  // Limits rule 12: a usable IncomeProfile needs a NON-ZERO averageAmount, and
  // "income is never silently treated as ₱0.00". A base of 0 is not a limit —
  // it is a permanently breached one that alerts on the first centavo forever,
  // which is precisely the silent ₱0.00 the rule forbids. The plan guards only
  // `=== null`.
  expect(baseFor({ basis: "percent-of-income", value: TWENTY_PERCENT, scope: "monthly" }, 0)) //
    .toBeNull();
});

// ---------------------------------------------------------------------------
// carryoverFor — limits rules 14-17
// ---------------------------------------------------------------------------
const BASE = 800000; // ₱8,000.00 monthly

test("carries unused headroom forward: ₱5,000 spent of ₱8,000 leaves ₱3,000", () => {
  // The spec's worked example: June effective ₱8,000, spend ₱5,000 -> July
  // effective ₱11,000.
  expect(carryoverFor({ rollover: true, prevBase: BASE, prevSpend: 500000, base: BASE })).toBe(
    300000,
  );
  expect(effectiveLimitFor(BASE, 300000)).toBe(1100000);
});

test("caps at one full base: spending nothing carries one base, not more", () => {
  // Spec: spend ₱0.00 in June -> July effective ₱16,000.00 (cap at one base).
  expect(carryoverFor({ rollover: true, prevBase: BASE, prevSpend: 0, base: BASE })).toBe(BASE);
  expect(effectiveLimitFor(BASE, BASE)).toBe(1600000);
});

test("NEVER COMPOUNDS: an unspent inflated period still carries at most one base", () => {
  // THE TEST THAT DISCRIMINATES THE UPPER CLAMP. July ran at effective ₱16,000
  // (base ₱8,000 + carryover ₱8,000) and spent nothing. Feed that ₱16,000 in as
  // the previous period's figure and the answer must still be ₱8,000 — the
  // spec's "August receives at most ₱8,000 carryover regardless of July's
  // savings (no compounding)".
  //
  // An implementation written as `Math.max(0, prevBase - prevSpend)` — dropping
  // the `Math.min(..., base)` — returns 1,600,000 here and passes every other
  // test in this file, because in all of them the headroom happens to be at or
  // below one base.
  expect(carryoverFor({ rollover: true, prevBase: 1600000, prevSpend: 0, base: BASE })).toBe(BASE);
});

test("a breached period contributes zero — there is no negative rollover", () => {
  // Rule 17. Without the lower clamp this returns -100000, and August's
  // effective limit silently shrinks to ₱7,000 with nothing on screen saying so.
  expect(carryoverFor({ rollover: true, prevBase: BASE, prevSpend: 900000, base: BASE })).toBe(0);
  expect(effectiveLimitFor(BASE, 0)).toBe(BASE);
});

test("spending exactly the base carries nothing, and is not a breach", () => {
  expect(carryoverFor({ rollover: true, prevBase: BASE, prevSpend: BASE, base: BASE })).toBe(0);
});

test("rollover off is always zero, whatever the previous period did", () => {
  expect(carryoverFor({ rollover: false, prevBase: BASE, prevSpend: 0, base: BASE })).toBe(0);
  expect(carryoverFor({ rollover: false, prevBase: BASE, prevSpend: 900000, base: BASE })).toBe(0);
});

test("clamps to the CURRENT base when the two bases differ", () => {
  // percent-of-income drift: income fell, so this period's base is smaller than
  // last period's. Headroom ₱7,000 but the current base is ₱6,000, so ₱6,000.
  // Clamping against prevBase instead would let a shrinking income carry
  // forward more headroom than the new limit itself.
  expect(carryoverFor({ rollover: true, prevBase: 800000, prevSpend: 100000, base: 600000 })).toBe(
    600000,
  );
});

test("effectiveLimitFor is base plus carryover (rule 15)", () => {
  expect(effectiveLimitFor(800000, 0)).toBe(800000);
  expect(effectiveLimitFor(800000, 300000)).toBe(1100000);
  expect(effectiveLimitFor(0, 0)).toBe(0);
});
