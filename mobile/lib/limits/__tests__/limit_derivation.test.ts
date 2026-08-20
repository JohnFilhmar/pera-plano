// lib/limits/__tests__/limit_derivation.test.ts — owner decision, 2026-08-20.
//
// THE REPORT: "limits are still not automated to auto insert to user's
// database, its okay because user can update it anyways; a user in onboarding
// gets asked explicitly and optionally a monthly limit ... and after entering
// it, navigating to plan->limits only shows the entered onboarding data, not
// calculated."
//
// So one answer populates every cadence. The arithmetic below is NOT invented
// here — it is `baseFor`'s, in lib/limits/limit_engine.ts, which already
// resolves a percent-of-income limit per scope:
//
//     monthly = M × v%   ·   annual = 12M × v%
//     weekly  = (12M ÷ 52) × v%   ·   daily = (12M ÷ 365) × v%
//
// Reusing those exact ratios is what keeps a derived FIXED limit agreeing with
// the equivalent PERCENT limit. Picking "nicer" calendar constants (30.4375
// days a month, 365.25 days a year) would put the two permanently, invisibly
// out of step for every user who has one of each.
import { derivedLimitsFrom, dailyRateOf } from "../limit_derivation";
import { baseFor } from "../limit_engine";
import type { Limit } from "@/types/domain";

function limit(overrides: Partial<Limit> = {}): Limit {
  return {
    id: "l-source",
    scope: "monthly",
    basis: "fixed",
    value: 2_000_000, // ₱20,000.00
    categoryFilter: null,
    walletFilter: null,
    rollover: false,
    isActive: true,
    thresholdsFired: [],
    archivedAt: null,
    derivedFrom: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

test("it derives exactly the three cadences the source is not", () => {
  const derived = derivedLimitsFrom(limit({ scope: "monthly" }));

  expect(derived.map((d) => d.scope).sort()).toEqual(["annual", "daily", "weekly"]);
});

test("IT FILLS IN WHAT IS MISSING RATHER THAN ALWAYS CREATING THREE", () => {
  // THE COMPOUNDING BUG THIS PREVENTS. Onboarding runs the derivation once
  // against an empty set, which is the easy case. The manual create route runs
  // it too — so without an occupied-scope check, a user who already had all
  // four cadences and then added one more limit by hand would get three MORE
  // rows, and three more again on the next save, every deliberate limit
  // spawning duplicates at cadences that were already covered.
  const derived = derivedLimitsFrom(limit({ scope: "monthly" }), ["daily", "weekly", "annual"]);

  expect(derived).toEqual([]);
});

test("it fills only the genuinely empty cadences", () => {
  const derived = derivedLimitsFrom(limit({ scope: "monthly" }), ["weekly"]);

  expect(derived.map((d) => d.scope).sort()).toEqual(["annual", "daily"]);
});

test("with nothing occupied it still derives all three", () => {
  // The onboarding case, and the default when no list is passed at all.
  expect(derivedLimitsFrom(limit({ scope: "monthly" }), [])).toHaveLength(3);
  expect(derivedLimitsFrom(limit({ scope: "monthly" }))).toHaveLength(3);
});

test("every derived limit names the one it came from", () => {
  // THE ENTITLEMENT GATE READS THIS. `canCreateLimit` caps Free at one active
  // limit, and four rows from one onboarding answer must not trip a gate the
  // user never approached.
  const derived = derivedLimitsFrom(limit({ id: "l-source" }));

  expect(derived.every((d) => d.derivedFrom === "l-source")).toBe(true);
});

test("a fixed monthly limit scales by the engine's own ratios", () => {
  // ₱20,000/month, converted through the annual figure exactly as `baseFor`
  // does: annual = 12M, weekly = 12M/52, daily = 12M/365.
  const derived = derivedLimitsFrom(limit({ scope: "monthly", basis: "fixed", value: 2_000_000 }));
  const byScope = Object.fromEntries(derived.map((d) => [d.scope, d.value]));

  expect(byScope.annual).toBe(24_000_000);
  expect(byScope.weekly).toBe(Math.round(24_000_000 / 52));
  expect(byScope.daily).toBe(Math.round(24_000_000 / 365));
});

test("deriving from a DAILY limit scales up, not only down", () => {
  // Onboarding lets the user pick the cadence now, so the source is not always
  // monthly. ₱500/day.
  const derived = derivedLimitsFrom(limit({ scope: "daily", basis: "fixed", value: 50_000 }));
  const byScope = Object.fromEntries(derived.map((d) => [d.scope, d.value]));

  expect(byScope.annual).toBe(50_000 * 365);
  expect(byScope.monthly).toBe(Math.round((50_000 * 365) / 12));
  expect(byScope.weekly).toBe(Math.round((50_000 * 365) / 52));
});

test("A PERCENT-OF-INCOME LIMIT KEEPS ITS PERCENT AT EVERY CADENCE", () => {
  // The one case that looks wrong and is right. `baseFor` already scales a
  // percent limit BY SCOPE — 20% monthly is M×0.20 while 20% daily is
  // (12M/365)×0.20 — so the stored `value` must NOT be divided again here.
  // Scaling it would apply the ratio twice and make a derived daily limit a
  // thirtieth of what the user meant.
  const derived = derivedLimitsFrom(limit({ basis: "percent-of-income", value: 2000 }));

  expect(derived.every((d) => d.value === 2000)).toBe(true);
  expect(derived.every((d) => d.basis === "percent-of-income")).toBe(true);
});

test("the derived percent limits resolve to the same money the engine computes", () => {
  // The claim above, checked against `baseFor` itself rather than restated.
  const monthlyIncome = 3_000_000; // ₱30,000/month
  const source = limit({ scope: "monthly", basis: "percent-of-income", value: 2000 });

  for (const derived of derivedLimitsFrom(source)) {
    expect(baseFor({ basis: derived.basis, value: derived.value, scope: derived.scope }, monthlyIncome)).toBe(
      baseFor({ basis: "percent-of-income", value: 2000, scope: derived.scope }, monthlyIncome),
    );
  }
});

test("rollover is NOT inherited", () => {
  // Rollover carries unused headroom into the next period. Switching it on for
  // three cadences the user never chose it for would quietly change how much
  // they may spend, in three places, from one answer about one of them.
  const derived = derivedLimitsFrom(limit({ rollover: true }));

  expect(derived.every((d) => d.rollover === false)).toBe(true);
});

test("a derived limit is never worth zero", () => {
  // 001_core.sql CHECKs `value > 0`, so a tiny source that rounds to nothing at
  // a shorter cadence would throw on insert. ₱1/year is under a centavo a day.
  const derived = derivedLimitsFrom(limit({ scope: "annual", basis: "fixed", value: 100 }));

  expect(derived.every((d) => d.value > 0)).toBe(true);
});

test("filters carry across, so a category limit stays a category limit", () => {
  const derived = derivedLimitsFrom(
    limit({ categoryFilter: ["c-food"], walletFilter: ["w-gcash"] }),
  );

  expect(derived.every((d) => d.categoryFilter?.[0] === "c-food")).toBe(true);
  expect(derived.every((d) => d.walletFilter?.[0] === "w-gcash")).toBe(true);
});

// ---------------------------------------------------------------------------
// `dailyRateOf` — the shared normaliser the gap warnings also use.
// ---------------------------------------------------------------------------

test("dailyRateOf puts every cadence on one comparable scale", () => {
  expect(dailyRateOf("daily", 50_000)).toBe(50_000);
  expect(dailyRateOf("annual", 365_000)).toBe(1_000);
  // 12 months of ₱30,000 is ₱360,000 a year, over 365 days.
  expect(dailyRateOf("monthly", 3_000_000)).toBeCloseTo((3_000_000 * 12) / 365, 6);
});

test("A WEEK IS 1/52 OF A YEAR, NOT 7 DAYS — and that is deliberate", () => {
  // 52 × 7 = 364, so a weekly rate converted through the year is ~0.27% under
  // the naive "divide by 7". THIS IS THE ENGINE'S OWN CONVENTION, inherited on
  // purpose: `baseFor` computes a weekly percent-of-income limit as
  // (12M ÷ 52) × v%, and a derivation that used 7 instead would put derived
  // FIXED limits permanently out of step with equivalent PERCENT ones.
  //
  // Pinned rather than papered over: anyone "fixing" this to 1000 is changing
  // which of the two kinds of limit is wrong, not making both right.
  expect(dailyRateOf("weekly", 7_000)).toBeCloseTo((7_000 * 52) / 365, 6);
  expect(dailyRateOf("weekly", 7_000)).toBeLessThan(1_000);
});

test("a round trip through dailyRateOf and back is stable", () => {
  // What makes the derivation self-consistent: deriving weekly from monthly and
  // then monthly back from that weekly lands on the figure it started at.
  const monthly = 2_000_000;
  const weekly = derivedLimitsFrom(limit({ scope: "monthly", value: monthly })).find(
    (d) => d.scope === "weekly",
  )!;
  const backToMonthly = derivedLimitsFrom(
    limit({ id: "l-2", scope: "weekly", value: weekly.value }),
  ).find((d) => d.scope === "monthly")!;

  // Within a peso — the two conversions each round to the centavo.
  expect(Math.abs(backToMonthly.value - monthly)).toBeLessThanOrEqual(100);
});
