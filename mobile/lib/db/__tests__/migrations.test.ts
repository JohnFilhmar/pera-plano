import { closeDatabase, getDatabase, unlockDatabase } from "../database";
import { runMigrations, type Migration } from "../migrations";
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
