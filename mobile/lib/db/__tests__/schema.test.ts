import { closeDatabase } from "../database";
import { runMigrations } from "../migrations";
import { freshDb } from "@/test_support/db";
import type { SQLiteDatabase } from "../database";

/** The nineteen tables 001_core creates (interface contract §3). */
const CORE_TABLES = [
  "app_settings", "bill_payments", "bills", "categories", "goals",
  "income_profile_sources", "income_profiles", "limits", "loan_payments",
  "loans", "parser_rulesets", "raw_notifications", "recurring_patterns",
  "review_queue_items", "transactions", "transfer_links", "user_rules",
  "wallet_matchers", "wallets",
];

/**
 * Tables added by later migrations. Kept SEPARATE from `CORE_TABLES` rather
 * than merged into it, because the contract's nineteen is a fact about
 * 001_core specifically — folding a later table in would quietly redefine what
 * the assertion below is claiming.
 *
 * m2b Task 5 adds `loan_adjustments` (migration 005); m2c Task 1 adds
 * `bill_cycles` (migration 006); m3b Task 7 adds `parse_stats` (migration 009);
 * 013_wallet_traits adds `wallet_trait_evidence`, the running scores behind the
 * held/owed verdict that replaced the onboarding wallet-type question.
 */
const MIGRATED_TABLES = [
  "bill_cycles",
  "loan_adjustments",
  "parse_stats",
  "wallet_trait_evidence",
  // 015_support_reports adds the offline problem-report outbox and the media
  // attached to each report — the only tables in this schema that hold text
  // the user typed for someone else to read.
  "support_reports",
  "support_report_attachments",
];

const EXPECTED_TABLES = [...CORE_TABLES, ...MIGRATED_TABLES].sort();

afterEach(async () => {
  await closeDatabase();
});

test("the schema holds the 19 contract tables plus every later migration's", async () => {
  const db = await freshDb();
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'schema_migrations' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  expect(rows.map((r) => r.name)).toEqual(EXPECTED_TABLES);
  // The contract's own count, asserted against the core list alone so a later
  // migration cannot inflate it.
  expect(CORE_TABLES).toHaveLength(19);
});

test("transactions has the exact contract §3 columns in order, with 002's pair appended after them", async () => {
  const db = await freshDb();
  const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(transactions)");
  expect(cols.map((c) => c.name)).toEqual([
    "id", "wallet_id", "category_id", "amount", "direction", "occurred_at",
    "merchant", "counterparty", "reference_no", "source", "confidence",
    "raw_notification_id", "transfer_link_id", "note", "created_at", "updated_at",
    // 002_balance_after (m1c Task 3b). APPENDED, never interleaved: SQLite's
    // ALTER TABLE ADD COLUMN can only add at the end, so all sixteen contract §3
    // columns keep their exact positions — which is the assertion above still
    // being written out in full rather than sliced.
    "balance_after", "computed_balance",
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
    "INSERT INTO wallets (id, name, balance, currency, is_archived, created_at, updated_at) VALUES ('w1', 'GCash', 0, 'PHP', 0, ?, ?)",
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
  // The wallet half of this test used to insert `type: 'checking'` and expect
  // the CHECK constraint on `wallets.type` to reject it. That column — and its
  // five-value enum — is gone (014_drop_wallet_type.sql): the app stopped asking
  // what kind of wallet this is, and infers the one thing that mattered instead.
  // What replaced it is not a CHECK but a NOT NULL default, asserted here so the
  // rebuild cannot quietly ship a nullable column.
  const traits = await db.getAllAsync<{ name: string; notnull: number; dflt_value: string | null }>(
    "PRAGMA table_info(wallets)",
  );
  for (const column of ["owed_balance", "owed_pinned"]) {
    const found = traits.find((candidate) => candidate.name === column);
    expect(found?.notnull).toBe(1);
    expect(found?.dflt_value).toBe("0");
  }
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
  supportReportId: string;
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
    supportReportId: "seed_support_report",
  };

  await insertRow(db, "wallets", {
    id: ids.walletId, name: "Seed Wallet", balance: 0,
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
  await insertRow(db, "support_reports", {
    id: ids.supportReportId, title: "Seed report", description: "Seeded for the FK below.",
    topic: "other", status: "queued", attempt_count: 0, next_attempt_at: now,
    last_error: null, created_at: now, updated_at: now, sent_at: null, ticket_ref: null,
  });

  return ids;
}

/** A template of a fully valid, freshly-insertable row for every one of the 19 tables. */
function buildValidRows(ids: SeedIds, now: number): Record<string, Row> {
  return {
    wallets: {
      id: "row_wallets", name: "Test Wallet", balance: 0,
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
      next_due_date: null, next_due_amount: null, reminder_offsets_json: "[-3,0,3]",
      created_at: now, updated_at: now,
    },
    loan_payments: {
      id: "row_loan_payments", loan_id: ids.loanId, transaction_id: ids.freeTxId,
      created_at: now, updated_at: now,
    },
    // migration 005. `amount` is SIGNED — an adjustment can increase what is
    // owed (accrued interest, a penalty) or reduce it (a lender-side
    // correction) — so unlike every other money column here it carries no
    // CHECK. `note` is NOT NULL by loans rule 13.
    loan_adjustments: {
      id: "row_loan_adjustments", loan_id: ids.loanId, amount: -5000,
      occurred_at: now, note: "Lender waived a fee", created_at: now, updated_at: now,
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
    // migration 006. A resolved cycle that is NOT paid — the spec's skip — so
    // this row also exercises the CHECK tying `state = 'paid'` to a non-null
    // `bill_payment_id`, from the side that must be null.
    bill_cycles: {
      id: "row_bill_cycles", bill_id: ids.billId, due_date: "2026-08-01",
      state: "skipped", bill_payment_id: null, overdue_notices_sent: 0,
      resolved_at: now, created_at: now, updated_at: now,
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
    // migration 009. Content-free by construction — see that migration's
    // header — so the template deliberately has nowhere to put a merchant or
    // an amount even as a fixture.
    parse_stats: {
      id: "row_parse_stats", provider_key: "gcash", day_start_at: now,
      parsed_count: 1, failed_count: 0, updated_at: now,
    },
    // migration 013. Keyed BY the wallet rather than by an id of its own: a
    // wallet has exactly one running score, and the primary key says so.
    wallet_trait_evidence: {
      wallet_id: ids.walletId, owed_score: 250, held_score: 0,
      sample_count: 1, updated_at: now,
    },
    // migration 015. `status` is 'queued' | 'sent' | 'rejected' and there is no
    // in-flight value — see types/support.ts for why an OS kill must not be
    // able to strand a row mid-send. `next_attempt_at` is an absolute instant,
    // not a delay.
    support_reports: {
      id: "row_support_reports", title: "Transfers show up twice",
      description: "Both legs landed as spending.", topic: "wrong_amount_or_wallet",
      status: "queued", attempt_count: 0, next_attempt_at: now, last_error: null,
      created_at: now, updated_at: now, sent_at: null, ticket_ref: null,
    },
    // migration 015. Stores a PATH, never the bytes — screenshots are hundreds
    // of kilobytes each and this database is opened and keyed on every cold
    // start.
    support_report_attachments: {
      id: "row_support_report_attachments", report_id: ids.supportReportId,
      file_uri: "file:///docs/support_attachments/a.png", mime_type: "image/png",
      byte_size: 1024, created_at: now,
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
    { table: "support_report_attachments", column: "report_id" },
  ];

  test.each(FK_COLUMNS.map(({ table, column }) => [table, column]))(
    "%s.%s rejects a reference to a nonexistent row",
    async (table, column) => {
      const row = { ...validRows[table], [column]: "does-not-exist" };
      await expect(insertRow(db, table, row)).rejects.toThrow(/FOREIGN KEY/i);
    },
  );
});

describe("referential integrity is enforced on delete, not just on insert (invariant I4)", () => {
  // The FK-insert tests above prove a child can't be created pointing at a nonexistent
  // parent. They say nothing about whether an existing parent can be deleted out from
  // under an existing child. SQLite's default FK action is NO ACTION (block the delete),
  // but that default is silently lost the moment someone adds `ON DELETE CASCADE` (or
  // SET NULL) to "clean up" a relationship — which would orphan-by-deletion instead of
  // orphan-by-insert. Invariant I4 ("no orphan transactions") requires the delete to fail.
  test("deleting a wallet referenced by a transaction is rejected", async () => {
    // Uses a dedicated wallet, not the shared seeded one: the seeded wallet already backs
    // several of seedParents()'s own transactions, two of which are transfer-link legs —
    // deleting it could fail via that unrelated transfer_links restriction and still look
    // green even if transactions.wallet_id itself had no delete protection at all. A
    // fresh, otherwise-unreferenced wallet isolates the one relationship under test.
    const now = Date.now();
    await insertRow(db, "wallets", {
      id: "wallet_to_delete", name: "Guarded Wallet", balance: 0,
      currency: "PHP", is_archived: 0, created_at: now, updated_at: now,
    });
    await insertRow(db, "transactions", {
      ...validRows.transactions, id: "tx_guard", wallet_id: "wallet_to_delete",
    });
    await expect(
      db.runAsync("DELETE FROM wallets WHERE id = ?", ["wallet_to_delete"]),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

describe("NOT NULL is enforced on every required column in the schema", () => {
  const NOT_NULL_COLUMNS: Array<{ table: string; column: string }> = [
    // `type` is gone (014_drop_wallet_type.sql); `owed_balance` and
    // `owed_pinned` arrived with 013 and are NOT NULL for the same reason every
    // other flag here is — a NULL would read as neither true nor false to the
    // code that decides whether a balance counts toward the user's total.
    ...[
      "id",
      "name",
      "balance",
      "currency",
      "is_archived",
      "owed_balance",
      "owed_pinned",
      "created_at",
      "updated_at",
    ].map((column) => ({ table: "wallets", column })),
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
    // reminder_offsets_json (migration 008): NOT NULL DEFAULT '[-3,0,3]' — the
    // one column here whose NOT NULL is backed by a DEFAULT rather than always
    // being supplied by the caller, so this is the assertion that an explicit
    // NULL is still rejected regardless.
    ...["id", "direction", "counterparty", "principal", "reminder_offsets_json", "created_at", "updated_at"]
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
    ...["id", "provider_key", "day_start_at", "parsed_count", "failed_count", "updated_at"]
      .map((column) => ({ table: "parse_stats", column })),
    // `last_error`, `sent_at` and `ticket_ref` are deliberately absent: all
    // three are null for the whole life of a report that sends first time.
    ...["id", "title", "description", "topic", "status", "attempt_count", "next_attempt_at", "created_at", "updated_at"]
      .map((column) => ({ table: "support_reports", column })),
    ...["id", "report_id", "file_uri", "mime_type", "byte_size", "created_at"]
      .map((column) => ({ table: "support_report_attachments", column })),
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

  test("parse_stats rejects a duplicate (provider_key, day_start_at) — one bucket per provider per day", async () => {
    await insertRow(db, "parse_stats", { ...validRows.parse_stats, id: "ps1" });
    await expect(
      insertRow(db, "parse_stats", { ...validRows.parse_stats, id: "ps2" }),
    ).rejects.toThrow(/UNIQUE/i);
  });

  test("goals.linked_wallet_id rejects a second goal linked to an already-linked wallet (invariant I10)", async () => {
    // A savings wallet backs at most one Goal — otherwise the same pesos would count
    // toward two targets. The repository-layer check planned for Task 8 is a
    // read-then-write and can be raced by two concurrent createGoal calls; only a DB
    // constraint is race-proof, so this is enforced here rather than deferred.
    await insertRow(db, "goals", { ...validRows.goals, id: "g1" });
    await expect(
      insertRow(db, "goals", { ...validRows.goals, id: "g2" }),
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
    // 002_balance_after's pair are money columns like any other — an
    // ALTER TABLE that typed them REAL would round the provider's own figure.
    { table: "transactions", column: "balance_after" },
    { table: "transactions", column: "computed_balance" },
    { table: "transfer_links", column: "fee_amount" },
    { table: "limits", column: "value" },
    { table: "goals", column: "target_amount" },
    { table: "loans", column: "principal" },
    { table: "loans", column: "next_due_amount" },
    { table: "bills", column: "amount" },
    { table: "recurring_patterns", column: "amount" },
    { table: "income_profiles", column: "average_amount" },
  ];

  test.each(MONEY_COLUMNS.map(({ table, column }) => [table, column]))(
    "%s.%s round-trips a large centavo value with integer affinity",
    async (table, column) => {
      // next_due_amount and average_amount are nullable and null in the seed template —
      // override explicitly so the assertion below exercises a real stored value, not null.
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
