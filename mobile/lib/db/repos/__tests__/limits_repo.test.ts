// lib/db/repos/__tests__/limits_repo.test.ts — m2 Task 3.
//
// Runs against the REAL migrations through freshDb(), so a column name this
// repo guessed wrong fails here rather than on a device. That already caught
// the plan: it was written against `category_filter` / `wallet_filter` /
// `thresholds_fired`, and 001_core.sql actually ships `category_filter_json` /
// `wallet_filter_json` / `thresholds_fired_json`.
import { closeDatabase } from "@/lib/db/database";
import type { SQLiteDatabase } from "@/lib/db/database";
import { freshDb } from "@/test_support/db";
import type { LimitAlertState } from "@/types/control";

import {
  createLimit,
  deleteLimit,
  getLimit,
  getLimitAlertState,
  LimitNotFoundError,
  listLimits,
  setLimitAlertState,
  updateLimit,
} from "../limits_repo";

let db: SQLiteDatabase;

beforeEach(async () => {
  db = await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

/** A complete alert state. Every field differs from every other, so a mapper
 *  that crossed two of them cannot round-trip. */
const STATE: LimitAlertState = {
  periodStart: new Date(2026, 7, 1).getTime(),
  base: 800000,
  carryover: 300000,
  fired: [50, 80],
  muted: false,
  lastSpend: 650000,
};

// ---------------------------------------------------------------------------
// Create / read
// ---------------------------------------------------------------------------
test("creates and reads a fixed monthly limit with defaults", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });

  expect(limit.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(limit.scope).toBe("monthly");
  expect(limit.basis).toBe("fixed");
  expect(limit.value).toBe(800000); // ₱8,000.00 in centavos
  expect(limit.categoryFilter).toBeNull();
  expect(limit.walletFilter).toBeNull();
  expect(limit.rollover).toBe(false);
  expect(limit.isActive).toBe(true);
  expect(limit.thresholdsFired).toEqual([]);
  expect(limit.createdAt).toBe(limit.updatedAt);

  expect(await getLimit(limit.id)).toEqual(limit);
});

test("getLimit returns null for an id that does not exist", async () => {
  expect(await getLimit("no-such-limit")).toBeNull();
});

test("a percent-of-income limit stores percent x 100, not whole percent", async () => {
  // types/domain.ts pins it: "percent x 100 as an integer (12.5% -> 1250).
  // Kept integer so nothing money-adjacent is a float." The m2 plan's NewLimit
  // comment says "whole percent 0-100" and is wrong; the domain type is law.
  const limit = await createLimit({ scope: "monthly", basis: "percent-of-income", value: 1250 });

  expect(limit.value).toBe(1250);
  expect(limit.basis).toBe("percent-of-income");
});

test("round-trips filters as JSON arrays", async () => {
  const limit = await createLimit({
    scope: "weekly",
    basis: "fixed",
    value: 150000,
    categoryFilter: ["cat-food"],
    walletFilter: ["w-gcash"],
    rollover: true,
  });

  const read = await getLimit(limit.id);
  expect(read?.categoryFilter).toEqual(["cat-food"]);
  expect(read?.walletFilter).toEqual(["w-gcash"]);
  expect(read?.rollover).toBe(true);
});

test("an EMPTY filter array is stored as NULL, meaning no filter", async () => {
  // The distinction is not cosmetic. NULL means "count every category"; a
  // stored "[]" would read as "count transactions whose category is in the
  // empty set" — a limit that can never be reached and never alerts.
  const limit = await createLimit({
    scope: "daily",
    basis: "fixed",
    value: 50000,
    categoryFilter: [],
    walletFilter: [],
  });

  const row = await db.getFirstAsync<{
    category_filter_json: string | null;
    wallet_filter_json: string | null;
  }>("SELECT category_filter_json, wallet_filter_json FROM limits WHERE id = ?", [limit.id]);

  expect(row?.category_filter_json).toBeNull();
  expect(row?.wallet_filter_json).toBeNull();
  expect(limit.categoryFilter).toBeNull();
  expect(limit.walletFilter).toBeNull();
});

test("the database rejects a non-positive value", async () => {
  // 001_core.sql's CHECK (value > 0). A limit of ₱0.00 is not a limit; it is a
  // permanently breached one that would alert on the first centavo forever.
  await expect(createLimit({ scope: "daily", basis: "fixed", value: 0 })).rejects.toThrow();
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
test("lists limits, optionally active-only", async () => {
  const active = await createLimit({ scope: "daily", basis: "fixed", value: 50000 });
  const inactive = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 800000,
    isActive: false,
  });

  expect((await listLimits()).map((l) => l.id).sort()).toEqual([active.id, inactive.id].sort());

  const onlyActive = await listLimits({ activeOnly: true });
  expect(onlyActive).toHaveLength(1);
  expect(onlyActive[0].id).toBe(active.id);
});

test("listLimits is empty on a fresh database", async () => {
  expect(await listLimits()).toEqual([]);
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
test("updates fields and bumps updatedAt", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });

  const updated = await updateLimit(limit.id, { value: 900000, rollover: true });

  expect(updated.value).toBe(900000);
  expect(updated.rollover).toBe(true);
  expect(updated.updatedAt).toBeGreaterThanOrEqual(limit.updatedAt);
  expect(updated.createdAt).toBe(limit.createdAt);
});

test("a partial patch leaves every unnamed field alone", async () => {
  const limit = await createLimit({
    scope: "weekly",
    basis: "fixed",
    value: 150000,
    categoryFilter: ["cat-food"],
    walletFilter: ["w-gcash"],
    rollover: true,
    isActive: false,
  });

  const updated = await updateLimit(limit.id, { value: 160000 });

  expect(updated.value).toBe(160000);
  expect(updated.scope).toBe("weekly");
  expect(updated.categoryFilter).toEqual(["cat-food"]);
  expect(updated.walletFilter).toEqual(["w-gcash"]);
  expect(updated.rollover).toBe(true);
  expect(updated.isActive).toBe(false);
});

test("an EXPLICIT null clears a filter, while omitting it preserves one", async () => {
  // `patch.categoryFilter !== undefined` rather than `??`: with `??` there is
  // no way to say "remove the filter" — clearing and not-mentioning would be
  // the same request, and a user could never widen a limit back to all
  // categories.
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 800000,
    categoryFilter: ["cat-food"],
    walletFilter: ["w-gcash"],
  });

  const cleared = await updateLimit(limit.id, { categoryFilter: null });

  expect(cleared.categoryFilter).toBeNull();
  expect(cleared.walletFilter).toEqual(["w-gcash"]);
});

test("updateLimit throws LimitNotFoundError for an unknown id", async () => {
  await expect(updateLimit("no-such-limit", { value: 1 })).rejects.toThrow(LimitNotFoundError);
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
test("deletes a limit", async () => {
  const limit = await createLimit({ scope: "annual", basis: "fixed", value: 12000000 });

  await deleteLimit(limit.id);

  expect(await getLimit(limit.id)).toBeNull();
});

test("deleting a limit deletes its alert state with it", async () => {
  // The reason the state lives in a COLUMN rather than an app_settings map:
  // there is no orphan to clean up, because the row carries it.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });
  await setLimitAlertState(limit.id, STATE);

  await deleteLimit(limit.id);

  expect(await getLimitAlertState(limit.id)).toBeNull();
});

// ---------------------------------------------------------------------------
// Per-period alert state — the part 004_limit_alert_state.sql exists for
// ---------------------------------------------------------------------------
test("alert state is null before the first evaluation", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });

  expect(await getLimitAlertState(limit.id)).toBeNull();
});

test("stores and reads every field of the per-period alert state", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });

  await setLimitAlertState(limit.id, STATE);

  expect(await getLimitAlertState(limit.id)).toEqual(STATE);
});

test("`fired` lands in thresholds_fired_json, so the domain Limit stays truthful", async () => {
  // THE ASSERTION THAT KEEPS THE TWO COLUMNS FROM DRIFTING. `fired` is the one
  // field of the alert state that has its own column and its own domain field
  // (Limit.thresholdsFired, docs/02-domain-model.md §3.5). An implementation
  // that parked the whole state in limit_alert_state_json would pass the
  // round-trip test above and leave Limit.thresholdsFired permanently empty.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });

  await setLimitAlertState(limit.id, STATE);

  expect((await getLimit(limit.id))?.thresholdsFired).toEqual([50, 80]);
  const row = await db.getFirstAsync<{ thresholds_fired_json: string }>(
    "SELECT thresholds_fired_json FROM limits WHERE id = ?",
    [limit.id],
  );
  expect(JSON.parse(row!.thresholds_fired_json)).toEqual([50, 80]);
});

test("a state with no thresholds fired is still a state, not an absence", async () => {
  // `thresholds_fired_json` defaults to '[]' and is NOT NULL, so emptiness
  // there cannot mean "never evaluated". Presence is keyed on
  // limit_alert_state_json alone — otherwise the first evaluation of a period
  // (which fires nothing) would look like no evaluation at all, and the
  // engine would re-snapshot `base` on every ledger commit.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });
  const noneFired: LimitAlertState = { ...STATE, fired: [] };

  await setLimitAlertState(limit.id, noneFired);

  expect(await getLimitAlertState(limit.id)).toEqual(noneFired);
  expect((await getLimit(limit.id))?.thresholdsFired).toEqual([]);
});

test("setting the state twice replaces it rather than merging", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });
  await setLimitAlertState(limit.id, STATE);

  const nextPeriod: LimitAlertState = {
    periodStart: new Date(2026, 8, 1).getTime(),
    base: 800000,
    carryover: 150000,
    fired: [],
    muted: true,
    lastSpend: 0,
  };
  await setLimitAlertState(limit.id, nextPeriod);

  // A period boundary resets `fired` (docs/02-domain-model.md §3.5). A merge
  // would carry [50, 80] into the new period and silence both thresholds.
  expect(await getLimitAlertState(limit.id)).toEqual(nextPeriod);
  expect((await getLimit(limit.id))?.thresholdsFired).toEqual([]);
});

test("setLimitAlertState throws LimitNotFoundError for an unknown id", async () => {
  await expect(setLimitAlertState("no-such-limit", STATE)).rejects.toThrow(LimitNotFoundError);
});

test("updating a limit does not disturb its alert state", async () => {
  // Limits spec rule 1: editing value/filters/rollover takes effect
  // immediately and thresholds are RE-EVALUATED — which needs `fired` and
  // `lastSpend` to still be there. An UPDATE that rewrote every column would
  // wipe them and re-arm every threshold the user has already been alerted for.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });
  await setLimitAlertState(limit.id, STATE);

  await updateLimit(limit.id, { value: 900000 });

  expect(await getLimitAlertState(limit.id)).toEqual(STATE);
});
