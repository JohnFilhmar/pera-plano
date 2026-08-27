// lib/db/repos/__tests__/daily_spend.test.ts — mobile-ui-revamp Part 2 Task 1.
//
// `dailySpend` feeds the Home hero's seven-bar strip. Bootstrap copied
// verbatim from transactions_repo.test.ts (freshDb/closeDatabase, the wallet
// and category setup) rather than re-invented here.
import { closeDatabase } from "@/lib/db/database";
import { atLocalTime } from "@/lib/dates";
import { __setTierForTests } from "@/lib/entitlements";
import { createWallet } from "../wallets_repo";
import { dailySpend, insertTransaction } from "../transactions_repo";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "@/lib/db/database";
import type { NewTransaction, Transaction } from "@/types/domain";

const CATEGORY_ID = "cat_food";

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
  await seedCategory(CATEGORY_ID, "Food & Dining");
  walletId = (await createWallet({ name: "GCash", openingBalance: 100000 })).id;
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Fixture helpers, built from NewTransaction's real shape (types/domain.ts)
// rather than the brief's sketch: `occurredAt` is `EpochMs` (a number), not an
// ISO string, so every helper here takes a local calendar date + time of day
// and converts through lib/dates.ts's `atLocalTime` — the same "unambiguous
// regardless of the machine's timezone" technique lib/reports/__tests__/
// aggregate.test.ts documents on its own `at()` helper, and for the same
// reason: a UTC string literal would silently land on the wrong local day on
// a machine west of the Philippines.
// ---------------------------------------------------------------------------

type SpendFixture = { amount: number; date: string; hour?: number; minute?: number };

function occurredAtFor(date: string, hour = 9, minute = 0): number {
  return atLocalTime(date, hour, minute);
}

function makeOutflow({ amount, date, hour, minute }: SpendFixture): NewTransaction {
  return {
    walletId,
    categoryId: CATEGORY_ID,
    amount,
    direction: "out",
    occurredAt: occurredAtFor(date, hour, minute),
    source: "manual",
    confidence: 1,
  };
}

function makeInflow({ amount, date, hour, minute }: SpendFixture): NewTransaction {
  return {
    walletId,
    categoryId: CATEGORY_ID,
    amount,
    direction: "in",
    occurredAt: occurredAtFor(date, hour, minute),
    source: "manual",
    confidence: 1,
  };
}

/**
 * Inserts a linked transfer-out leg and returns it — the row `dailySpend` must
 * exclude under invariant I2.
 *
 * NOT a plain NewTransaction factory like `makeOutflow`/`makeInflow` above,
 * unlike the brief's sketch (`insertTransaction(makeTransferOut(...))`).
 * `transactions.transfer_link_id` is a foreign key onto `transfer_links(id)`
 * (001_core.sql), and `transfer_links` itself has NOT NULL foreign keys onto
 * BOTH transaction legs — so a linked leg cannot exist as a single insert the
 * way an ordinary outflow can. This mirrors transactions_repo.test.ts's own
 * `linkAsTransfer` helper: insert both legs first, then the link row, then
 * stamp `transfer_link_id` onto both.
 */
async function makeTransferOut({ amount, date, hour, minute }: SpendFixture): Promise<Transaction> {
  const occurredAt = occurredAtFor(date, hour, minute);
  const out = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount,
    direction: "out",
    occurredAt,
    source: "manual",
    confidence: 1,
  });
  const inLeg = await insertTransaction({
    walletId,
    categoryId: CATEGORY_ID,
    amount,
    direction: "in",
    occurredAt,
    source: "manual",
    confidence: 1,
  });
  const now = Date.now();
  const linkId = `tl_${out.id}`;
  await db.runAsync(
    `INSERT INTO transfer_links (id, out_transaction_id, in_transaction_id, fee_amount, status, detected_by, confidence, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'active', 'manual', 1.0, ?, ?)`,
    [linkId, out.id, inLeg.id, now, now],
  );
  await db.runAsync("UPDATE transactions SET transfer_link_id = ? WHERE id IN (?, ?)", [
    linkId,
    out.id,
    inLeg.id,
  ]);
  return out;
}

// ---------------------------------------------------------------------------

test("returns exactly `days` buckets even when the ledger is empty", async () => {
  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series).toHaveLength(7);
  expect(series.every((value) => value === 0)).toBe(true);
});

test("buckets are oldest first", async () => {
  await insertTransaction(makeOutflow({ amount: 10000, date: "2026-08-16" }));
  await insertTransaction(makeOutflow({ amount: 50000, date: "2026-08-22" }));

  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series[0]).toBe(10000);
  expect(series[6]).toBe(50000);
});

test("a day with several transactions sums them", async () => {
  await insertTransaction(makeOutflow({ amount: 10000, date: "2026-08-22", hour: 9 }));
  await insertTransaction(makeOutflow({ amount: 2500, date: "2026-08-22", hour: 18 }));

  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series[6]).toBe(12500);
});

test("inflows are not spending and never appear in the series", async () => {
  await insertTransaction(makeInflow({ amount: 925000, date: "2026-08-22" }));

  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series[6]).toBe(0);
});

test("transfers between the user's own wallets are not spending", async () => {
  await makeTransferOut({ amount: 200000, date: "2026-08-22" });

  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series[6]).toBe(0);
});

test("anything older than the window is excluded", async () => {
  await insertTransaction(makeOutflow({ amount: 99900, date: "2026-07-01" }));

  const series = await dailySpend({ days: 7, endingOn: "2026-08-22" });
  expect(series.every((value) => value === 0)).toBe(true);
});
