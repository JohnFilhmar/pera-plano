import { closeDatabase, getDatabase, unlockDatabase } from "../database";
import { MIGRATIONS, runMigrations, type Migration } from "../migrations";
import { TEST_DEK } from "@/test_support/db";

const TEST_MIGRATIONS: Migration[] = [
  { version: 1, name: "one", sql: "CREATE TABLE t_one (id TEXT PRIMARY KEY);" },
  { version: 2, name: "two", sql: "CREATE TABLE t_two (id TEXT PRIMARY KEY);" },
];

// This suite calls getDatabase() directly (not freshDb()) because it is testing
// migrations.ts/database.ts themselves, not repository behavior — but getDatabase() still
// requires an unlock first as of Task 7 (interface contract §3's DatabaseLockedError gate).
beforeEach(async () => {
  await unlockDatabase(TEST_DEK);
});

afterEach(async () => {
  await closeDatabase();
});

test("applies pending migrations in version order and records them", async () => {
  const db = await getDatabase();
  const applied = await runMigrations(db, TEST_MIGRATIONS);
  expect(applied).toEqual([1, 2]);
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  expect(tables.map((t) => t.name)).toEqual(
    expect.arrayContaining(["schema_migrations", "t_one", "t_two"]),
  );
  const recorded = await db.getAllAsync<{ version: number; name: string }>(
    "SELECT version, name FROM schema_migrations ORDER BY version",
  );
  expect(recorded).toEqual([
    { version: 1, name: "one" },
    { version: 2, name: "two" },
  ]);
});

test("is idempotent — a second run applies nothing", async () => {
  const db = await getDatabase();
  await runMigrations(db, TEST_MIGRATIONS);
  const second = await runMigrations(db, TEST_MIGRATIONS);
  expect(second).toEqual([]);
});

test("applies only migrations newer than the recorded ones", async () => {
  const db = await getDatabase();
  await runMigrations(db, [TEST_MIGRATIONS[0]]);
  const applied = await runMigrations(db, TEST_MIGRATIONS);
  expect(applied).toEqual([2]);
});

test("a failing migration rolls back and records nothing for it", async () => {
  const db = await getDatabase();
  const bad: Migration[] = [
    { version: 1, name: "bad", sql: "CREATE TABLE broken (id TEXT PRIMARY KEY); INSERT INTO nonexistent VALUES (1);" },
  ];
  await expect(runMigrations(db, bad)).rejects.toThrow();
  const recorded = await db.getAllAsync<{ version: number }>(
    "SELECT version FROM schema_migrations",
  );
  expect(recorded).toEqual([]);
});

test("getDatabase turns PRAGMA foreign_keys ON and is a singleton", async () => {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ foreign_keys: number }>("PRAGMA foreign_keys");
  expect(row?.foreign_keys).toBe(1);
  expect(await getDatabase()).toBe(db);
});

test("applies migrations in ascending numeric order, not lexicographic order", async () => {
  const db = await getDatabase();
  // Deliberately unsorted input, and version 10 spans the digit boundary against 1 and 2:
  // a lexicographic ("10" < "2") comparator would apply 10 before 2.
  const outOfOrder: Migration[] = [
    { version: 10, name: "ten", sql: "CREATE TABLE t_ten (id TEXT PRIMARY KEY);" },
    { version: 1, name: "one", sql: "CREATE TABLE t_one (id TEXT PRIMARY KEY);" },
    { version: 2, name: "two", sql: "CREATE TABLE t_two (id TEXT PRIMARY KEY);" },
  ];
  const applied = await runMigrations(db, outOfOrder);
  expect(applied).toEqual([1, 2, 10]);
});

test("a migration whose version-insert fails rolls back its own DDL, not just prior state", async () => {
  const db = await getDatabase();
  // Two migrations sharing one version number: the first's INSERT into
  // schema_migrations succeeds and commits; the second's CREATE TABLE succeeds but its
  // INSERT then collides with the first's PRIMARY KEY row. If the insert were not part of
  // the same transaction as the migration body, second_table would survive that failure —
  // a schema change applied without ever being recorded.
  const clashing: Migration[] = [
    { version: 5, name: "first", sql: "CREATE TABLE first_table (id TEXT PRIMARY KEY);" },
    { version: 5, name: "second", sql: "CREATE TABLE second_table (id TEXT PRIMARY KEY);" },
  ];
  await expect(runMigrations(db, clashing)).rejects.toThrow();

  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  expect(tables.map((t) => t.name)).toContain("first_table");
  expect(tables.map((t) => t.name)).not.toContain("second_table");

  const recorded = await db.getAllAsync<{ version: number; name: string }>(
    "SELECT version, name FROM schema_migrations WHERE version = 5",
  );
  expect(recorded).toEqual([{ version: 5, name: "first" }]);
});

// ---------------------------------------------------------------------------
// m1c Task 3b — 002_balance_after, the FIRST migration to land after 001 shipped.
//
// Everything above this line proves the runner works on synthetic migrations
// and on a database it created itself. What none of it proves is the thing that
// makes 002 a MIGRATION rather than a schema edit: that a database already
// carrying a user's real rows at version 1 can be upgraded IN PLACE without
// losing them. A `freshDb()` test cannot tell those apart — it applies 001 and
// 002 back to back on an empty file, and would stay green against a "migration"
// that dropped and recreated `transactions`.
// ---------------------------------------------------------------------------

const V1_TIMESTAMP = 1_700_000_000_000;

/** Writes the rows a version-1 device would already be holding. */
async function seedVersionOneRows(db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> {
  await db.runAsync(
    `INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at)
     VALUES ('w_v1', 'GCash', 'e-wallet', 250000, 'PHP', 0, ?, ?)`,
    [V1_TIMESTAMP, V1_TIMESTAMP],
  );
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES ('c_v1', 'Food & Dining', NULL, 'utensils', 1, 0, ?, ?)`,
    [V1_TIMESTAMP, V1_TIMESTAMP],
  );
  await db.runAsync(
    `INSERT INTO transactions
       (id, wallet_id, category_id, amount, direction, occurred_at, merchant, counterparty,
        reference_no, source, confidence, raw_notification_id, transfer_link_id, note,
        created_at, updated_at)
     VALUES ('tx_v1', 'w_v1', 'c_v1', 15000, 'out', ?, 'Jollibee', NULL, 'REF-V1',
             'notification', 0.94, NULL, NULL, 'lunch', ?, ?)`,
    [V1_TIMESTAMP, V1_TIMESTAMP, V1_TIMESTAMP],
  );
}

describe("002_balance_after upgrades a real version-1 database in place", () => {
  test("a database created at 001, already holding rows, gains balance_after and keeps every row and value", async () => {
    const db = await getDatabase();

    // Stop at 001 — exactly what a device that installed the shipped v1 build has.
    const [core] = MIGRATIONS;
    expect(core.version).toBe(1);
    expect(await runMigrations(db, [core])).toEqual([1]);

    await seedVersionOneRows(db);

    // The column must be genuinely ABSENT first. Without this the assertion
    // below ("it is there afterwards") would also pass on a database that was
    // never at 001 in the first place, proving nothing about upgrading.
    const columnsBefore = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transactions)");
    expect(columnsBefore.map((c) => c.name)).not.toContain("balance_after");

    // Now the real registry, on the real existing database.
    const applied = await runMigrations(db);
    // ONLY 002. A `[1, 2]` here would mean 001 was replayed over live data.
    expect(applied).toEqual([2]);

    const columnsAfter = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transactions)");
    expect(columnsAfter.map((c) => c.name)).toContain("balance_after");

    // Every pre-existing value survived, field by field — a drop-and-recreate
    // (or a rebuild-through-a-temp-table) loses these.
    const row = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM transactions WHERE id = 'tx_v1'",
    );
    expect(row).toMatchObject({
      id: "tx_v1",
      wallet_id: "w_v1",
      category_id: "c_v1",
      amount: 15000,
      direction: "out",
      occurred_at: V1_TIMESTAMP,
      merchant: "Jollibee",
      reference_no: "REF-V1",
      source: "notification",
      confidence: 0.94,
      note: "lunch",
      created_at: V1_TIMESTAMP,
    });
    // The new column is NULL on rows that predate it — never 0, which would
    // read as "the provider reported a balance of ₱0.00".
    expect(row?.balance_after).toBeNull();

    const count = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM transactions",
    );
    expect(count?.n).toBe(1);

    // And the wallet the row hangs off is untouched, so the FK still resolves.
    const wallet = await db.getFirstAsync<{ balance: number }>(
      "SELECT balance FROM wallets WHERE id = 'w_v1'",
    );
    expect(wallet?.balance).toBe(250000);
  });

  test("both versions end up recorded, and a third run applies nothing", async () => {
    const db = await getDatabase();
    await runMigrations(db, [MIGRATIONS[0]]);
    await seedVersionOneRows(db);
    await runMigrations(db);

    const recorded = await db.getAllAsync<{ version: number; name: string }>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    );
    expect(recorded).toEqual([
      { version: 1, name: "core" },
      { version: 2, name: "balance_after" },
    ]);

    // Re-running an ALTER TABLE ADD COLUMN would throw "duplicate column name";
    // the exactly-once guard is what keeps a second launch from crashing.
    expect(await runMigrations(db)).toEqual([]);
    expect((await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM transactions"))?.n).toBe(1);
  });

  test("a row written before the upgrade can be given a balance_after afterwards", async () => {
    // The column has to be WRITABLE on legacy rows, not merely present: the
    // reconciliation work will backfill reported balances onto history.
    const db = await getDatabase();
    await runMigrations(db, [MIGRATIONS[0]]);
    await seedVersionOneRows(db);
    await runMigrations(db);

    await db.runAsync("UPDATE transactions SET balance_after = ? WHERE id = 'tx_v1'", [235000]);
    const row = await db.getFirstAsync<{ balance_after: number; kind: string }>(
      "SELECT balance_after, typeof(balance_after) AS kind FROM transactions WHERE id = 'tx_v1'",
    );
    expect(row?.balance_after).toBe(235000);
    // Centavos are exact integers everywhere else in the schema; a REAL
    // affinity here would silently make one money column a float.
    expect(row?.kind).toBe("integer");
  });
});
