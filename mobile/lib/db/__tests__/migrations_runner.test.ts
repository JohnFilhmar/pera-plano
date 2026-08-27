// lib/db/__tests__/migrations_runner.test.ts — the runner's own contract, as
// opposed to what any particular migration does.
//
// WHY THIS SUITE EXISTS. 014_drop_wallet_type.sql rebuilds `wallets`, a table
// FOUR others reference (wallet_matchers, transactions, goals, loans). The
// connection runs with `PRAGMA foreign_keys = ON` (database.ts) and this runner
// puts every migration inside a transaction — and SQLite IGNORES a
// foreign_keys pragma issued inside one. So the runner learned to toggle the
// pragma around the transaction for migrations that ask, and to run
// `PRAGMA foreign_key_check` BEFORE COMMIT so an orphan rolls the rebuild back
// instead of shipping. Both halves are asserted here, against real SQLite,
// because a rebuild that silently orphans a transaction's `wallet_id` is the
// kind of bug that only shows up as a wrong number weeks later.
//
// EVERY ASSERTION HERE DISCRIMINATES. An earlier draft of this file passed
// against the un-changed runner: it asserted `rejects.toThrow(MigrationIntegrityError)`
// while that export did not exist, so the matcher received `undefined` and
// happily matched SQLite's own foreign-key error. The tests below check the
// error's NAME, and the central one asserts a rebuild SUCCEEDS — which the old
// runner cannot do at all.
import { closeDatabase, getDatabase } from "@/lib/db/database";
import { MIGRATIONS, MigrationIntegrityError, runMigrations } from "@/lib/db/migrations";
import { freshDb } from "@/test_support/db";

import type { Migration } from "@/lib/db/migrations";

/** Above every shipped version, so these never collide with the real registry. */
const SCRATCH_VERSION = Math.max(...MIGRATIONS.map((migration) => migration.version)) + 100;

/**
 * The shape 014 uses: build the replacement, copy, drop the original, rename.
 * With foreign keys enforced this fails at the DROP, because four tables point
 * at `wallets`.
 */
const REBUILD_WALLETS_SQL = `
CREATE TABLE wallets_new (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PHP',
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO wallets_new (id, name, balance, currency, is_archived, created_at, updated_at)
SELECT id, name, balance, currency, is_archived, created_at, updated_at FROM wallets;
DROP TABLE wallets;
ALTER TABLE wallets_new RENAME TO wallets;
`;

async function seedWalletWithMatcher(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at)
     VALUES ('w1', 'BPI', 'bank', 0, 'PHP', 0, 1, 1)`,
  );
  await db.runAsync(
    `INSERT INTO wallet_matchers (id, wallet_id, package_name, hint, created_at, updated_at)
     VALUES ('m1', 'w1', 'com.bpi.ng.app', NULL, 1, 1)`,
  );
}

async function foreignKeysEnabled(): Promise<number | undefined> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ foreign_keys: number }>("PRAGMA foreign_keys");
  return rows[0]?.foreign_keys;
}

beforeEach(async () => {
  await freshDb();
});

afterEach(async () => {
  await closeDatabase();
});

test("the runner exports the integrity error it throws", () => {
  // Guards the failure mode this suite was rewritten for: a matcher handed
  // `undefined` matches any error at all.
  expect(typeof MigrationIntegrityError).toBe("function");
});

test("a flagged migration can rebuild a table four others reference", async () => {
  await seedWalletWithMatcher();
  const db = await getDatabase();

  const rebuild: Migration = {
    version: SCRATCH_VERSION,
    name: "rebuild_wallets",
    sql: REBUILD_WALLETS_SQL,
    disablesForeignKeys: true,
  };

  expect(await runMigrations(db, [rebuild])).toEqual([SCRATCH_VERSION]);

  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(wallets)");
  expect(columns.map((column) => column.name)).not.toContain("type");

  // The child row still points at a wallet that still exists.
  const matchers = await db.getAllAsync<{ wallet_id: string }>(
    "SELECT wallet_id FROM wallet_matchers",
  );
  expect(matchers).toEqual([{ wallet_id: "w1" }]);
  expect(await db.getAllAsync("PRAGMA foreign_key_check")).toEqual([]);
});

test("the same rebuild without the flag is refused", async () => {
  await seedWalletWithMatcher();
  const db = await getDatabase();

  const rebuild: Migration = {
    version: SCRATCH_VERSION + 1,
    name: "rebuild_wallets_unflagged",
    sql: REBUILD_WALLETS_SQL,
  };

  await expect(runMigrations(db, [rebuild])).rejects.toThrow();

  // Rolled back: the original table, with its original column, is still there.
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(wallets)");
  expect(columns.map((column) => column.name)).toContain("type");
});

test("a flagged migration that leaves real orphans is rolled back", async () => {
  await seedWalletWithMatcher();
  const db = await getDatabase();

  // Drops the parent row and puts nothing back — only reachable because
  // enforcement is off, which is exactly the window foreign_key_check closes.
  const orphaning: Migration = {
    version: SCRATCH_VERSION + 2,
    name: "orphaning",
    sql: "DELETE FROM wallets;",
    disablesForeignKeys: true,
  };

  await expect(runMigrations(db, [orphaning])).rejects.toMatchObject({
    name: "MigrationIntegrityError",
    version: SCRATCH_VERSION + 2,
  });

  const wallets = await db.getAllAsync<{ id: string }>("SELECT id FROM wallets");
  expect(wallets).toHaveLength(1);

  const recorded = await db.getAllAsync<{ version: number }>(
    "SELECT version FROM schema_migrations WHERE version = ?",
    [SCRATCH_VERSION + 2],
  );
  expect(recorded).toHaveLength(0);
});

test("foreign keys are back on after a flagged migration, success or failure", async () => {
  const db = await getDatabase();
  await runMigrations(db, [
    {
      version: SCRATCH_VERSION + 3,
      name: "harmless",
      sql: "CREATE TABLE scratch (id TEXT PRIMARY KEY NOT NULL);",
      disablesForeignKeys: true,
    },
  ]);
  expect(await foreignKeysEnabled()).toBe(1);

  await seedWalletWithMatcher();
  await expect(
    runMigrations(db, [
      {
        version: SCRATCH_VERSION + 4,
        name: "orphaning_again",
        sql: "DELETE FROM wallets;",
        disablesForeignKeys: true,
      },
    ]),
  ).rejects.toThrow();
  expect(await foreignKeysEnabled()).toBe(1);
});

test("an ordinary migration still rolls back on failure", async () => {
  const db = await getDatabase();
  const failing: Migration = {
    version: SCRATCH_VERSION + 5,
    name: "failing",
    sql: "CREATE TABLE ok (id TEXT PRIMARY KEY NOT NULL); SELECT nonexistent_fn();",
  };

  await expect(runMigrations(db, [failing])).rejects.toThrow();

  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ok'",
  );
  expect(tables).toHaveLength(0);
});

test("a successful migration is recorded and not re-applied", async () => {
  const db = await getDatabase();
  const once: Migration = {
    version: SCRATCH_VERSION + 6,
    name: "once",
    sql: "CREATE TABLE once_only (id TEXT PRIMARY KEY NOT NULL);",
    disablesForeignKeys: true,
  };

  expect(await runMigrations(db, [once])).toEqual([SCRATCH_VERSION + 6]);
  // A second run would throw "table already exists" if the version were not recorded.
  expect(await runMigrations(db, [once])).toEqual([]);
});
