// lib/privacy/__tests__/data_wipe.test.ts — m3b Task 6 Step 2, plus the
// coordinator's own addition: prove the wipe empties EVERY table by reading
// each one back, not by trusting a hand-written list (see data_wipe.ts's
// header for why a hand-written list is exactly the failure this guards
// against).
//
// `modules/notification_listener` is a native module and cannot be required
// under Jest — mocked here the same way app/__tests__/home_screen.test.tsx
// mocks it.
jest.mock("@/modules/notification_listener", () => ({
  clearCaptureBuffer: jest.fn().mockResolvedValue(undefined),
}));

import AsyncStorage from "@react-native-async-storage/async-storage";

import { closeDatabase } from "@/lib/db/database";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import { freshDb } from "@/test_support/db";
import { clearCaptureBuffer } from "@/modules/notification_listener";
import { THEME_STORAGE_KEY } from "@/contexts/theme_context";
import { listWipeableTables, wipeAllData } from "../data_wipe";
import type { SQLiteDatabase } from "@/lib/db/database";

const mockClearCaptureBuffer = clearCaptureBuffer as jest.Mock;

const NOW = 1_786_000_000_000;

let db: SQLiteDatabase;

/**
 * One valid row in every table this schema currently declares, inserted with
 * plain SQL rather than through nineteen different repositories — the point
 * of this file is to prove the wipe empties whatever the SCHEMA says exists,
 * so seeding at the schema layer keeps the fixture honest about that, and
 * sidesteps needing every repository's own required-field shape just to set
 * up one throwaway row per table.
 *
 * Ordered so every foreign key it touches already exists at insert time —
 * unlike the wipe itself, this setup runs with `PRAGMA foreign_keys = ON`
 * (freshDb()'s default), so insert order here is not optional the way
 * delete order inside wipeAllData() is.
 */
async function seedOneRowPerTable(): Promise<void> {
  await db.runAsync(
    `INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at)
     VALUES ('w1', 'GCash', 'e-wallet', 10000, 'PHP', 0, ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO wallets (id, name, type, balance, currency, is_archived, created_at, updated_at)
     VALUES ('w2', 'Goal jar', 'cash', 0, 'PHP', 0, ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO categories (id, name, parent_id, icon, is_system, is_hidden, created_at, updated_at)
     VALUES ('cat1', 'Food', NULL, 'utensils', 1, 0, ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO wallet_matchers (id, wallet_id, package_name, hint, created_at, updated_at)
     VALUES ('wm1', 'w1', 'com.globe.gcash.android', NULL, ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO raw_notifications (id, package_name, title, text, sub_text, big_text, posted_at, captured_at, expires_at)
     VALUES ('cap1', 'com.globe.gcash.android', 'GCash', 'You sent ₱100', NULL, NULL, ?, ?, ?)`,
    [NOW, NOW, NOW + 1000],
  );
  await db.runAsync(
    `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, merchant, counterparty, reference_no, source, confidence, raw_notification_id, transfer_link_id, note, created_at, updated_at)
     VALUES ('tx_out', 'w1', 'cat1', 5000, 'out', ?, NULL, NULL, NULL, 'manual', 1.0, NULL, NULL, NULL, ?, ?)`,
    [NOW, NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, merchant, counterparty, reference_no, source, confidence, raw_notification_id, transfer_link_id, note, created_at, updated_at)
     VALUES ('tx_in', 'w1', 'cat1', 5000, 'in', ?, NULL, NULL, NULL, 'manual', 1.0, NULL, NULL, NULL, ?, ?)`,
    [NOW, NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, merchant, counterparty, reference_no, source, confidence, raw_notification_id, transfer_link_id, note, created_at, updated_at)
     VALUES ('tx_loan', 'w1', 'cat1', 2000, 'out', ?, NULL, NULL, NULL, 'manual', 1.0, NULL, NULL, NULL, ?, ?)`,
    [NOW, NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO transactions (id, wallet_id, category_id, amount, direction, occurred_at, merchant, counterparty, reference_no, source, confidence, raw_notification_id, transfer_link_id, note, created_at, updated_at)
     VALUES ('tx_bill', 'w1', 'cat1', 3000, 'out', ?, NULL, NULL, NULL, 'manual', 1.0, NULL, NULL, NULL, ?, ?)`,
    [NOW, NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO transfer_links (id, out_transaction_id, in_transaction_id, fee_amount, status, detected_by, confidence, created_at, updated_at)
     VALUES ('link1', 'tx_out', 'tx_in', 0, 'active', 'manual', 1.0, ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO limits (id, scope, basis, value, category_filter_json, wallet_filter_json, rollover, is_active, thresholds_fired_json, created_at, updated_at)
     VALUES ('lim1', 'monthly', 'fixed', 500000, NULL, NULL, 0, 1, '[]', ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO income_profiles (id, cadence, average_amount, is_manual_override, created_at, updated_at)
     VALUES ('inc1', 'monthly', 3000000, 0, ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO income_profile_sources (id, income_profile_id, wallet_id, created_at, updated_at)
     VALUES ('incsrc1', 'inc1', 'w1', ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO goals (id, name, target_amount, target_date, linked_wallet_id, contribution_rule_json, created_at, updated_at)
     VALUES ('goal1', 'Emergency fund', 1000000, NULL, 'w2', NULL, ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO loans (id, direction, counterparty, principal, interest_rate, schedule_json, linked_wallet_id, next_due_date, next_due_amount, created_at, updated_at)
     VALUES ('loan1', 'i-owe', 'Juan', 500000, NULL, NULL, 'w1', NULL, NULL, ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO loan_payments (id, loan_id, transaction_id, created_at, updated_at)
     VALUES ('lp1', 'loan1', 'tx_loan', ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO loan_adjustments (id, loan_id, amount, occurred_at, note, created_at, updated_at)
     VALUES ('ladj1', 'loan1', 1000, ?, 'penalty', ?, ?)`,
    [NOW, NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO bills (id, name, amount, amount_mode, due_rule_json, reminder_offsets_json, auto_match_rule_json, category_id, created_at, updated_at)
     VALUES ('bill1', 'Electricity', 150000, 'fixed', '{}', '[]', NULL, 'cat1', ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO bill_payments (id, bill_id, transaction_id, cycle_due_date, created_at, updated_at)
     VALUES ('bp1', 'bill1', 'tx_bill', '2026-08-15', ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO bill_cycles (id, bill_id, due_date, state, bill_payment_id, overdue_notices_sent, resolved_at, created_at, updated_at)
     VALUES ('bc1', 'bill1', '2026-09-15', 'open', NULL, 0, NULL, ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO recurring_patterns (id, merchant, amount, period, confidence, acknowledged, created_at, updated_at, period_days, first_seen_at, last_seen_at, dismissed_at, bill_id)
     VALUES ('rp1', 'Netflix', 55000, 'monthly', 0.9, 0, ?, ?, 30, ?, ?, NULL, NULL)`,
    [NOW, NOW, NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO user_rules (id, matcher_json, action_json, priority, is_enabled, created_from, applied_count, last_applied_at, created_at, updated_at)
     VALUES ('rule1', '{}', '{}', 0, 1, NULL, 0, NULL, ?, ?)`,
    [NOW, NOW],
  );
  await db.runAsync(
    `INSERT INTO review_queue_items (id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at)
     VALUES ('rq1', 'low-confidence', '{}', 'cap1', ?, NULL, NULL)`,
    [NOW],
  );
  await db.runAsync(
    `INSERT INTO parser_rulesets (id, version, payload_json, installed_at)
     VALUES ('ruleset1', 1, '{}', ?)`,
    [NOW],
  );
  // migration 009 (m3b Task 7) — the parser diagnostics counters. Content-free
  // by construction (see that migration's own header), which is exactly why a
  // row here has nowhere to put a merchant or an amount even as a fixture.
  await db.runAsync(
    `INSERT INTO parse_stats (id, provider_key, day_start_at, parsed_count, failed_count, updated_at)
     VALUES ('ps1', 'gcash', ?, 1, 0, ?)`,
    [NOW, NOW],
  );
  await setSetting("capture_enabled", false);
}

beforeEach(async () => {
  db = await freshDb();
  jest.clearAllMocks();
});

afterEach(async () => {
  await closeDatabase();
});

test("listWipeableTables enumerates every data table this test seeds — nothing in the schema is missing from either list", async () => {
  await seedOneRowPerTable();

  const wipeable = new Set(await listWipeableTables(db));
  // Every table this fixture inserts into, EXCEPT app_settings (handled by
  // resetSettings(), not the generic sweep — see data_wipe.ts's own note).
  const seeded = [
    "wallets",
    "categories",
    "wallet_matchers",
    "raw_notifications",
    "transactions",
    "transfer_links",
    "limits",
    "income_profiles",
    "income_profile_sources",
    "goals",
    "loans",
    "loan_payments",
    "loan_adjustments",
    "bills",
    "bill_payments",
    "bill_cycles",
    "recurring_patterns",
    "user_rules",
    "review_queue_items",
    "parser_rulesets",
    "parse_stats",
  ];

  for (const table of seeded) {
    expect(wipeable.has(table)).toBe(true);
  }
  // The other direction too: nothing wipeable is a table this fixture forgot
  // to cover, so the emptiness assertion below is actually exhaustive.
  expect([...wipeable].sort()).toEqual([...seeded].sort());
});

test("wipeAllData empties every wipeable table, verified by reading each one back", async () => {
  await seedOneRowPerTable();
  const tables = await listWipeableTables(db);

  // Sanity: every table genuinely has a row before the wipe runs, or the
  // emptiness assertion below would be vacuous.
  for (const table of tables) {
    const before = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
    expect(before?.count ?? 0).toBeGreaterThan(0);
  }

  await wipeAllData();

  for (const table of tables) {
    const after = await db.getFirstAsync<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table}`);
    expect(after?.count).toBe(0);
  }
});

test("wipeAllData resets settings to their documented defaults", async () => {
  await seedOneRowPerTable();

  await wipeAllData();

  expect(await getSetting("capture_enabled")).toBe(true);
  expect(await getSetting("onboarding_complete")).toBe(false);
});

test("wipeAllData drains and discards the native capture buffer", async () => {
  await seedOneRowPerTable();

  await wipeAllData();

  expect(mockClearCaptureBuffer).toHaveBeenCalledTimes(1);
});

test("wipeAllData resets the onboarding flag to false, so the app returns to the onboarding entry state", async () => {
  await setSetting("onboarding_complete", true);

  await wipeAllData();

  expect(await getSetting("onboarding_complete")).toBe(false);
});

test("schema_migrations survives the wipe — migrations.ts must not re-run its CREATE TABLEs on the next launch", async () => {
  const before = await db.getAllAsync("SELECT * FROM schema_migrations");
  expect(before.length).toBeGreaterThan(0);

  await seedOneRowPerTable();
  await wipeAllData();

  const after = await db.getAllAsync("SELECT * FROM schema_migrations");
  expect(after.length).toBe(before.length);
});

test("wipeAllData leaves foreign key enforcement ON afterward", async () => {
  await seedOneRowPerTable();

  await wipeAllData();

  const row = await db.getFirstAsync<{ foreign_keys: number }>("PRAGMA foreign_keys;");
  expect(row?.foreign_keys).toBe(1);
});

test("wipeAllData succeeds even with no data at all — an empty database is a no-op, not a throw", async () => {
  await expect(wipeAllData()).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// The theme does not survive a wipe. `app_settings` has no `theme_preference`
// column at all (see app_settings_repo.ts's own doc); the real value lives in
// AsyncStorage via contexts/theme_context.tsx, so `resetSettings()` alone
// cannot touch it — this is the piece docs/04-features/11-settings-privacy.md's
// "all settings" promise was silently missing before this fix.
// ---------------------------------------------------------------------------

test("wipeAllData erases the persisted theme preference from AsyncStorage", async () => {
  await AsyncStorage.setItem(THEME_STORAGE_KEY, "dark");
  expect(await AsyncStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

  await wipeAllData();

  expect(await AsyncStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
});
