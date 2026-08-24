// lib/db/repos/__tests__/income_repo.test.ts — m2 Task 9.
//
// Runs against the REAL migrations through freshDb(). Three of the m2 plan's
// own fixtures do not survive contact with 001_core.sql, and each is called out
// where it bites:
//   `income_profile_sources` has an `id` PK plus timestamps, which the plan's
//   two-column INSERT omits; `wallet_id` has a foreign key, so the plan's
//   "w-bpi"/"w-gcash" string ids need real wallets behind them; and
//   `loan_payments` has no `amount`/`paid_at`/`kind`/`note` columns at all, with
//   `transaction_id` NOT NULL UNIQUE.
import { closeDatabase } from "@/lib/db/database";
import type { SQLiteDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { newId } from "@/lib/ids";
import { freshDb } from "@/test_support/db";
import { UNKNOWN_INCOME_DETECTION, type IncomeDetectionState } from "@/types/control";
import type { Wallet } from "@/types/domain";

import {
  clearIncomeProfile,
  getIncomeDetectionState,
  getIncomeProfile,
  listLoanPaymentTransactionIds,
  saveIncomeProfile,
  setIncomeDetectionState,
} from "../income_repo";

let db: SQLiteDatabase;
let bpi: Wallet;
let gcash: Wallet;

beforeEach(async () => {
  db = await freshDb();
  await seedDefaultCategories();
  bpi = await createWallet({ name: "BPI", type: "bank" });
  gcash = await createWallet({ name: "GCash", type: "e-wallet" });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// The profile — invariant I9, exactly one
// ---------------------------------------------------------------------------
test("starts empty and upserts a SINGLETON profile with its source wallets", async () => {
  expect(await getIncomeProfile()).toBeNull();

  const first = await saveIncomeProfile({
    cadence: "kinsenas",
    averageAmount: 1850000, // ₱18,500.00
    sourceWalletIds: [bpi.id, gcash.id],
    isManualOverride: false,
  });
  expect(first.cadence).toBe("kinsenas");
  expect(first.averageAmount).toBe(1850000);
  expect([...first.sourceWalletIds].sort()).toEqual([bpi.id, gcash.id].sort());

  const second = await saveIncomeProfile({
    cadence: "weekly",
    averageAmount: 500000,
    sourceWalletIds: [bpi.id],
    isManualOverride: true,
  });

  // THE SAME ROW. Invariant I9 is "exactly one IncomeProfile" — a second insert
  // would leave two, and `getIncomeProfile`'s LIMIT 1 would then return
  // whichever the engine happened to reach first.
  expect(second.id).toBe(first.id);
  expect(second.isManualOverride).toBe(true);
  expect(second.sourceWalletIds).toEqual([bpi.id]);
  expect(await getIncomeProfile()).toEqual(second);

  const count = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM income_profiles");
  expect(count?.n).toBe(1);
});

test("re-saving REPLACES the source wallets rather than accumulating them", async () => {
  await saveIncomeProfile({
    cadence: "kinsenas",
    averageAmount: 1850000,
    sourceWalletIds: [bpi.id, gcash.id],
    isManualOverride: false,
  });

  const narrowed = await saveIncomeProfile({
    cadence: "kinsenas",
    averageAmount: 1850000,
    sourceWalletIds: [gcash.id],
    isManualOverride: false,
  });

  // A user who removes a wallet from their income sources must stop having it
  // counted. An INSERT-only sources write leaves the old row and the UNIQUE
  // constraint hides the bug for re-added wallets only.
  expect(narrowed.sourceWalletIds).toEqual([gcash.id]);
  const rows = await db.getAllAsync<{ wallet_id: string }>(
    "SELECT wallet_id FROM income_profile_sources",
  );
  expect(rows.map((row) => row.wallet_id)).toEqual([gcash.id]);
});

test("a profile can have NO average amount yet", async () => {
  // IA §5 step 7: pick a cadence "and an average amount, OR 'detect it for me'".
  // `income_profiles.average_amount` is nullable and `IncomeProfile.averageAmount`
  // is `Centavos | null`; the plan's signature demands a number.
  const profile = await saveIncomeProfile({
    cadence: "irregular",
    averageAmount: null,
    sourceWalletIds: [],
    isManualOverride: false,
  });

  expect(profile.averageAmount).toBeNull();
  expect(profile.sourceWalletIds).toEqual([]);
});

test("clearIncomeProfile removes the profile AND its sources", async () => {
  await saveIncomeProfile({
    cadence: "monthly",
    averageAmount: 3000000,
    sourceWalletIds: [bpi.id],
    isManualOverride: false,
  });

  await clearIncomeProfile();

  expect(await getIncomeProfile()).toBeNull();
  // Sources first, or the foreign key rejects the delete — and an orphaned
  // source row would be re-read by the next profile that happened to reuse the id.
  expect(await db.getAllAsync("SELECT * FROM income_profile_sources")).toEqual([]);
});

test("clearing an already-empty profile is not an error", async () => {
  await expect(clearIncomeProfile()).resolves.toBeUndefined();
  expect(await getIncomeProfile()).toBeNull();
});

// ---------------------------------------------------------------------------
// Detection state — through app_settings_repo, never raw SQL
// ---------------------------------------------------------------------------
test("detection state defaults to unknown", async () => {
  expect(await getIncomeDetectionState()).toEqual(UNKNOWN_INCOME_DETECTION);
});

test("detection state round-trips every field", async () => {
  const next: IncomeDetectionState = {
    status: "provisional",
    cadence: "kinsenas",
    averageAmount: 1850000,
    sourceWalletIds: [bpi.id],
    matchedTransactionIds: ["t1", "t2", "t3"],
    suggestionDismissedSignature: null,
    missedWindows: 0,
    emittedPaydayTransactionIds: [],
  };

  await setIncomeDetectionState(next);

  expect(await getIncomeDetectionState()).toEqual(next);
});

test("detection state is stored as JSON in value_json, upserted per key", async () => {
  // Contract §3: `app_settings(id PK, key UNIQUE, value_json, updated_at)` —
  // "go through app_settings_repo, never raw SQL". The m2 plan writes raw SQL
  // here and gets it wrong twice over: four placeholders with two parameters,
  // and `DO UPDATE SET value = excluded.value` naming a column that does not
  // exist.
  await setIncomeDetectionState({ ...UNKNOWN_INCOME_DETECTION, missedWindows: 1 });
  await setIncomeDetectionState({ ...UNKNOWN_INCOME_DETECTION, missedWindows: 2 });

  const rows = await db.getAllAsync<{ value_json: string }>(
    "SELECT value_json FROM app_settings WHERE key = 'income_detection_state'",
  );
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0].value_json).missedWindows).toBe(2);
});

test("a lapsed state keeps its figures — lapsed is not forgotten", async () => {
  // Rule 13: a lapse means the expected windows stopped arriving, not that the
  // app forgot what the income was. `averageAmount` surviving is what lets the
  // UI say "your income seems to have stopped" instead of "unknown".
  const lapsed: IncomeDetectionState = {
    status: "lapsed",
    cadence: "monthly",
    averageAmount: 3000000,
    sourceWalletIds: [bpi.id],
    matchedTransactionIds: ["t9"],
    suggestionDismissedSignature: "sig-abc",
    missedWindows: 2,
    emittedPaydayTransactionIds: ["tx-emitted"],
  };

  await setIncomeDetectionState(lapsed);

  expect(await getIncomeDetectionState()).toEqual(lapsed);
});

// ---------------------------------------------------------------------------
// Loan-payment exclusion — income rule 1 / loans rule 17
// ---------------------------------------------------------------------------
test("lists the transaction ids that loan payments claim", async () => {
  const repayment = await insertTransaction({
    walletId: bpi.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 100000,
    direction: "in",
    occurredAt: Date.now(),
    source: "manual",
    confidence: 1,
  });
  const salary = await insertTransaction({
    walletId: bpi.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 1850000,
    direction: "in",
    occurredAt: Date.now(),
    source: "manual",
    confidence: 1,
  });

  const loanId = newId();
  await db.runAsync(
    `INSERT INTO loans (id, direction, counterparty, principal, interest_rate, schedule_json,
       linked_wallet_id, next_due_date, next_due_amount, created_at, updated_at)
     VALUES (?, 'owed-to-me', 'Juan', 500000, NULL, NULL, NULL, NULL, NULL, 0, 0)`,
    [loanId],
  );
  // The shipped shape: no amount, no paid_at, no kind, no note, and
  // transaction_id is NOT NULL UNIQUE. The plan's fixture writes all four of
  // those columns and a second row with a NULL transaction_id.
  await db.runAsync(
    `INSERT INTO loan_payments (id, loan_id, transaction_id, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0)`,
    [newId(), loanId, repayment.id],
  );

  const claimed = await listLoanPaymentTransactionIds();

  expect(claimed).toEqual([repayment.id]);
  expect(claimed).not.toContain(salary.id);
});

test("no loan payments yields an empty list, not a throw", async () => {
  expect(await listLoanPaymentTransactionIds()).toEqual([]);
});
