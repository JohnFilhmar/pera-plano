import { closeDatabase } from "../database";
import { runMigrations } from "../migrations";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "expo-sqlite";

const EXPECTED_TABLES = [
  "app_settings", "bill_payments", "bills", "categories", "goals",
  "income_profile_sources", "income_profiles", "limits", "loan_payments",
  "loans", "parser_rulesets", "raw_notifications", "recurring_patterns",
  "review_queue_items", "transactions", "transfer_links", "user_rules",
  "wallet_matchers", "wallets",
];

afterEach(async () => {
  await closeDatabase();
});

test("001_core creates exactly the 19 contract tables", async () => {
  const db = await freshDb();
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  expect(rows.map((r) => r.name)).toEqual(EXPECTED_TABLES);
  expect(EXPECTED_TABLES).toHaveLength(19);
});

test("transactions has the exact contract §3 columns in order", async () => {
  const db = await freshDb();
  const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transactions)");
  expect(cols.map((c) => c.name)).toEqual([
    "id", "wallet_id", "category_id", "amount", "direction", "occurred_at",
    "merchant", "counterparty", "reference_no", "source", "confidence",
    "raw_notification_id", "transfer_link_id", "note", "created_at", "updated_at",
  ]);
});

test("review_queue_items and raw_notifications match contract §3 columns", async () => {
  const db = await freshDb();
  const rq = await db.getAllAsync<{ name: string }>("PRAGMA table_info(review_queue_items)");
  expect(rq.map((c) => c.name)).toEqual([
    "id", "kind", "payload_json", "raw_notification_id", "created_at", "expires_at", "resolved_at",
  ]);
  const rn = await db.getAllAsync<{ name: string }>("PRAGMA table_info(raw_notifications)");
  expect(rn.map((c) => c.name)).toEqual([
    "id", "package_name", "title", "text", "sub_text", "big_text", "posted_at", "captured_at", "expires_at",
  ]);
});

test("transfer_links carries the contract §3 pinned columns", async () => {
  const db = await freshDb();
  const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transfer_links)");
  const names = cols.map((c) => c.name);
  for (const required of ["id", "out_transaction_id", "in_transaction_id", "fee_amount", "status"]) {
    expect(names).toContain(required);
  }
});

test("foreign keys are enforced", async () => {
  const db = await freshDb();
  await expect(
    db.runAsync(
      "INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, source, confidence, created_at, updated_at) VALUES ('t1', 'missing_wallet', 'missing_category', 100, 'out', 0, 'manual', 1.0, 0, 0)",
    ),
  ).rejects.toThrow(/FOREIGN KEY/i);
});

test("CHECK constraints reject non-positive amounts and bad enums (invariant I6)", async () => {
  const db = await freshDb();
  const now = Date.now();
  await db.runAsync(
    "INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at) VALUES ('w1', 'GCash', 'e-wallet', 0, 'PHP', 0, ?, ?)",
    [now, now],
  );
  await db.runAsync(
    "INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at) VALUES ('c1', 'Uncategorized', NULL, 'circle-help', 1, 0, ?, ?)",
    [now, now],
  );
  await expect(
    db.runAsync(
      "INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, source, confidence, created_at, updated_at) VALUES ('t1', 'w1', 'c1', 0, 'out', 0, 'manual', 1.0, 0, 0)",
    ),
  ).rejects.toThrow(/CHECK/i);
  await expect(
    db.runAsync(
      "INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at) VALUES ('w2', 'Bad', 'checking', 0, 'PHP', 0, 0, 0)",
    ),
  ).rejects.toThrow(/CHECK/i);
});

// ---------------------------------------------------------------------------
// Discriminating suite below. The tests above (verbatim from the task brief)
// prove the schema exists with the right shape; the tests below prove every
// constraint the contract implies is actually load-bearing — each is designed
// so a plausible broken implementation (dropped REFERENCES, dropped NOT NULL,
// INTEGER swapped for REAL, dropped UNIQUE) fails it for a specific reason.
// ---------------------------------------------------------------------------

type Row = Record<string, string | number | null>;

/** Build a parameterized INSERT from a plain row object and run it. */
function insertRow(db: SQLiteDatabase, table: string, row: Row) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const values = columns.map((c) => row[c]);
  return db.runAsync(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
    values,
  );
}

type SeedIds = {
  walletId: string;
  categoryId: string;
  rawNotificationId: string;
  outTxId: string;
  inTxId: string;
  freeTxId: string;
  freeTxId2: string;
  freeTxId3: string;
  transferLinkId: string;
  incomeProfileId: string;
  loanId: string;
  billId: string;
};

/** Seeds one valid parent row per referenceable table. Returns their ids for use by VALID_ROWS. */
async function seedParents(db: SQLiteDatabase): Promise<SeedIds> {
  const now = Date.now();
  const ids: SeedIds = {
    walletId: "seed_wallet",
    categoryId: "seed_category",
    rawNotificationId: "seed_raw_notification",
    outTxId: "seed_tx_out",
    inTxId: "seed_tx_in",
    freeTxId: "seed_tx_free_1",
    freeTxId2: "seed_tx_free_2",
    freeTxId3: "seed_tx_free_3",
    transferLinkId: "seed_transfer_link",
    incomeProfileId: "seed_income_profile",
    loanId: "seed_loan",
    billId: "seed_bill",
  };

  await insertRow(db, "wallets", {
    id: ids.walletId, name: "Seed Wallet", type: "cash", balance: 0,
    currency: "PHP", is_archived: 0, created_at: now, updated_at: now,
  });
  await insertRow(db, "categories", {
    id: ids.categoryId, name: "Seed Category", parent_id: null, icon: "circle",
    is_system: 0, is_hidden: 0, created_at: now, updated_at: now,
  });
  await insertRow(db, "raw_notifications", {
    id: ids.rawNotificationId, package_name: "com.example", title: null, text: null,
    sub_text: null, big_text: null, posted_at: now, captured_at: now, expires_at: now,
  });
  for (const txId of [ids.outTxId, ids.inTxId, ids.freeTxId, ids.freeTxId2, ids.freeTxId3]) {
    await insertRow(db, "transactions", {
      id: txId, wallet_id: ids.walletId, category_id: ids.categoryId, amount: 100,
      direction: "out", occurred_at: now, merchant: null, counterparty: null,
      reference_no: null, source: "manual", confidence: 1.0, raw_notification_id: null,
      transfer_link_id: null, note: null, created_at: now, updated_at: now,
    });
  }
  await insertRow(db, "transfer_links", {
    id: ids.transferLinkId, out_transaction_id: ids.outTxId, in_transaction_id: ids.inTxId,
    fee_amount: 0, status: "active", detected_by: "manual", confidence: 1.0,
    created_at: now, updated_at: now,
  });
  await insertRow(db, "income_profiles", {
    id: ids.incomeProfileId, cadence: "monthly", average_amount: null,
    is_manual_override: 0, created_at: now, updated_at: now,
  });
  await insertRow(db, "loans", {
    id: ids.loanId, direction: "i-owe", counterparty: "Someone", principal: 1000,
    interest_rate: null, schedule_json: null, linked_wallet_id: null,
    next_due_date: null, next_due_amount: null, created_at: now, updated_at: now,
  });
  await insertRow(db, "bills", {
    id: ids.billId, name: "Seed Bill", amount: 1000, amount_mode: "fixed",
    due_rule_json: "{}", reminder_offsets_json: "[]", auto_match_rule_json: null,
    category_id: ids.categoryId, created_at: now, updated_at: now,
  });

  return ids;
}

/** A template of a fully valid, freshly-insertable row for every one of the 19 tables. */
function buildValidRows(ids: SeedIds, now: number): Record<string, Row> {
  return {
    wallets: {
      id: "row_wallets", name: "Test Wallet", type: "cash", balance: 0,
      currency: "PHP", is_archived: 0, created_at: now, updated_at: now,
    },
    wallet_matchers: {
      id: "row_wallet_matchers", wallet_id: ids.walletId, package_name: "com.example",
      hint: null, created_at: now, updated_at: now,
    },
    categories: {
      id: "row_categories", name: "Test Category", parent_id: null, icon: "circle",
      is_system: 0, is_hidden: 0, created_at: now, updated_at: now,
    },
    raw_notifications: {
      id: "row_raw_notifications", package_name: "com.example", title: null, text: null,
      sub_text: null, big_text: null, posted_at: now, captured_at: now, expires_at: now,
    },
    transactions: {
      id: "row_transactions", wallet_id: ids.walletId, category_id: ids.categoryId,
      amount: 100, direction: "out", occurred_at: now, merchant: null, counterparty: null,
      reference_no: null, source: "manual", confidence: 1.0, raw_notification_id: null,
      transfer_link_id: null, note: null, created_at: now, updated_at: now,
    },
    transfer_links: {
      id: "row_transfer_links", out_transaction_id: ids.outTxId, in_transaction_id: ids.inTxId,
      fee_amount: 0, status: "active", detected_by: "manual", confidence: 1.0,
      created_at: now, updated_at: now,
    },
    limits: {
      id: "row_limits", scope: "monthly", basis: "fixed", value: 1000,
      category_filter_json: null, wallet_filter_json: null, rollover: 0, is_active: 1,
      thresholds_fired_json: "[]", created_at: now, updated_at: now,
    },
    income_profiles: {
      id: "row_income_profiles", cadence: "monthly", average_amount: null,
      is_manual_override: 0, created_at: now, updated_at: now,
    },
    income_profile_sources: {
      id: "row_income_profile_sources", income_profile_id: ids.incomeProfileId,
      wallet_id: ids.walletId, created_at: now, updated_at: now,
    },
    goals: {
      id: "row_goals", name: "Test Goal", target_amount: 1000, target_date: null,
      linked_wallet_id: ids.walletId, contribution_rule_json: null, created_at: now, updated_at: now,
    },
    loans: {
      id: "row_loans", direction: "i-owe", counterparty: "Someone", principal: 1000,
      interest_rate: null, schedule_json: null, linked_wallet_id: null,
      next_due_date: null, next_due_amount: null, created_at: now, updated_at: now,
    },
    loan_payments: {
      id: "row_loan_payments", loan_id: ids.loanId, transaction_id: ids.freeTxId,
      created_at: now, updated_at: now,
    },
    bills: {
      id: "row_bills", name: "Test Bill", amount: 1000, amount_mode: "fixed",
      due_rule_json: "{}", reminder_offsets_json: "[]", auto_match_rule_json: null,
      category_id: ids.categoryId, created_at: now, updated_at: now,
    },
    bill_payments: {
      id: "row_bill_payments", bill_id: ids.billId, transaction_id: ids.freeTxId2,
      cycle_due_date: "2026-08-01", created_at: now, updated_at: now,
    },
    recurring_patterns: {
      id: "row_recurring_patterns", merchant: "Netflix", amount: 500, period: "monthly",
      confidence: 0.9, acknowledged: 0, created_at: now, updated_at: now,
    },
    user_rules: {
      id: "row_user_rules", matcher_json: "{}", action_json: "{}", priority: 1,
      is_enabled: 1, created_from: null, applied_count: 0, last_applied_at: null,
      created_at: now, updated_at: now,
    },
    review_queue_items: {
      id: "row_review_queue_items", kind: "low-confidence", payload_json: "{}",
      raw_notification_id: null, created_at: now, expires_at: null, resolved_at: null,
    },
    parser_rulesets: {
      id: "row_parser_rulesets", version: 999, payload_json: "{}", installed_at: now,
    },
    app_settings: {
      id: "row_app_settings", key: "test_key_unique", value_json: "{}", updated_at: now,
    },
  };
}

let db: SQLiteDatabase;
let ids: SeedIds;
let validRows: Record<string, Row>;

beforeEach(async () => {
  db = await freshDb();
  ids = await seedParents(db);
  validRows = buildValidRows(ids, Date.now());
});

describe("every valid template row actually inserts", () => {
  // Sanity check for the templates themselves: if a template were subtly invalid, every
  // NOT NULL / FK test built from it below would fail for the wrong reason (fixture
  // rather than the field under test), silently passing without discriminating anything.
  test.each(EXPECTED_TABLES)("%s valid row inserts cleanly", async (table) => {
    await expect(insertRow(db, table, validRows[table])).resolves.toBeDefined();
  });
});

describe("foreign keys are enforced on every FK column in the schema", () => {
  const FK_COLUMNS: Array<{ table: string; column: string }> = [
    { table: "wallet_matchers", column: "wallet_id" },
    { table: "categories", column: "parent_id" },
    { table: "transactions", column: "wallet_id" },
    { table: "transactions", column: "category_id" },
    { table: "transactions", column: "raw_notification_id" },
    { table: "transactions", column: "transfer_link_id" },
    { table: "transfer_links", column: "out_transaction_id" },
    { table: "transfer_links", column: "in_transaction_id" },
    { table: "income_profile_sources", column: "income_profile_id" },
    { table: "income_profile_sources", column: "wallet_id" },
    { table: "goals", column: "linked_wallet_id" },
    { table: "loans", column: "linked_wallet_id" },
    { table: "loan_payments", column: "loan_id" },
    { table: "loan_payments", column: "transaction_id" },
    { table: "bills", column: "category_id" },
    { table: "bill_payments", column: "bill_id" },
    { table: "bill_payments", column: "transaction_id" },
    { table: "review_queue_items", column: "raw_notification_id" },
  ];

  test.each(FK_COLUMNS.map(({ table, column }) => [table, column]))(
    "%s.%s rejects a reference to a nonexistent row",
    async (table, column) => {
      const row = { ...validRows[table], [column]: "does-not-exist" };
      await expect(insertRow(db, table, row)).rejects.toThrow(/FOREIGN KEY/i);
    },
  );
});

describe("NOT NULL is enforced on every required column in the schema", () => {
  const NOT_NULL_COLUMNS: Array<{ table: string; column: string }> = [
    ...["id", "name", "type", "balance", "currency", "is_archived", "created_at", "updated_at"]
      .map((column) => ({ table: "wallets", column })),
    ...["id", "wallet_id", "package_name", "created_at", "updated_at"]
      .map((column) => ({ table: "wallet_matchers", column })),
    ...["id", "name", "icon", "is_system", "is_hidden", "created_at", "updated_at"]
      .map((column) => ({ table: "categories", column })),
    ...["id", "package_name", "posted_at", "captured_at", "expires_at"]
      .map((column) => ({ table: "raw_notifications", column })),
    ...["id", "wallet_id", "category_id", "amount", "direction", "occurred_at", "source", "confidence", "created_at", "updated_at"]
      .map((column) => ({ table: "transactions", column })),
    ...["id", "out_transaction_id", "in_transaction_id", "fee_amount", "status", "detected_by", "confidence", "created_at", "updated_at"]
      .map((column) => ({ table: "transfer_links", column })),
    ...["id", "scope", "basis", "value", "rollover", "is_active", "thresholds_fired_json", "created_at", "updated_at"]
      .map((column) => ({ table: "limits", column })),
    ...["id", "cadence", "is_manual_override", "created_at", "updated_at"]
      .map((column) => ({ table: "income_profiles", column })),
    ...["id", "income_profile_id", "wallet_id", "created_at", "updated_at"]
      .map((column) => ({ table: "income_profile_sources", column })),
    ...["id", "name", "target_amount", "linked_wallet_id", "created_at", "updated_at"]
      .map((column) => ({ table: "goals", column })),
    ...["id", "direction", "counterparty", "principal", "created_at", "updated_at"]
      .map((column) => ({ table: "loans", column })),
    ...["id", "loan_id", "transaction_id", "created_at", "updated_at"]
      .map((column) => ({ table: "loan_payments", column })),
    ...["id", "name", "amount", "amount_mode", "due_rule_json", "reminder_offsets_json", "category_id", "created_at", "updated_at"]
      .map((column) => ({ table: "bills", column })),
    ...["id", "bill_id", "transaction_id", "cycle_due_date", "created_at", "updated_at"]
      .map((column) => ({ table: "bill_payments", column })),
    ...["id", "merchant", "amount", "period", "confidence", "acknowledged", "created_at", "updated_at"]
      .map((column) => ({ table: "recurring_patterns", column })),
    ...["id", "matcher_json", "action_json", "priority", "is_enabled", "applied_count", "created_at", "updated_at"]
      .map((column) => ({ table: "user_rules", column })),
    ...["id", "kind", "payload_json", "created_at"]
      .map((column) => ({ table: "review_queue_items", column })),
    ...["id", "version", "payload_json", "installed_at"]
      .map((column) => ({ table: "parser_rulesets", column })),
    ...["id", "key", "value_json", "updated_at"]
      .map((column) => ({ table: "app_settings", column })),
  ];

  test.each(NOT_NULL_COLUMNS.map(({ table, column }) => [table, column]))(
    "%s.%s rejects an explicit NULL",
    async (table, column) => {
      const row = { ...validRows[table], [column]: null };
      await expect(insertRow(db, table, row)).rejects.toThrow(/NOT NULL/i);
    },
  );
});

describe("UNIQUE constraints are enforced", () => {
  test("loan_payments.transaction_id rejects a second loan payment for the same transaction", async () => {
    await insertRow(db, "loan_payments", { ...validRows.loan_payments, id: "lp1" });
    await expect(
      insertRow(db, "loan_payments", { ...validRows.loan_payments, id: "lp2" }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("bill_payments.transaction_id rejects a second bill payment for the same transaction, even under a different cycle", async () => {
    await insertRow(db, "bill_payments", { ...validRows.bill_payments, id: "bp1" });
    await expect(
      insertRow(db, "bill_payments", {
        ...validRows.bill_payments, id: "bp2", cycle_due_date: "2026-09-01",
      }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("bill_payments rejects a duplicate (bill_id, cycle_due_date), even for a different transaction", async () => {
    await insertRow(db, "bill_payments", { ...validRows.bill_payments, id: "bp1" });
    await expect(
      insertRow(db, "bill_payments", {
        ...validRows.bill_payments, id: "bp3", transaction_id: ids.freeTxId3,
      }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("income_profile_sources rejects a duplicate (income_profile_id, wallet_id)", async () => {
    await insertRow(db, "income_profile_sources", { ...validRows.income_profile_sources, id: "ips1" });
    await expect(
      insertRow(db, "income_profile_sources", { ...validRows.income_profile_sources, id: "ips2" }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("parser_rulesets.version rejects a duplicate version", async () => {
    await insertRow(db, "parser_rulesets", { ...validRows.parser_rulesets, id: "pr1" });
    await expect(
      insertRow(db, "parser_rulesets", { ...validRows.parser_rulesets, id: "pr2" }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("app_settings.key rejects a duplicate key", async () => {
    await insertRow(db, "app_settings", { ...validRows.app_settings, id: "as1" });
    await expect(
      insertRow(db, "app_settings", { ...validRows.app_settings, id: "as2" }),
    ).rejects.toThrow(/UNIQUE/i);
  });
});

describe("money columns hold exact integer centavos, never REAL", () => {
  // ₱10,000,000.00 as integer centavos. If a column were declared REAL, SQLite's type
  // affinity would coerce this stored value to a floating-point representation, and
  // typeof() would report 'real' instead of 'integer' on readback — that is the failure
  // this test is built to catch (plain equality alone would not: JS numbers this size
  // round-trip exactly through REAL too, so it would not discriminate).
  const LARGE_CENTAVOS = 1_000_000_000;

  const MONEY_COLUMNS: Array<{ table: string; column: string }> = [
    { table: "wallets", column: "balance" },
    { table: "transactions", column: "amount" },
    { table: "transfer_links", column: "fee_amount" },
    { table: "limits", column: "value" },
    { table: "goals", column: "target_amount" },
    { table: "loans", column: "principal" },
    { table: "bills", column: "amount" },
    { table: "recurring_patterns", column: "amount" },
  ];

  test.each(MONEY_COLUMNS.map(({ table, column }) => [table, column]))(
    "%s.%s round-trips a large centavo value with integer affinity",
    async (table, column) => {
      const row = { ...validRows[table], [column]: LARGE_CENTAVOS };
      await insertRow(db, table, row);
      const result = await db.getFirstAsync<{ value: number; kind: string }>(
        `SELECT ${column} AS value, typeof(${column}) AS kind FROM ${table} WHERE id = ?`,
        [row.id as string],
      );
      expect(result?.value).toBe(LARGE_CENTAVOS);
      expect(result?.kind).toBe("integer");
    },
  );
});

describe("runMigrations stays exactly-once with the real 001_core migration registered", () => {
  test("a second run applies nothing and does not error on already-existing tables", async () => {
    // freshDb() already ran the full registry once; call it again directly.
    const second = await runMigrations(db);
    expect(second).toEqual([]);
    // And the schema is still fully usable — no partial re-creation damage.
    const tables = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.map((t) => t.name)).toEqual(EXPECTED_TABLES);
  });
});
