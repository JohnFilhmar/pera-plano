// lib/limits/__tests__/limit_service.test.ts — m2 Task 7.
//
// The integration test for the limits feature: engine + limits_repo +
// transactions_repo.sumSpend, against the REAL migrations through freshDb().
// Everything below is seeded with the actual 001_core.sql columns — the m2
// plan's own seed helper writes a `matchers` column into `wallets`, which does
// not exist (matchers are their own table).
//
// NOTHING IS MOCKED HERE, and that is the point of the m2 Task 8 split.
// `notifyLimitAlerts` moved to lib/limits/limit_notifier.ts (tested next door)
// because it was the only thing dragging expo-notifications and the
// `NotificationListener` native module into every consumer of this module —
// including the Plan tab, which only wanted a progress bar.
import { closeDatabase } from "@/lib/db/database";
import type { SQLiteDatabase } from "@/lib/db/database";
import {
  createLimit,
  getLimitAlertState,
  setLimitAlertState,
  updateLimit,
} from "@/lib/db/repos/limits_repo";
import { newId } from "@/lib/ids";
import { freshDb } from "@/test_support/db";

import {
  getLimitStatuses,
  muteLimitForPeriod,
  recomputeLimits,
  refreshLimitBase,
} from "../limit_service";

const ms = (y: number, m: number, d: number, hh = 12) => new Date(y, m, d, hh).getTime();

let db: SQLiteDatabase;

async function seedWallet(id: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at)
     VALUES (?, ?, 'e-wallet', 0, 'PHP', 0, 0, 0)`,
    [id, `wallet-${id}`],
  );
}

async function seedCategory(id: string, parentId: string | null): Promise<void> {
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, ?, ?, 'circle', 0, 0, 0, 0)`,
    [id, `cat-${id}`, parentId],
  );
}

async function seedTx(args: {
  walletId: string;
  categoryId: string;
  amount: number;
  direction?: "in" | "out";
  occurredAt: number;
}): Promise<string> {
  const id = newId();
  await db.runAsync(
    `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at,
       merchant, counterparty, reference_no, source, confidence, raw_notification_id,
       transfer_link_id, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'manual', 1, NULL, NULL, NULL, ?, ?)`,
    [
      id,
      args.walletId,
      args.categoryId,
      args.amount,
      args.direction ?? "out",
      args.occurredAt,
      args.occurredAt,
      args.occurredAt,
    ],
  );
  return id;
}

/**
 * A genuinely transfer-linked outgoing leg. `transactions.transfer_link_id` has
 * a real foreign key to `transfer_links`, whose own two columns point back at
 * transactions — so the rows have to be written in this order. The m2 plan's
 * seed sets `transfer_link_id: "tl-x"` directly, which the key rejects.
 */
async function seedTransferLinkedSpend(args: {
  walletId: string;
  categoryId: string;
  amount: number;
  occurredAt: number;
}): Promise<void> {
  const outId = await seedTx({ ...args, direction: "out" });
  const inId = await seedTx({ ...args, direction: "in" });
  const linkId = newId();
  await db.runAsync(
    `INSERT INTO transfer_links (id, out_transaction_id, in_transaction_id, fee_amount,
       status, detected_by, confidence, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'active', 'manual', 1, ?, ?)`,
    [linkId, outId, inId, args.occurredAt, args.occurredAt],
  );
  await db.runAsync("UPDATE transactions SET transfer_link_id = ? WHERE id IN (?, ?)", [
    linkId,
    outId,
    inId,
  ]);
}

beforeEach(async () => {
  db = await freshDb();
  jest.clearAllMocks();
  await seedWallet("w1");
  await seedCategory("food", null);
  await seedCategory("delivery", "food");
  await seedCategory("transport", null);
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Threshold firing through the whole stack
// ---------------------------------------------------------------------------
test("fires 50 once, stays silent at unchanged spend, then fires only 100 on a jump", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  const now = ms(2026, 7, 10);
  await seedTx({ walletId: "w1", categoryId: "food", amount: 500000, occurredAt: ms(2026, 7, 5) });

  expect(await recomputeLimits({ now, monthlyIncome: null })).toEqual([
    expect.objectContaining({ limitId: limit.id, threshold: 50 }),
  ]);

  // Same spend, recomputed again — rule 20, no re-fire.
  expect(await recomputeLimits({ now, monthlyIncome: null })).toEqual([]);

  await seedTx({ walletId: "w1", categoryId: "food", amount: 550000, occurredAt: ms(2026, 7, 9) });
  expect(await recomputeLimits({ now, monthlyIncome: null })).toEqual([
    expect.objectContaining({ threshold: 100 }),
  ]);

  // 80 was crossed by that same commit and correctly never fired (rule 21).
  expect((await getLimitAlertState(limit.id))?.fired).toEqual([50, 100]);
});

test("a recompute persists lastSpend, which is what makes the second call silent", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 500000, occurredAt: ms(2026, 7, 5) });

  await recomputeLimits({ now: ms(2026, 7, 10), monthlyIncome: null });

  expect((await getLimitAlertState(limit.id))?.lastSpend).toBe(500000);
});

// ---------------------------------------------------------------------------
// Filters — limits rules 2-4
// ---------------------------------------------------------------------------
test("counts descendants, excludes other categories, other wallets, and transfer legs", async () => {
  await seedWallet("w2");
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 1000000,
    categoryFilter: ["food"],
    walletFilter: ["w1"],
  });
  const now = ms(2026, 7, 10);

  await seedTx({ walletId: "w1", categoryId: "delivery", amount: 500000, occurredAt: ms(2026, 7, 3) }); // counts: descendant of food
  await seedTx({ walletId: "w1", categoryId: "transport", amount: 400000, occurredAt: ms(2026, 7, 3) }); // wrong category
  await seedTx({ walletId: "w2", categoryId: "food", amount: 400000, occurredAt: ms(2026, 7, 3) }); // wrong wallet
  await seedTransferLinkedSpend({
    walletId: "w1",
    categoryId: "food",
    amount: 400000,
    occurredAt: ms(2026, 7, 4),
  }); // right wallet, right category, but a transfer leg

  const status = (await getLimitStatuses({ now, monthlyIncome: null })).find(
    (s) => s.limit.id === limit.id,
  );

  expect(status?.spend).toBe(500000);
  expect(status?.uiState).toBe("caution");
});

test("spend outside the period window is not counted", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 900000, occurredAt: ms(2026, 6, 31) }); // July
  await seedTx({ walletId: "w1", categoryId: "food", amount: 100000, occurredAt: ms(2026, 7, 1) }); // August

  const status = (await getLimitStatuses({ now: ms(2026, 7, 10), monthlyIncome: null })).find(
    (s) => s.limit.id === limit.id,
  );

  expect(status?.spend).toBe(100000);
});

test("incoming money is never spend", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await seedTx({
    walletId: "w1",
    categoryId: "food",
    amount: 900000,
    direction: "in",
    occurredAt: ms(2026, 7, 5),
  });

  expect(await recomputeLimits({ now: ms(2026, 7, 10), monthlyIncome: null })).toEqual([]);
});

// ---------------------------------------------------------------------------
// Paused — income unknown (rule 12)
// ---------------------------------------------------------------------------
test("a percent-of-income limit with unknown income is paused: no counting, no alerts", async () => {
  // 20%, in the domain's percent x 100 encoding.
  await createLimit({ scope: "monthly", basis: "percent-of-income", value: 2000 });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 900000, occurredAt: ms(2026, 7, 5) });

  expect(await recomputeLimits({ now: ms(2026, 7, 10), monthlyIncome: null })).toEqual([]);

  const [status] = await getLimitStatuses({ now: ms(2026, 7, 10), monthlyIncome: null });
  expect(status.uiState).toBe("paused");
  expect(status.paused).toBe(true);
  expect(status.effectiveLimit).toBeNull();
});

test("a percent-of-income limit with known income counts normally", async () => {
  // 20% of ₱37,000.00 = ₱7,400.00. If `value` were read as whole percent this
  // base would be ₱74.00 and a ₱4,000 spend would read as 5,400% used.
  await createLimit({ scope: "monthly", basis: "percent-of-income", value: 2000 });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 400000, occurredAt: ms(2026, 7, 5) });

  const [status] = await getLimitStatuses({ now: ms(2026, 7, 10), monthlyIncome: 3700000 });

  expect(status.base).toBe(740000);
  expect(status.effectiveLimit).toBe(740000);
  expect(status.uiState).toBe("caution"); // 4,000 / 7,400 = 54%
});

// ---------------------------------------------------------------------------
// Period boundaries and rollover — rules 14-18
// ---------------------------------------------------------------------------
test("rolls the period: carryover clamps, thresholds reset, base re-snapshots", async () => {
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 800000,
    rollover: true,
  });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 500000, occurredAt: ms(2026, 6, 20) });

  await recomputeLimits({ now: ms(2026, 6, 25), monthlyIncome: null }); // July: fires 50
  expect(await recomputeLimits({ now: ms(2026, 7, 2), monthlyIncome: null })).toEqual([]); // August

  const state = await getLimitAlertState(limit.id);
  expect(state?.periodStart).toBe(new Date(2026, 7, 1).getTime());
  expect(state?.carryover).toBe(300000); // ₱8,000 base - ₱5,000 spent
  expect(state?.fired).toEqual([]);

  const [status] = await getLimitStatuses({ now: ms(2026, 7, 2), monthlyIncome: null });
  expect(status.effectiveLimit).toBe(1100000);
});

test("A NEW LIMIT DOES NOT RETROACTIVELY RECEIVE CARRYOVER (rule 18)", async () => {
  // Rule 18: "Rollover applies starting with the FIRST PERIOD BOUNDARY after the
  // toggle is switched on; the period in which it was enabled contributes its
  // headroom forward but DOES NOT RETROACTIVELY RECEIVE ANY."
  //
  // The m2 plan's `ensureState` falls back to `prevBase = base` whenever no
  // prior state exists, then sums the previous window's spend — so a limit
  // created today, with a quiet previous month behind it, opens with a full
  // extra base of headroom it was never entitled to. Here: ₱8,000 limit created
  // in August, ₱1,000 spent in July, so the plan grants ₱7,000 of carryover and
  // an effective limit of ₱15,000.
  await seedTx({ walletId: "w1", categoryId: "food", amount: 100000, occurredAt: ms(2026, 6, 20) });
  await createLimit({ scope: "monthly", basis: "fixed", value: 800000, rollover: true });

  await recomputeLimits({ now: ms(2026, 7, 2), monthlyIncome: null });

  const [status] = await getLimitStatuses({ now: ms(2026, 7, 2), monthlyIncome: null });
  expect(status.carryover).toBe(0);
  expect(status.effectiveLimit).toBe(800000);
});

test("carryover only comes from a period that was actually tracked", async () => {
  // Same honesty rule, one step further out: state exists but is two periods
  // stale (the app was not opened for a month), so there is no base snapshot
  // for the immediately preceding period to compute headroom against.
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 800000,
    rollover: true,
  });
  await recomputeLimits({ now: ms(2026, 5, 10), monthlyIncome: null }); // June
  await seedTx({ walletId: "w1", categoryId: "food", amount: 100000, occurredAt: ms(2026, 6, 20) });

  await recomputeLimits({ now: ms(2026, 7, 2), monthlyIncome: null }); // straight to August

  expect((await getLimitAlertState(limit.id))?.carryover).toBe(0);
});

test("turning rollover OFF removes the current period's carryover immediately (rule 18)", async () => {
  // Rule 18's second sentence: "Turning rollover off IMMEDIATELY removes the
  // current period's carryover from the effective limit." The stored state
  // still holds the carryover the boundary computed, so the effective limit has
  // to read the CURRENT toggle rather than trust the snapshot.
  const limit = await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 800000,
    rollover: true,
  });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 500000, occurredAt: ms(2026, 6, 20) });
  await recomputeLimits({ now: ms(2026, 6, 25), monthlyIncome: null });
  await recomputeLimits({ now: ms(2026, 7, 2), monthlyIncome: null });

  expect(
    (await getLimitStatuses({ now: ms(2026, 7, 2), monthlyIncome: null }))[0].effectiveLimit,
  ).toBe(1100000);

  await updateLimit(limit.id, { rollover: false });

  const [status] = await getLimitStatuses({ now: ms(2026, 7, 2), monthlyIncome: null });
  expect(status.carryover).toBe(0);
  expect(status.effectiveLimit).toBe(800000);
});

// ---------------------------------------------------------------------------
// getLimitStatuses is a READ
// ---------------------------------------------------------------------------
test("getLimitStatuses NEVER WRITES — a render cannot roll a period", async () => {
  // The m2 plan routes `getLimitStatuses` through the same `ensureState` that
  // recompute uses, so simply looking at the Plan tab persists a period roll,
  // resets `fired`, and zeroes `lastSpend`. A screen must not decide when a
  // boundary was crossed, and two concurrent React Query renders must not both
  // write it.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 500000, occurredAt: ms(2026, 7, 5) });

  const [status] = await getLimitStatuses({ now: ms(2026, 7, 10), monthlyIncome: null });

  // The figures are still right...
  expect(status.spend).toBe(500000);
  expect(status.effectiveLimit).toBe(800000);
  // ...and nothing was persisted.
  expect(await getLimitAlertState(limit.id)).toBeNull();
});

test("getLimitStatuses does not disturb an existing state", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 500000, occurredAt: ms(2026, 7, 5) });
  await recomputeLimits({ now: ms(2026, 7, 10), monthlyIncome: null });
  const before = await getLimitAlertState(limit.id);

  await getLimitStatuses({ now: ms(2026, 7, 10), monthlyIncome: null });

  expect(await getLimitAlertState(limit.id)).toEqual(before);
});

// ---------------------------------------------------------------------------
// uiState — the spec's UX states table
// ---------------------------------------------------------------------------
test.each([
  [0, "on_track"],
  [499999, "on_track"],
  [500000, "caution"],
  [799999, "caution"],
  [800000, "warning"],
  [999999, "warning"],
  [1000000, "over"],
  [1200000, "over"],
] as const)("spend %i of ₱10,000 is %s", async (amount, expected) => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  if (amount > 0) {
    await seedTx({ walletId: "w1", categoryId: "food", amount, occurredAt: ms(2026, 7, 5) });
  }

  const [status] = await getLimitStatuses({ now: ms(2026, 7, 10), monthlyIncome: null });

  expect(status.uiState).toBe(expected);
});

test("an inactive limit is reported as inactive, not measured", async () => {
  // The spec's UX states table has an "Inactive (gated)" row — "Card kept, shown
  // dimmed with an 'inactive' tag and an activate/swap action". The m2 plan's
  // LimitStatus union omits it and would render a gated limit as if it were
  // live.
  await createLimit({ scope: "monthly", basis: "fixed", value: 100000, isActive: false });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 900000, occurredAt: ms(2026, 7, 5) });

  const [status] = await getLimitStatuses({ now: ms(2026, 7, 10), monthlyIncome: null });

  expect(status.uiState).toBe("inactive");
});

test("inactive limits are skipped by recompute entirely", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 100000, isActive: false });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 900000, occurredAt: ms(2026, 7, 5) });

  expect(await recomputeLimits({ now: ms(2026, 7, 10), monthlyIncome: null })).toEqual([]);
});

// ---------------------------------------------------------------------------
// Mute — rule 25
// ---------------------------------------------------------------------------
test("mute suppresses the returned alert but still records the fired threshold", async () => {
  // Rule 25: "muting affects notifications only" (rule 30). The threshold must
  // still be recorded, or it re-arms and fires the moment the mute expires.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await recomputeLimits({ now: ms(2026, 7, 1), monthlyIncome: null });
  await muteLimitForPeriod(limit.id, ms(2026, 7, 1), null);
  await seedTx({ walletId: "w1", categoryId: "food", amount: 600000, occurredAt: ms(2026, 7, 2) });

  expect(await recomputeLimits({ now: ms(2026, 7, 2), monthlyIncome: null })).toEqual([]);
  expect((await getLimitAlertState(limit.id))?.fired).toEqual([50]);
});

test("a mute expires at the period boundary", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await recomputeLimits({ now: ms(2026, 6, 1), monthlyIncome: null });
  await muteLimitForPeriod(limit.id, ms(2026, 6, 1), null);

  await recomputeLimits({ now: ms(2026, 7, 1), monthlyIncome: null });

  expect((await getLimitAlertState(limit.id))?.muted).toBe(false);
});

test("MUTING A LIMIT NEVER CORRUPTS ITS BASE", async () => {
  // The m2 plan's `muteLimitForPeriod` fabricates `base: limit.value` when no
  // state exists. For percent-of-income, `value` is percent x 100 — so muting a
  // 20% limit before its first recompute writes a base of 2000 centavos (₱20).
  // Worse, that state carries the CURRENT periodStart, so the next recompute
  // accepts it as this period's snapshot and the limit is ₱20 for the rest of
  // the month, silently.
  const limit = await createLimit({ scope: "monthly", basis: "percent-of-income", value: 2000 });

  await muteLimitForPeriod(limit.id, ms(2026, 7, 1), 3700000);

  const state = await getLimitAlertState(limit.id);
  expect(state?.muted).toBe(true);
  expect(state?.base).toBe(740000); // 20% of ₱37,000.00, not ₱20.00
});

test("muting a paused limit is a no-op, not a fabricated state", async () => {
  // A paused limit does not alert, so there is nothing to mute — and inventing
  // a base for it is exactly what the previous test forbids.
  const limit = await createLimit({ scope: "monthly", basis: "percent-of-income", value: 2000 });

  await muteLimitForPeriod(limit.id, ms(2026, 7, 1), null);

  expect(await getLimitAlertState(limit.id)).toBeNull();
});

test("muting an unknown limit does not throw", async () => {
  await expect(muteLimitForPeriod("no-such-limit", ms(2026, 7, 1), null)).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// refreshLimitBase — rule 11's immediate-recompute exception
// ---------------------------------------------------------------------------
test("refreshLimitBase re-snapshots the base immediately after a manual edit", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 800000 });
  await recomputeLimits({ now: ms(2026, 7, 2), monthlyIncome: null });
  await updateLimit(limit.id, { value: 1200000 });

  await refreshLimitBase(limit.id, ms(2026, 7, 2), null);

  expect((await getLimitAlertState(limit.id))?.base).toBe(1200000);
});

test("refreshLimitBase PRESERVES fired thresholds — raising a limit must not re-arm", async () => {
  // Rule 20: raising the effective limit updates the visual state, "but a later
  // crossing in the same period does not re-notify".
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 500000, occurredAt: ms(2026, 7, 2) });
  await recomputeLimits({ now: ms(2026, 7, 3), monthlyIncome: null }); // fires 50

  await updateLimit(limit.id, { value: 2000000 });
  await refreshLimitBase(limit.id, ms(2026, 7, 3), null);

  expect((await getLimitAlertState(limit.id))?.fired).toEqual([50]);
});

test("refreshLimitBase on a STALE period rolls it rather than adopting the old figures", async () => {
  // The plan overwrites `periodStart` while spreading the rest of the old
  // state, so July's `fired`, `carryover` and `lastSpend` silently become
  // August's — every threshold already fired stays fired into a period that
  // never fired them.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 500000, occurredAt: ms(2026, 6, 2) });
  await recomputeLimits({ now: ms(2026, 6, 3), monthlyIncome: null }); // July: fires 50

  await refreshLimitBase(limit.id, ms(2026, 7, 2), null); // now it is August

  const state = await getLimitAlertState(limit.id);
  expect(state?.periodStart).toBe(new Date(2026, 7, 1).getTime());
  expect(state?.fired).toEqual([]);
  expect(state?.lastSpend).toBe(0);
});

test("refreshLimitBase on an unknown or paused limit does not throw", async () => {
  const paused = await createLimit({ scope: "monthly", basis: "percent-of-income", value: 2000 });

  await expect(refreshLimitBase("no-such-limit", ms(2026, 7, 2), null)).resolves.toBeUndefined();
  await expect(refreshLimitBase(paused.id, ms(2026, 7, 2), null)).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// Several limits at once — rule 27
// ---------------------------------------------------------------------------
test("one commit can trip several limits, and they come back most-severe first", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 }); // 85% used -> 80
  await createLimit({ scope: "daily", basis: "fixed", value: 800000 }); // 106% used -> 100
  await seedTx({ walletId: "w1", categoryId: "food", amount: 850000, occurredAt: ms(2026, 7, 10) });

  const alerts = await recomputeLimits({ now: ms(2026, 7, 10), monthlyIncome: null });

  expect(alerts.map((a) => a.threshold)).toEqual([100, 80]);
});

test("a state written by an earlier version is respected, not overwritten", async () => {
  // setLimitAlertState is the seam the service shares with anything else that
  // touches the state; a recompute inside the same period must build on it.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1000000 });
  await setLimitAlertState(limit.id, {
    periodStart: new Date(2026, 7, 1).getTime(),
    base: 1000000,
    carryover: 0,
    fired: [50, 80],
    muted: false,
    lastSpend: 850000,
  });
  await seedTx({ walletId: "w1", categoryId: "food", amount: 900000, occurredAt: ms(2026, 7, 5) });

  const alerts = await recomputeLimits({ now: ms(2026, 7, 10), monthlyIncome: null });

  // 90% — above 80 (already fired) and below 100. Nothing new.
  expect(alerts).toEqual([]);
  expect((await getLimitAlertState(limit.id))?.fired).toEqual([50, 80]);
});
