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
    // 001 IS NOT IN THIS LIST. A leading `1` would mean 001 was replayed over
    // live data; every later version is simply everything that has shipped since.
    expect(applied).toEqual([2, 3, 4, 5]);

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
    expect(recorded).toEqual([
      { version: 1, name: "core" },
      { version: 2, name: "balance_after" },
      { version: 3, name: "drift_dismissal" },
      { version: 4, name: "limit_alert_state" },
      { version: 5, name: "loan_adjustments" },
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
    expect(await runMigrations(db)).toEqual([3, 4, 5]);

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
      type: "e-wallet",
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
    expect(recorded).toEqual([
      { version: 1, name: "core" },
      { version: 2, name: "balance_after" },
      { version: 3, name: "drift_dismissal" },
      { version: 4, name: "limit_alert_state" },
      { version: 5, name: "loan_adjustments" },
    ]);

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

    expect(await runMigrations(db)).toEqual([4, 5]);

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
