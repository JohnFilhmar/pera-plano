// lib/db/repos/__tests__/balance_adjustment.test.ts — regression suite for the
// owner's 2026-08-30 device report, "wallet adjust balance counts as expense".
//
// WHAT WENT WRONG. `useCorrectWalletBalance` and `useReconcileCash` both commit
// an ordinary manual Transaction for the DIFFERENCE between the recorded
// balance and the figure the user typed. That row is the right way to move the
// balance — the ledger explains every move — but the schema had exactly one way
// to say "this row is not spending or income", `transfer_link_id IS NOT NULL`,
// and an adjustment carried none. So typing "this wallet really holds ₱4,377"
// into a wallet the ledger thought held ₱9,342 wrote a −₱4,964.60 row that
// `sumSpend` counted, which blew a ₱266 daily limit to ₱4,998 spent and pinned
// Safe-to-Spend at ₱0.00.
//
// Reconciling a balance is not a purchase. These tests pin that at the two
// choke points every spend figure in the app funnels through (`sumSpend`,
// `dailySpend`) and on the marker itself surviving a round trip.
import { closeDatabase, getDatabase, unlockDatabase } from "@/lib/db/database";
import { atLocalTime, toDateIso } from "@/lib/dates";
import { __setTierForTests } from "@/lib/entitlements";
import { MIGRATIONS, runMigrations } from "@/lib/db/migrations";
import { freshDb, TEST_DEK } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";
import type { NewTransaction } from "@/types/domain";

import { createWallet } from "../wallets_repo";
import {
  dailySpend,
  getTransaction,
  insertTransaction,
  listTransactions,
  sumSpend,
} from "../transactions_repo";

const CATEGORY_ID = "cat_uncategorized";
const DAY = "2026-08-30";

let db: SQLiteDatabase;
let walletId: string;

async function seedCategory(id: string, name: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES (?, ?, NULL, 'circle-help', 1, 0, 0, 0)`,
    [id, name],
  );
}

beforeEach(async () => {
  db = await freshDb();
  await seedCategory(CATEGORY_ID, "Uncategorized");
  walletId = (await createWallet({ name: "SeaBank", openingBalance: 0 })).id;
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

/**
 * `atLocalTime` rather than a UTC literal, for the reason
 * `daily_spend.test.ts` documents on its own helper: `dailySpend` groups by the
 * DEVICE's calendar day, so a UTC string would land on the wrong day on any
 * machine west of the Philippines and the assertions would pass or fail by
 * timezone.
 */
function makeTx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    walletId,
    categoryId: CATEGORY_ID,
    amount: 50000,
    direction: "out",
    occurredAt: atLocalTime(DAY, 9, 0),
    source: "manual",
    confidence: 1,
    ...overrides,
  };
}

test("an outflow adjustment is not counted by sumSpend", async () => {
  await insertTransaction(makeTx({ amount: 66261 }));
  await insertTransaction(makeTx({ amount: 496460, isAdjustment: true }));

  const spend = await sumSpend({
    from: atLocalTime(DAY, 0, 0),
    to: atLocalTime(DAY, 23, 59),
  });

  expect(spend).toBe(66261);
});

test("an outflow adjustment is not counted by dailySpend", async () => {
  await insertTransaction(makeTx({ amount: 66261 }));
  await insertTransaction(makeTx({ amount: 496460, isAdjustment: true }));

  const series = await dailySpend({ days: 7, endingOn: DAY });

  expect(series[series.length - 1]).toBe(66261);
});

test("an inflow adjustment is not counted as spending either, and still moves the balance", async () => {
  const before = await insertTransaction(
    makeTx({ amount: 499500, direction: "in", isAdjustment: true }),
  );

  expect(before.isAdjustment).toBe(true);

  const wallet = await db.getFirstAsync<{ balance: number }>(
    "SELECT balance FROM wallets WHERE id = ?",
    [walletId],
  );
  // The whole point of writing a row rather than patching `wallets.balance`:
  // the adjustment still moves the wallet, it just does not move the report.
  expect(wallet?.balance).toBe(499500);

  const spend = await sumSpend({
    from: atLocalTime(DAY, 0, 0),
    to: atLocalTime(DAY, 23, 59),
  });
  expect(spend).toBe(0);
});

test("the marker round-trips through the row mapper", async () => {
  const adjustment = await insertTransaction(makeTx({ isAdjustment: true }));
  const ordinary = await insertTransaction(makeTx());

  expect((await getTransaction(adjustment.id))?.isAdjustment).toBe(true);
  expect((await getTransaction(ordinary.id))?.isAdjustment).toBe(false);
});

test("listTransactions still returns adjustments — they are ledger history, not hidden rows", async () => {
  await insertTransaction(makeTx({ isAdjustment: true }));
  const rows = await listTransactions({ walletId });
  expect(rows).toHaveLength(1);
  expect(rows[0].isAdjustment).toBe(true);
});

test("excludeAdjustments drops them for callers that are asking about real activity", async () => {
  await insertTransaction(makeTx({ isAdjustment: true }));
  await insertTransaction(makeTx({ amount: 66261 }));

  const rows = await listTransactions({ walletId, excludeAdjustments: true });

  expect(rows).toHaveLength(1);
  expect(rows[0].amount).toBe(66261);
});

test("dailySpend groups the surviving row on the device's own calendar day", async () => {
  await insertTransaction(makeTx({ amount: 66261, occurredAt: atLocalTime(DAY, 23, 40) }));
  const series = await dailySpend({ days: 7, endingOn: toDateIso(new Date(atLocalTime(DAY, 12, 0))) });
  expect(series[series.length - 1]).toBe(66261);
});

// ---------------------------------------------------------------------------
// The backfill.
//
// The devices that hit this bug already hold the rows that caused it — the
// reporting device holds the −₱4,964.60 one. A fix that only marked FUTURE
// adjustments would leave those users with a permanently wrong spend history,
// so 017 keys the existing rows off the two note constants that wrote them.
// These tests run the schema to 016, plant the rows a shipped app would have
// left, then apply 017 alone.
// ---------------------------------------------------------------------------

describe("017 backfills adjustments already on the device", () => {
  const UP_TO_016 = MIGRATIONS.filter((migration) => migration.version <= 16);
  const ONLY_017 = MIGRATIONS.filter((migration) => migration.version === 17);

  /**
   * `occurredAt` defaults to a moment inside every tier's history window
   * rather than to epoch 0. `sumSpend` clamps its `from` to `historyFloor()`,
   * so a row planted in 1970 would be filtered out by the FLOOR and a spend
   * assertion over it would pass whether or not the backfill worked.
   */
  const RECENT = atLocalTime(DAY, 9, 0);

  async function plantLegacyRow(
    legacyDb: SQLiteDatabase,
    id: string,
    note: string | null,
    amount = 496460,
  ): Promise<void> {
    await legacyDb.runAsync(
      `INSERT INTO transactions
         (id, wallet_id, category_id, amount, direction, occurred_at, merchant,
          counterparty, reference_no, source, confidence, raw_notification_id,
          transfer_link_id, note, created_at, updated_at)
       VALUES (?, 'w1', 'c1', ?, 'out', ?, NULL, NULL, NULL, 'manual', 1, NULL, NULL, ?, 0, 0)`,
      [id, amount, RECENT, note],
    );
  }

  test("marks the rows the two reconciliation hooks wrote, and only those", async () => {
    await closeDatabase();
    await unlockDatabase(TEST_DEK);
    const legacyDb = await getDatabase();
    await runMigrations(legacyDb, UP_TO_016);

    await legacyDb.runAsync(
      "INSERT INTO wallets (id, name, balance, currency, is_archived, created_at, updated_at) VALUES ('w1','SeaBank',0,'PHP',0,0,0)",
    );
    await legacyDb.runAsync(
      "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES ('c1','Uncategorized',NULL,'circle-help',1,0,0,0)",
    );

    await plantLegacyRow(legacyDb, "t_correction", "Starting balance / manual correction");
    await plantLegacyRow(legacyDb, "t_cash", "Cash reconciliation");
    await plantLegacyRow(legacyDb, "t_groceries", "Weekly groceries");
    await plantLegacyRow(legacyDb, "t_plain", null);

    expect(await runMigrations(legacyDb, ONLY_017)).toEqual([17]);

    const rows = await legacyDb.getAllAsync<{ id: string; is_adjustment: number }>(
      "SELECT id, is_adjustment FROM transactions ORDER BY id",
    );
    expect(rows).toEqual([
      { id: "t_cash", is_adjustment: 1 },
      { id: "t_correction", is_adjustment: 1 },
      { id: "t_groceries", is_adjustment: 0 },
      { id: "t_plain", is_adjustment: 0 },
    ]);
  });

  test("the backfilled rows stop counting as spend", async () => {
    await closeDatabase();
    await unlockDatabase(TEST_DEK);
    const legacyDb = await getDatabase();
    await runMigrations(legacyDb, UP_TO_016);

    await legacyDb.runAsync(
      "INSERT INTO wallets (id, name, balance, currency, is_archived, created_at, updated_at) VALUES ('w1','SeaBank',0,'PHP',0,0,0)",
    );
    await legacyDb.runAsync(
      "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES ('c1','Uncategorized',NULL,'circle-help',1,0,0,0)",
    );
    await plantLegacyRow(legacyDb, "t_correction", "Starting balance / manual correction");
    await plantLegacyRow(legacyDb, "t_groceries", "Weekly groceries", 66261);

    // NOT asserted before the migration: `sumSpend` is the CURRENT code, and
    // its predicate now names `is_adjustment`, so calling it against a
    // 016-shaped schema raises "no such column" rather than reproducing the
    // old total. What is under test is the state 017 leaves behind — the
    // correction planted here is the shape of the one on the reporting device,
    // and after the migration only the groceries row counts.
    await runMigrations(legacyDb, ONLY_017);

    expect(
      await sumSpend({ from: atLocalTime(DAY, 0, 0), to: atLocalTime(DAY, 23, 59) }),
    ).toBe(66261);
  });
});
