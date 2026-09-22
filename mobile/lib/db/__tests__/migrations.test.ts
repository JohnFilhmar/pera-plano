import { closeDatabase, getDatabase, unlockDatabase } from "../database";
import { MIGRATIONS, runMigrations, SchemaTooNewError, type Migration } from "../migrations";
import { freshDb, TEST_DEK } from "@/test_support/db";

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

// ---------------------------------------------------------------------------
// An older build opening a newer database (GAP-044)
//
// Reachable because OTA is configured: app.json carries `runtimeVersion` and
// `updates.url`, so a JS bundle can be rolled back onto a device whose database
// has already migrated forward. There are no down migrations, so the only safe
// answer is to refuse to open.
// ---------------------------------------------------------------------------

describe("a database newer than this build's registry", () => {
  test("REFUSES TO OPEN, and applies nothing", async () => {
    const db = await getDatabase();
    // The device is at 2, having run a build that knew about both.
    await runMigrations(db, TEST_MIGRATIONS);

    // The OTA rollback: a bundle whose registry stops at 1.
    await expect(runMigrations(db, [TEST_MIGRATIONS[0]])).rejects.toThrow(SchemaTooNewError);

    // Nothing was touched on the way to the refusal. Before the guard, this
    // path applied nothing and returned normally, and the caller then read a
    // schema it did not understand.
    const recorded = await db.getAllAsync<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(recorded.map((r) => r.version)).toEqual([1, 2]);
  });

  test("names both versions, so the log says which build is behind", async () => {
    const db = await getDatabase();
    await runMigrations(db, TEST_MIGRATIONS);

    await expect(runMigrations(db, [TEST_MIGRATIONS[0]])).rejects.toMatchObject({
      name: "SchemaTooNewError",
      appliedVersion: 2,
      registryVersion: 1,
    });
  });

  test("A FRESH INSTALL IS NOT REFUSED — an empty database is not a newer one", async () => {
    const db = await getDatabase();
    // No schema_migrations rows at all. Math.max() of nothing is -Infinity,
    // which would compare as "not newer" by accident; this pins that the empty
    // case is handled on purpose and a first launch still migrates.
    const applied = await runMigrations(db, TEST_MIGRATIONS);
    expect(applied).toEqual([1, 2]);
  });

  test("an equal version still opens — this is not an off-by-one refusal", async () => {
    const db = await getDatabase();
    await runMigrations(db, TEST_MIGRATIONS);
    await expect(runMigrations(db, TEST_MIGRATIONS)).resolves.toEqual([]);
  });

  test("a gap in the applied versions is caught on the MAXIMUM, not the count", async () => {
    const db = await getDatabase();
    await runMigrations(db, TEST_MIGRATIONS);
    // Two applied, and a registry that also holds two — but a DIFFERENT two,
    // reaching only version 1. Counting rows would call this even; only the
    // maximum shows the database is ahead.
    const sidewaysRegistry: Migration[] = [
      { version: 1, name: "one", sql: "SELECT 1;" },
      { version: 0, name: "zero", sql: "SELECT 1;" },
    ];
    await expect(runMigrations(db, sidewaysRegistry)).rejects.toThrow(SchemaTooNewError);
  });
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
    // 001 IS NOT IN THIS LIST. A leading `1` would mean 001 was replayed over
    // live data; every later version is simply everything that has shipped
    // since, derived from the registry so a new migration does not break a
    // test about upgrading from version 1.
    expect(applied).toEqual(MIGRATIONS.filter((m) => m.version > 1).map((m) => m.version));
    expect(applied).not.toContain(1);

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

  test("every shipped version ends up recorded, and a further run applies nothing", async () => {
    const db = await getDatabase();
    await runMigrations(db, [MIGRATIONS[0]]);
    await seedVersionOneRows(db);
    await runMigrations(db);

    const recorded = await db.getAllAsync<{ version: number; name: string }>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    );
    // DERIVED FROM THE REGISTRY. The subject is that EVERY shipped version ends
    // up recorded, in order and exactly once, with the name it was registered
    // under — not how many there happen to be. Spelled out as a literal it
    // broke on migration 006, in two places, neither of which is about bills.
    expect(recorded).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));

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

// ---------------------------------------------------------------------------
// 003_drift_dismissal — which drift the user has already seen.
//
// The same in-place-upgrade proof 002 gets, plus the two properties that make
// this column a DISMISSAL RECORD rather than a flag: it holds a real transaction
// id, and the foreign key means it can only ever name a row that exists. A
// boolean would pass none of the wallets_repo tests that hang off it and every
// test in this file — which is why the discriminating assertions live there, and
// this block sticks to the migration's own job.
// ---------------------------------------------------------------------------

describe("003_drift_dismissal upgrades a real version-2 database in place", () => {
  /** Brings a database up to exactly what a shipped v2 device holds, with rows. */
  async function atVersionTwoWithRows(
    db: Awaited<ReturnType<typeof getDatabase>>,
  ): Promise<void> {
    const [core, balanceAfter] = MIGRATIONS;
    expect(balanceAfter.version).toBe(2);
    expect(await runMigrations(db, [core, balanceAfter])).toEqual([1, 2]);
    await seedVersionOneRows(db);
  }

  test("a database at 002, already holding wallets, gains the column and keeps every value", async () => {
    const db = await getDatabase();
    await atVersionTwoWithRows(db);

    // Genuinely absent first, or "it is there afterwards" would prove nothing
    // about upgrading — only about a database that always had it.
    const before = await db.getAllAsync<{ name: string }>("PRAGMA table_info(wallets)");
    expect(before.map((c) => c.name)).not.toContain("drift_dismissed_transaction_id");

    // 1 AND 2 MUST NOT BE IN THIS LIST — either would mean an already-applied
    // migration was replayed over live data. 4 is here because it shipped after
    // 003 and a v2 device is behind by both.
    expect(await runMigrations(db)).toEqual(
      MIGRATIONS.filter((m) => m.version > 2).map((m) => m.version),
    );

    const after = await db.getAllAsync<{ name: string }>("PRAGMA table_info(wallets)");
    expect(after.map((c) => c.name)).toContain("drift_dismissed_transaction_id");

    // Field by field: ADD COLUMN appends and rewrites nothing, so a
    // drop-and-recreate (or a rebuild through a temp table) fails here.
    const wallet = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM wallets WHERE id = 'w_v1'",
    );
    expect(wallet).toMatchObject({
      id: "w_v1",
      name: "GCash",
      balance: 250000,
      currency: "PHP",
      is_archived: 0,
      created_at: V1_TIMESTAMP,
    });
    // NULL on every pre-existing wallet — "nothing acknowledged", which is a
    // different fact from any id and cannot be confused with one.
    expect(wallet?.drift_dismissed_transaction_id).toBeNull();

    const count = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM wallets");
    expect(count?.n).toBe(1);
  });

  test("every shipped version ends up recorded, and a further run applies nothing", async () => {
    const db = await getDatabase();
    await atVersionTwoWithRows(db);
    await runMigrations(db);

    const recorded = await db.getAllAsync<{ version: number; name: string }>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    );
    // DERIVED FROM THE REGISTRY. The subject is that EVERY shipped version ends
    // up recorded, in order and exactly once, with the name it was registered
    // under — not how many there happen to be. Spelled out as a literal it
    // broke on migration 006, in two places, neither of which is about bills.
    expect(recorded).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));

    // Re-running ALTER TABLE ADD COLUMN throws "duplicate column name"; the
    // exactly-once guard is what keeps the second launch from crashing.
    expect(await runMigrations(db)).toEqual([]);
  });

  test("the column stores a real transaction id and can be cleared back to NULL", async () => {
    // It has to be an ID, and it has to be WRITABLE on a wallet that predates
    // the column — a dismissal is recorded on wallets that already exist.
    const db = await getDatabase();
    await atVersionTwoWithRows(db);
    await runMigrations(db);

    await db.runAsync(
      "UPDATE wallets SET drift_dismissed_transaction_id = 'tx_v1' WHERE id = 'w_v1'",
    );
    const dismissed = await db.getFirstAsync<{ id: string | null; kind: string }>(
      `SELECT drift_dismissed_transaction_id AS id,
              typeof(drift_dismissed_transaction_id) AS kind
         FROM wallets WHERE id = 'w_v1'`,
    );
    expect(dismissed?.id).toBe("tx_v1");
    // TEXT, like every other id in the schema. An INTEGER affinity here would
    // coerce the ids this app actually generates into something else.
    expect(dismissed?.kind).toBe("text");

    await db.runAsync(
      "UPDATE wallets SET drift_dismissed_transaction_id = NULL WHERE id = 'w_v1'",
    );
    expect(
      (
        await db.getFirstAsync<{ id: string | null }>(
          "SELECT drift_dismissed_transaction_id AS id FROM wallets WHERE id = 'w_v1'",
        )
      )?.id,
    ).toBeNull();
  });

  test("the foreign key rejects a dismissal naming a transaction that does not exist", async () => {
    // The REFERENCES clause is the point: a dismissal that names nothing would
    // never match the current reporting transaction, so the badge would look
    // undismissed — right answer, wrong reason, and unexplainable in support.
    const db = await getDatabase();
    await atVersionTwoWithRows(db);
    await runMigrations(db);

    await expect(
      db.runAsync(
        "UPDATE wallets SET drift_dismissed_transaction_id = 'no_such_tx' WHERE id = 'w_v1'",
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

// ---------------------------------------------------------------------------
// 004_limit_alert_state — the limit engine's per-period working memory.
//
// Same shape of proof as 002 and 003: a database already carrying a user's
// limits at an older version gains the column WITHOUT losing a row. A limit is
// a configuration the user typed in, so losing one is losing their work.
// ---------------------------------------------------------------------------
describe("004_limit_alert_state upgrades a real version-3 database in place", () => {
  const V3_LIMIT_ID = "lim_v3";

  /** Brings a database up to exactly what a shipped v3 device holds, with a limit. */
  async function atVersionThreeWithLimit(
    db: Awaited<ReturnType<typeof getDatabase>>,
  ): Promise<void> {
    const [core, balanceAfter, driftDismissal] = MIGRATIONS;
    expect(driftDismissal.version).toBe(3);
    expect(await runMigrations(db, [core, balanceAfter, driftDismissal])).toEqual([1, 2, 3]);

    await db.runAsync(
      `INSERT INTO limits (id, scope, basis, value, category_filter_json, wallet_filter_json,
                           rollover, is_active, thresholds_fired_json, created_at, updated_at)
       VALUES (?, 'monthly', 'fixed', 800000, '["cat_food"]', NULL, 1, 1, '[50]', ?, ?)`,
      [V3_LIMIT_ID, V1_TIMESTAMP, V1_TIMESTAMP],
    );
  }

  test("a database at 003, already holding limits, gains the column and keeps every value", async () => {
    const db = await getDatabase();
    await atVersionThreeWithLimit(db);

    const before = await db.getAllAsync<{ name: string }>("PRAGMA table_info(limits)");
    expect(before.map((c) => c.name)).not.toContain("limit_alert_state_json");

    // DERIVED, NOT HARDCODED. This test's subject is that a database sitting
    // at 003 catches up and keeps its data — not how many migrations exist by
    // now. Written as `[4, 5]` it broke on migration 006, which has nothing to
    // do with limits, and would break again on every migration after it.
    const pending = MIGRATIONS.filter((m) => m.version > 3).map((m) => m.version);
    expect(await runMigrations(db)).toEqual(pending);
    expect(pending).toContain(4);

    const after = await db.getAllAsync<{ name: string }>("PRAGMA table_info(limits)");
    expect(after.map((c) => c.name)).toContain("limit_alert_state_json");

    const limit = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM limits WHERE id = ?",
      [V3_LIMIT_ID],
    );
    expect(limit).toMatchObject({
      id: V3_LIMIT_ID,
      scope: "monthly",
      basis: "fixed",
      value: 800000,
      category_filter_json: '["cat_food"]',
      rollover: 1,
      is_active: 1,
      created_at: V1_TIMESTAMP,
    });
    // NULL on every pre-existing limit — "the engine has never evaluated this
    // one". Distinct from the '[50]' already in thresholds_fired_json, which
    // survives untouched: the two columns carry different facts.
    expect(limit?.limit_alert_state_json).toBeNull();
    expect(limit?.thresholds_fired_json).toBe("[50]");

    const count = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM limits");
    expect(count?.n).toBe(1);
  });

  test("the column holds JSON text and can be cleared back to NULL", async () => {
    const db = await getDatabase();
    await atVersionThreeWithLimit(db);
    await runMigrations(db);

    const state = JSON.stringify({
      periodStart: V1_TIMESTAMP,
      base: 800000,
      carryover: 0,
      muted: false,
      lastSpend: 12345,
    });
    await db.runAsync("UPDATE limits SET limit_alert_state_json = ? WHERE id = ?", [
      state,
      V3_LIMIT_ID,
    ]);

    const row = await db.getFirstAsync<{ json: string | null; kind: string }>(
      `SELECT limit_alert_state_json AS json, typeof(limit_alert_state_json) AS kind
         FROM limits WHERE id = ?`,
      [V3_LIMIT_ID],
    );
    expect(row?.json).toBe(state);
    // TEXT affinity. An INTEGER or REAL affinity would silently coerce a JSON
    // object that happens to be all digits, and the state would come back wrong
    // rather than come back broken.
    expect(row?.kind).toBe("text");

    // Clearable, because the engine has to be able to say "never evaluated"
    // again — a scope change restarts a limit with carryover reset (limits
    // rule 2).
    await db.runAsync("UPDATE limits SET limit_alert_state_json = NULL WHERE id = ?", [
      V3_LIMIT_ID,
    ]);
    expect(
      (
        await db.getFirstAsync<{ json: string | null }>(
          "SELECT limit_alert_state_json AS json FROM limits WHERE id = ?",
          [V3_LIMIT_ID],
        )
      )?.json,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// m2c Task 1 — 006_bill_cycles. The first migration to alter TWO already-shipped
// tables in one step (`bills` and `recurring_patterns`) as well as adding one,
// which is precisely the case this file's upgrade-in-place tests exist for.
// ---------------------------------------------------------------------------
const V5_BILL_ID = "bill_v5";
const V5_PATTERN_ID = "pattern_v5";

describe("006_bill_cycles upgrades a real version-5 database in place", () => {
  /** Brings a database to 005 and seeds the two tables 006 alters. */
  async function atVersionFiveWithBills(
    db: Awaited<ReturnType<typeof getDatabase>>,
  ): Promise<void> {
    const upToFive = MIGRATIONS.filter((m) => m.version <= 5);
    expect(upToFive.length).toBe(5);
    await runMigrations(db, upToFive);

    await db.runAsync(
      `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
       VALUES ('c_v5', 'Bills & Utilities', NULL, 'receipt', 1, 0, ?, ?)`,
      [V1_TIMESTAMP, V1_TIMESTAMP],
    );
    await db.runAsync(
      `INSERT INTO bills (id, name, amount, amount_mode, due_rule_json, reminder_offsets_json,
         auto_match_rule_json, category_id, created_at, updated_at)
       VALUES (?, 'Meralco', 235000, 'estimated', '{"kind":"day-of-month","day":20}', '[-3,0]',
               NULL, 'c_v5', ?, ?)`,
      [V5_BILL_ID, V1_TIMESTAMP, V1_TIMESTAMP],
    );
    await db.runAsync(
      `INSERT INTO recurring_patterns (id, merchant, amount, period, confidence, acknowledged,
         created_at, updated_at)
       VALUES (?, 'NETFLIX', 54900, 'monthly', 0.9, 0, ?, ?)`,
      [V5_PATTERN_ID, V1_TIMESTAMP, V1_TIMESTAMP],
    );
  }

  test("a database at 005, already holding a bill and a pattern, gains both columns and keeps every value", async () => {
    const db = await getDatabase();
    await atVersionFiveWithBills(db);

    // Genuinely absent first, or "it is there afterwards" would prove nothing.
    const billsBefore = await db.getAllAsync<{ name: string }>("PRAGMA table_info(bills)");
    expect(billsBefore.map((c) => c.name)).not.toContain("archived_at");

    expect(await runMigrations(db)).toEqual(
      MIGRATIONS.filter((m) => m.version > 5).map((m) => m.version),
    );

    const billsAfter = await db.getAllAsync<{ name: string }>("PRAGMA table_info(bills)");
    expect(billsAfter.map((c) => c.name)).toContain("archived_at");
    const patternsAfter = await db.getAllAsync<{ name: string }>(
      "PRAGMA table_info(recurring_patterns)",
    );
    expect(patternsAfter.map((c) => c.name)).toContain("bill_id");

    // Rule 27 keeps history untouched, which starts with the bill surviving its
    // own migration — and archived_at NULL, not 0, because a live bill is not
    // one archived at the epoch.
    const bill = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM bills WHERE id = ?",
      [V5_BILL_ID],
    );
    expect(bill).toMatchObject({
      id: V5_BILL_ID,
      name: "Meralco",
      amount: 235000,
      amount_mode: "estimated",
      due_rule_json: '{"kind":"day-of-month","day":20}',
      category_id: "c_v5",
    });
    expect(bill?.archived_at).toBeNull();

    const pattern = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM recurring_patterns WHERE id = ?",
      [V5_PATTERN_ID],
    );
    expect(pattern).toMatchObject({ merchant: "NETFLIX", amount: 54900, acknowledged: 0 });
    // An UNPROMOTED pattern, which is what every existing row is: acknowledged
    // and linked are different facts (rules 28-29), and the migration must not
    // guess that an old acknowledged pattern belongs to some bill.
    expect(pattern?.bill_id).toBeNull();
  });

  test("THE PAID CHECK IS ENFORCED BY THE SCHEMA, BOTH WAYS", async () => {
    // A cycle claiming to be paid with nothing behind it, and a moneyless
    // resolution carrying a payment, are both impossible at the storage layer —
    // not merely avoided by the repository.
    const db = await getDatabase();
    await atVersionFiveWithBills(db);
    await runMigrations(db);

    await expect(
      db.runAsync(
        `INSERT INTO bill_cycles (id, bill_id, due_date, state, bill_payment_id,
           overdue_notices_sent, resolved_at, created_at, updated_at)
         VALUES ('bc_bad_paid', ?, '2026-08-20', 'paid', NULL, 0, ?, ?, ?)`,
        [V5_BILL_ID, V1_TIMESTAMP, V1_TIMESTAMP, V1_TIMESTAMP],
      ),
    ).rejects.toThrow();

    // And 'open' is a real state, so rule 22's counter has somewhere to live
    // without pretending an overdue cycle was skipped.
    await db.runAsync(
      `INSERT INTO bill_cycles (id, bill_id, due_date, state, bill_payment_id,
         overdue_notices_sent, resolved_at, created_at, updated_at)
       VALUES ('bc_open', ?, '2026-08-20', 'open', NULL, 2, NULL, ?, ?)`,
      [V5_BILL_ID, V1_TIMESTAMP, V1_TIMESTAMP],
    );
    const open = await db.getFirstAsync<{ state: string; overdue_notices_sent: number }>(
      "SELECT state, overdue_notices_sent FROM bill_cycles WHERE id = 'bc_open'",
    );
    expect(open).toMatchObject({ state: "open", overdue_notices_sent: 2 });

    // One row per occurrence: re-resolving a due date is a correction of the
    // existing row, never a second row disagreeing with the first.
    await expect(
      db.runAsync(
        `INSERT INTO bill_cycles (id, bill_id, due_date, state, bill_payment_id,
           overdue_notices_sent, resolved_at, created_at, updated_at)
         VALUES ('bc_dupe', ?, '2026-08-20', 'skipped', NULL, 0, ?, ?, ?)`,
        [V5_BILL_ID, V1_TIMESTAMP, V1_TIMESTAMP, V1_TIMESTAMP],
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// M3 Part 2 Task 6 — 007_recurring_detail. `recurring_patterns` gains three
// nullable columns; a row written before this migration must keep every value
// it already had and simply read NULL for the three new ones.
// ---------------------------------------------------------------------------
const V6_PATTERN_ID = "pattern_v6";

describe("007_recurring_detail upgrades a real version-6 database in place", () => {
  /** Brings a database to 006 and seeds a pattern the way a v6 device would have one. */
  async function atVersionSixWithPattern(
    db: Awaited<ReturnType<typeof getDatabase>>,
  ): Promise<void> {
    const upToSix = MIGRATIONS.filter((m) => m.version <= 6);
    expect(upToSix.length).toBe(6);
    await runMigrations(db, upToSix);

    await db.runAsync(
      `INSERT INTO recurring_patterns (id, merchant, amount, period, confidence, acknowledged,
         bill_id, created_at, updated_at)
       VALUES (?, 'NETFLIX', 54900, 'monthly', 0.9, 0, NULL, ?, ?)`,
      [V6_PATTERN_ID, V1_TIMESTAMP, V1_TIMESTAMP],
    );
  }

  test("a database at 006, already holding a pattern, gains the three columns and keeps every value", async () => {
    const db = await getDatabase();
    await atVersionSixWithPattern(db);

    // Genuinely absent first, or "it is there afterwards" would prove nothing.
    const before = await db.getAllAsync<{ name: string }>("PRAGMA table_info(recurring_patterns)");
    expect(before.map((c) => c.name)).not.toContain("period_days");

    expect(await runMigrations(db)).toEqual(
      MIGRATIONS.filter((m) => m.version > 6).map((m) => m.version),
    );

    const after = await db.getAllAsync<{ name: string }>("PRAGMA table_info(recurring_patterns)");
    expect(after.map((c) => c.name)).toEqual(
      expect.arrayContaining(["period_days", "first_seen_at", "last_seen_at", "dismissed_at"]),
    );

    const pattern = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM recurring_patterns WHERE id = ?",
      [V6_PATTERN_ID],
    );
    expect(pattern).toMatchObject({
      id: V6_PATTERN_ID,
      merchant: "NETFLIX",
      amount: 54900,
      period: "monthly",
      acknowledged: 0,
    });
    // NULL on every pre-existing row — a v6 pattern has no exact cadence or
    // dismissal recorded, and 0 would be a real (and wrong) value for each.
    expect(pattern?.period_days).toBeNull();
    expect(pattern?.first_seen_at).toBeNull();
    expect(pattern?.last_seen_at).toBeNull();
    expect(pattern?.dismissed_at).toBeNull();
  });

  test("the new columns are writable on a row that predates them", async () => {
    const db = await getDatabase();
    await atVersionSixWithPattern(db);
    await runMigrations(db);

    await db.runAsync(
      `UPDATE recurring_patterns
          SET period_days = 30, first_seen_at = ?, last_seen_at = ?, dismissed_at = ?
        WHERE id = ?`,
      [V1_TIMESTAMP, V1_TIMESTAMP, V1_TIMESTAMP, V6_PATTERN_ID],
    );
    const row = await db.getFirstAsync<{ period_days: number; kind: string }>(
      "SELECT period_days, typeof(period_days) AS kind FROM recurring_patterns WHERE id = ?",
      [V6_PATTERN_ID],
    );
    expect(row?.period_days).toBe(30);
    expect(row?.kind).toBe("integer");
  });

  test("every shipped version ends up recorded, and a further run applies nothing", async () => {
    const db = await getDatabase();
    await atVersionSixWithPattern(db);
    await runMigrations(db);

    const recorded = await db.getAllAsync<{ version: number; name: string }>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    );
    expect(recorded).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));
    expect(await runMigrations(db)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 008_loan_reminders — the per-loan reminder gap closed (owner-approved
// 2026-08-16). `loans` gains ONE column; a loan written before this migration
// must keep every value it already had and read the spec's default three
// offsets for the new one, not NULL and not empty — an already-tracked loan
// "specifies none" and rule 15's default is the out-of-box behaviour for
// exactly that case.
// ---------------------------------------------------------------------------
const V7_LOAN_ID = "loan_v7";

describe("008_loan_reminders upgrades a real version-7 database in place", () => {
  /** Brings a database to 007 and seeds a loan the way a v7 device would have one. */
  async function atVersionSevenWithLoan(
    db: Awaited<ReturnType<typeof getDatabase>>,
  ): Promise<void> {
    const upToSeven = MIGRATIONS.filter((m) => m.version <= 7);
    expect(upToSeven.length).toBe(7);
    await runMigrations(db, upToSeven);

    await db.runAsync(
      `INSERT INTO loans (id, direction, counterparty, principal, interest_rate, schedule_json,
         linked_wallet_id, next_due_date, next_due_amount, created_at, updated_at)
       VALUES (?, 'i-owe', 'Aling Nena', 500000, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      [V7_LOAN_ID, V1_TIMESTAMP, V1_TIMESTAMP],
    );
  }

  test("a database at 007, already holding a loan, gains the column and defaults it to the spec's three offsets", async () => {
    const db = await getDatabase();
    await atVersionSevenWithLoan(db);

    // Genuinely absent first, or "it is there afterwards" would prove nothing.
    const before = await db.getAllAsync<{ name: string }>("PRAGMA table_info(loans)");
    expect(before.map((c) => c.name)).not.toContain("reminder_offsets_json");

    expect(await runMigrations(db)).toEqual(
      MIGRATIONS.filter((m) => m.version > 7).map((m) => m.version),
    );

    const after = await db.getAllAsync<{ name: string }>("PRAGMA table_info(loans)");
    expect(after.map((c) => c.name)).toContain("reminder_offsets_json");

    const loan = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM loans WHERE id = ?",
      [V7_LOAN_ID],
    );
    expect(loan).toMatchObject({
      id: V7_LOAN_ID,
      direction: "i-owe",
      counterparty: "Aling Nena",
      principal: 500000,
      created_at: V1_TIMESTAMP,
    });
    // NOT NULL and NOT an empty array — a pre-existing loan "specifies none"
    // and rule 15's default three is the out-of-box behaviour for that case,
    // the one deliberate divergence from bills' CREATE-TABLE-time '[]' default.
    expect(loan?.reminder_offsets_json).toBe("[-3,0,3]");

    const count = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM loans");
    expect(count?.n).toBe(1);
  });

  test("the column is writable on a row that predates it, including turning reminders off", async () => {
    const db = await getDatabase();
    await atVersionSevenWithLoan(db);
    await runMigrations(db);

    await db.runAsync("UPDATE loans SET reminder_offsets_json = ? WHERE id = ?", [
      "[]",
      V7_LOAN_ID,
    ]);
    const row = await db.getFirstAsync<{ json: string; kind: string }>(
      "SELECT reminder_offsets_json AS json, typeof(reminder_offsets_json) AS kind FROM loans WHERE id = ?",
      [V7_LOAN_ID],
    );
    expect(row?.json).toBe("[]");
    expect(row?.kind).toBe("text");
  });

  test("every shipped version ends up recorded, and a further run applies nothing", async () => {
    const db = await getDatabase();
    await atVersionSevenWithLoan(db);
    await runMigrations(db);

    const recorded = await db.getAllAsync<{ version: number; name: string }>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    );
    expect(recorded).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));
    expect(await runMigrations(db)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// m3b Task 7 — 009_parse_stats. A brand-new table with no prior column to
// alter, so there is nothing pre-existing for the migration to preserve — the
// upgrade-in-place question here is narrower than 006/008's: does a device
// already at 008 gain the table cleanly, with the UNIQUE pair enforced from
// the moment it exists.
// ---------------------------------------------------------------------------
describe("009_parse_stats upgrades a real version-8 database in place", () => {
  async function atVersionEight(db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> {
    const upToEight = MIGRATIONS.filter((m) => m.version <= 8);
    expect(upToEight.length).toBe(8);
    await runMigrations(db, upToEight);
  }

  test("a database at 008 gains the table, empty, with the counts-only column set", async () => {
    const db = await getDatabase();
    await atVersionEight(db);

    // Genuinely absent first, or "it is there afterwards" would prove nothing.
    const before = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'parse_stats'",
    );
    expect(before).toEqual([]);

    expect(await runMigrations(db)).toEqual(
      MIGRATIONS.filter((m) => m.version > 8).map((m) => m.version),
    );

    const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(parse_stats)");
    // Exactly these six, in this order — a seventh column, especially a TEXT
    // one, is exactly the shape a stray "let's also keep the title" edit would
    // take, and rule 3's promise ("counts only, never content") depends on
    // there being nowhere for one to go.
    expect(columns.map((c) => c.name)).toEqual([
      "id", "provider_key", "day_start_at", "parsed_count", "failed_count", "updated_at",
    ]);

    const count = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM parse_stats",
    );
    expect(count?.n).toBe(0);
  });

  test("the UNIQUE (provider_key, day_start_at) pair is enforced from the moment the table exists", async () => {
    const db = await getDatabase();
    await atVersionEight(db);
    await runMigrations(db);

    await db.runAsync(
      `INSERT INTO parse_stats (id, provider_key, day_start_at, parsed_count, failed_count, updated_at)
       VALUES ('ps1', 'gcash', ?, 1, 0, ?)`,
      [V1_TIMESTAMP, V1_TIMESTAMP],
    );
    await expect(
      db.runAsync(
        `INSERT INTO parse_stats (id, provider_key, day_start_at, parsed_count, failed_count, updated_at)
         VALUES ('ps2', 'gcash', ?, 0, 1, ?)`,
        [V1_TIMESTAMP, V1_TIMESTAMP],
      ),
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("every shipped version ends up recorded, and a further run applies nothing", async () => {
    const db = await getDatabase();
    await atVersionEight(db);
    await runMigrations(db);

    const recorded = await db.getAllAsync<{ version: number; name: string }>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    );
    expect(recorded).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));
    expect(await runMigrations(db)).toEqual([]);
  });
});

test("migration 012 lets the queue hold a one-sided-transfer item", async () => {
  const db = await freshDb();

  await db.runAsync(
    `INSERT INTO review_queue_items (id, kind, payload_json, raw_notification_id, created_at)
     VALUES ('rq_one_sided', 'one-sided-transfer', '{}', NULL, 1)`,
  );

  const rows = await db.getAllAsync<{ kind: string }>(
    "SELECT kind FROM review_queue_items WHERE id = 'rq_one_sided'",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.kind).toBe("one-sided-transfer");
});

test("migration 012 keeps the open-queue index", async () => {
  const db = await freshDb();

  const indexes = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'review_queue_items'",
  );

  expect(indexes.map((row) => row.name)).toContain("idx_review_queue_open");
});

// ---------------------------------------------------------------------------
// 020_loan_amount_borrowed — the borrowed figure a flat loan could never store
// (GAP-082, owner decision 2026-09-10). `loans` gains ONE nullable column, and
// half of what makes this migration correct is what it does NOT do: a flat
// loan already on a device keeps its total repayable in `principal` and reads
// NULL here, because the amount borrowed was never recorded and cannot be
// recovered — rule 4 forbids the app deriving the interest rate that is the
// only bridge between ₱5,000 and ₱6,000. A backfill from `principal` would
// assert the user borrowed the total repayable, false for every flat loan
// carrying any add-on at all.
// ---------------------------------------------------------------------------
const V19_FLAT_LOAN_ID = "loan_v19_flat";

/** The doc's 5-6 example as a v19 row: ₱6,000 repayable in six weekly ₱1,000s. */
const V19_FLAT_SCHEDULE = JSON.stringify(
  ["2026-08-22", "2026-08-29", "2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"].map(
    (dueDate) => ({ dueDate, amountDue: 100_000 }),
  ),
);

describe("020_loan_amount_borrowed upgrades a real version-19 database in place", () => {
  /** Brings a database to 019 and seeds the flat loan a v19 device would hold. */
  async function atVersionNineteenWithFlatLoan(
    db: Awaited<ReturnType<typeof getDatabase>>,
  ): Promise<void> {
    const upToNineteen = MIGRATIONS.filter((m) => m.version <= 19);
    expect(upToNineteen.length).toBe(19);
    await runMigrations(db, upToNineteen);

    // `principal` IS the total repayable for a flat loan (rule 2) — which is
    // exactly why the ₱5,000 actually borrowed had nowhere to go on this build.
    await db.runAsync(
      `INSERT INTO loans (id, direction, counterparty, principal, interest_rate, schedule_json,
         linked_wallet_id, next_due_date, next_due_amount, reminder_offsets_json,
         created_at, updated_at)
       VALUES (?, 'i-owe', 'Aling Nena', 600000, NULL, ?, NULL, '2026-08-22', 100000,
               '[-3,0,3]', ?, ?)`,
      [V19_FLAT_LOAN_ID, V19_FLAT_SCHEDULE, V1_TIMESTAMP, V1_TIMESTAMP],
    );
  }

  test("a database at 019, already holding a flat loan, gains the column and keeps every value", async () => {
    const db = await getDatabase();
    await atVersionNineteenWithFlatLoan(db);

    // Genuinely absent first, or "it is there afterwards" would prove nothing
    // about upgrading — a freshDb() passes that assertion having never been at
    // 019 at all.
    const before = await db.getAllAsync<{ name: string }>("PRAGMA table_info(loans)");
    expect(before.map((c) => c.name)).not.toContain("amount_borrowed");

    // 020 AND WHATEVER FOLLOWS IT, nothing at or below 019. An earlier version
    // in the list would mean something was replayed over live rows; a list not
    // starting at 20 would mean the registry never got it.
    const applied = await runMigrations(db);
    expect(applied[0]).toBe(20);
    expect(applied).toEqual(MIGRATIONS.filter((m) => m.version > 19).map((m) => m.version));

    const after = await db.getAllAsync<{ name: string }>("PRAGMA table_info(loans)");
    expect(after.map((c) => c.name)).toContain("amount_borrowed");

    const loan = await db.getFirstAsync<Record<string, unknown>>(
      "SELECT * FROM loans WHERE id = ?",
      [V19_FLAT_LOAN_ID],
    );
    expect(loan).toMatchObject({
      id: V19_FLAT_LOAN_ID,
      direction: "i-owe",
      counterparty: "Aling Nena",
      principal: 600000,
      interest_rate: null,
      schedule_json: V19_FLAT_SCHEDULE,
      next_due_date: "2026-08-22",
      next_due_amount: 100000,
      reminder_offsets_json: "[-3,0,3]",
      created_at: V1_TIMESTAMP,
    });

    const count = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM loans");
    expect(count?.n).toBe(1);
  });

  test("THE COLUMN IS NULL ON A PRE-EXISTING FLAT LOAN, and emphatically not a copy of `principal`", async () => {
    // The backfill decision, pinned. ₱6,000 here would read as "you borrowed
    // the whole ₱6,000, and it cost you nothing" — a confident wrong answer
    // where the true one is that nobody recorded it. Doc open question 3 asks
    // whether to show "you are paying ₱1,000.00 over principal"; a backfilled
    // column would make that figure ₱0.00 for every loan that predates this.
    const db = await getDatabase();
    await atVersionNineteenWithFlatLoan(db);
    await runMigrations(db);

    const loan = await db.getFirstAsync<{ borrowed: number | null; principal: number }>(
      "SELECT amount_borrowed AS borrowed, principal FROM loans WHERE id = ?",
      [V19_FLAT_LOAN_ID],
    );
    expect(loan?.borrowed).toBeNull();
    expect(loan?.principal).toBe(600000);
  });

  test("the column is writable on a row that predates it, with integer affinity", async () => {
    // A user who remembers what they borrowed has to be able to say so on a
    // loan created before the app ever asked.
    const db = await getDatabase();
    await atVersionNineteenWithFlatLoan(db);
    await runMigrations(db);

    await db.runAsync("UPDATE loans SET amount_borrowed = ? WHERE id = ?", [
      500000,
      V19_FLAT_LOAN_ID,
    ]);
    const row = await db.getFirstAsync<{ borrowed: number; kind: string }>(
      "SELECT amount_borrowed AS borrowed, typeof(amount_borrowed) AS kind FROM loans WHERE id = ?",
      [V19_FLAT_LOAN_ID],
    );
    expect(row?.borrowed).toBe(500000);
    // Centavos are exact integers everywhere else in this schema; a REAL
    // affinity would silently make one money column a float.
    expect(row?.kind).toBe("integer");
  });

  test("the `> 0` CHECK is enforced from the moment the column exists, and NULL still passes it", async () => {
    // Zero is how "unknown" would sneak in wearing a number instead of a NULL,
    // and every reader downstream treats NULL as "never recorded".
    const db = await getDatabase();
    await atVersionNineteenWithFlatLoan(db);
    await runMigrations(db);

    await expect(
      db.runAsync("UPDATE loans SET amount_borrowed = 0 WHERE id = ?", [V19_FLAT_LOAN_ID]),
    ).rejects.toThrow(/CHECK/i);
    await expect(
      db.runAsync("UPDATE loans SET amount_borrowed = -1 WHERE id = ?", [V19_FLAT_LOAN_ID]),
    ).rejects.toThrow(/CHECK/i);

    await db.runAsync("UPDATE loans SET amount_borrowed = NULL WHERE id = ?", [V19_FLAT_LOAN_ID]);
    const row = await db.getFirstAsync<{ borrowed: number | null }>(
      "SELECT amount_borrowed AS borrowed FROM loans WHERE id = ?",
      [V19_FLAT_LOAN_ID],
    );
    expect(row?.borrowed).toBeNull();
  });

  test("every shipped version ends up recorded, and a further run applies nothing", async () => {
    // The exactly-once guard is what keeps a second launch from crashing:
    // re-running `ALTER TABLE ... ADD COLUMN` throws "duplicate column name".
    const db = await getDatabase();
    await atVersionNineteenWithFlatLoan(db);
    await runMigrations(db);

    const recorded = await db.getAllAsync<{ version: number; name: string }>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    );
    expect(recorded).toEqual(MIGRATIONS.map((m) => ({ version: m.version, name: m.name })));
    expect(await runMigrations(db)).toEqual([]);
    expect((await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM loans"))?.n).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 021_raw_notification_body_discarded: the minimal record (GAP-107, owner
// decision 2026-09-09). `raw_notifications` gains one nullable column. A row
// already on the device keeps its text and reads NULL, because nothing about
// it was discarded; the recovery sweep strips such a row later only if the
// router still calls it not money-related.
// ---------------------------------------------------------------------------
describe("021_raw_notification_body_discarded upgrades a real version-20 database in place", () => {
  /** Brings a database to 020 and seeds a capture the old drain stored whole. */
  async function atVersionTwentyWithCapture(
    db: Awaited<ReturnType<typeof getDatabase>>,
  ): Promise<void> {
    const upToTwenty = MIGRATIONS.filter((m) => m.version <= 20);
    expect(upToTwenty.length).toBe(20);
    await runMigrations(db, upToTwenty);

    await db.runAsync(
      `INSERT INTO raw_notifications (id, package_name, title, text, sub_text, big_text,
         posted_at, captured_at, expires_at, notification_key)
       VALUES ('cap_v20', 'com.friend.chat', 'Ana', 'Kain tayo mamaya!', NULL, NULL, ?, ?, ?, NULL)`,
      [V1_TIMESTAMP, V1_TIMESTAMP, V1_TIMESTAMP + 30 * 24 * 60 * 60 * 1000],
    );
  }

  test("a database at 020, already holding a capture, gains the column and keeps the text", async () => {
    const db = await getDatabase();
    await atVersionTwentyWithCapture(db);

    const before = await db.getAllAsync<{ name: string }>("PRAGMA table_info(raw_notifications)");
    expect(before.map((c) => c.name)).not.toContain("body_discarded_at");

    const applied = await runMigrations(db);
    expect(applied[0]).toBe(21);
    expect(applied).toEqual(MIGRATIONS.filter((m) => m.version > 20).map((m) => m.version));

    const after = await db.getAllAsync<{ name: string }>("PRAGMA table_info(raw_notifications)");
    expect(after.map((c) => c.name)).toContain("body_discarded_at");

    const row = await db.getFirstAsync<{ text: string | null; body_discarded_at: number | null }>(
      "SELECT text, body_discarded_at FROM raw_notifications WHERE id = 'cap_v20'",
    );
    expect(row).toEqual({ text: "Kain tayo mamaya!", body_discarded_at: null });
  });

  test("a row marked discarded cannot carry text, and one with text cannot be marked", async () => {
    const db = await getDatabase();
    await atVersionTwentyWithCapture(db);
    await runMigrations(db);

    await expect(
      db.runAsync("UPDATE raw_notifications SET body_discarded_at = ? WHERE id = 'cap_v20'", [
        V1_TIMESTAMP,
      ]),
    ).rejects.toThrow(/CHECK/i);
    await expect(
      db.runAsync(
        `INSERT INTO raw_notifications (id, package_name, title, text, sub_text, big_text,
           posted_at, captured_at, expires_at, notification_key, body_discarded_at)
         VALUES ('cap_new', 'com.friend.chat', NULL, NULL, NULL, NULL, ?, ?, ?, 'com.friend.chat|7|x|0', ?)`,
        [V1_TIMESTAMP, V1_TIMESTAMP, V1_TIMESTAMP, V1_TIMESTAMP],
      ),
    ).rejects.toThrow(/CHECK/i);
  });
});
