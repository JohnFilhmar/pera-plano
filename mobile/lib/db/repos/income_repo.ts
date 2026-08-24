// lib/db/repos/income_repo.ts — the only SQL surface for the IncomeProfile
// aggregate (interface contract §3; m2 Task 9). Same house shape as
// wallets_repo.ts: thin functions over getDatabase(), domain types from
// types/domain.ts, no entitlement checks here.
//
// TWO TABLES, ONE AGGREGATE. `income_profiles` holds the row and
// `income_profile_sources` normalises `sourceWalletIds` — a join table with its
// own `id`, timestamps and a `UNIQUE (income_profile_id, wallet_id)`, which the
// m2 plan's two-column INSERT does not satisfy. Both are written inside one
// transaction, because a profile whose sources half-updated is a profile
// counting money from a wallet the user just removed.
//
// EXACTLY ONE PROFILE (invariant I9). `saveIncomeProfile` is an upsert on the
// single row, never an insert. Two rows would make `getIncomeProfile`'s
// `LIMIT 1` return whichever the engine reached first, and a percent-of-income
// limit would quietly change size depending on row order.
//
// DETECTION STATE GOES THROUGH `app_settings_repo`, NOT RAW SQL. Contract §3 is
// explicit about that table ("go through app_settings_repo, never raw SQL"), and
// the m2 plan's raw version is broken twice over: an INSERT with four
// placeholders and two parameters, and `ON CONFLICT ... DO UPDATE SET value =
// excluded.value` naming a `value` column that does not exist — it is
// `value_json`.
import { getDatabase } from "@/lib/db/database";
import { newId } from "@/lib/ids";
import { withUnitOfWork } from "@/lib/db/unit_of_work";
import type { Centavos, IncomeCadence, IncomeProfile } from "@/types/domain";
import type { IncomeDetectionState } from "@/types/control";

import { getSetting, setSetting } from "./app_settings_repo";

type ProfileRow = {
  id: string;
  cadence: string;
  average_amount: number | null;
  is_manual_override: number;
  created_at: number;
  updated_at: number;
};

export type NewIncomeProfile = {
  cadence: IncomeCadence;
  /**
   * `null` is a real state, not a missing argument: IA §5 step 7 offers "an
   * average amount, OR 'detect it for me'". `income_profiles.average_amount` is
   * nullable and `IncomeProfile.averageAmount` is `Centavos | null`; the m2
   * plan's signature demands a number and cannot express the second option.
   */
  averageAmount: Centavos | null;
  sourceWalletIds: string[];
  isManualOverride: boolean;
};

/** The one profile, or `null` on a device where none has been set. */
export async function getIncomeProfile(): Promise<IncomeProfile | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ProfileRow>("SELECT * FROM income_profiles LIMIT 1");
  if (!row) return null;

  const sources = await db.getAllAsync<{ wallet_id: string }>(
    "SELECT wallet_id FROM income_profile_sources WHERE income_profile_id = ? ORDER BY created_at",
    [row.id],
  );

  return {
    id: row.id,
    cadence: row.cadence as IncomeCadence,
    averageAmount: row.average_amount,
    sourceWalletIds: sources.map((source) => source.wallet_id),
    isManualOverride: row.is_manual_override === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Upserts the single profile and REPLACES its source wallets.
 *
 * Replace, not merge: a user who removes a wallet from their income sources
 * must stop having it counted. An insert-only sources write leaves the old row
 * behind, and the `UNIQUE (income_profile_id, wallet_id)` constraint hides the
 * bug for re-added wallets while letting removed ones keep contributing.
 *
 * One transaction, because the delete and the re-insert are a single edit. A
 * process death between them would leave a profile with no sources at all,
 * which reads as "income from nowhere" rather than as an interrupted write.
 */
export async function saveIncomeProfile(input: NewIncomeProfile): Promise<IncomeProfile> {
  const saved = await withUnitOfWork(async () => {
    const db = await getDatabase();
    const now = Date.now();
    const existing = await db.getFirstAsync<{ id: string }>(
      "SELECT id FROM income_profiles LIMIT 1",
    );
    const id = existing?.id ?? newId();

    if (existing) {
      await db.runAsync(
        `UPDATE income_profiles
            SET cadence = ?, average_amount = ?, is_manual_override = ?, updated_at = ?
          WHERE id = ?`,
        [input.cadence, input.averageAmount, input.isManualOverride ? 1 : 0, now, id],
      );
    } else {
      await db.runAsync(
        `INSERT INTO income_profiles (id, cadence, average_amount, is_manual_override,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, input.cadence, input.averageAmount, input.isManualOverride ? 1 : 0, now, now],
      );
    }

    await db.runAsync("DELETE FROM income_profile_sources WHERE income_profile_id = ?", [id]);
    for (const walletId of input.sourceWalletIds) {
      await db.runAsync(
        `INSERT INTO income_profile_sources (id, income_profile_id, wallet_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [newId(), id, walletId, now, now],
      );
    }

    return id;
  });

  const profile = await getIncomeProfile();
  if (profile === null || profile.id !== saved) {
    throw new Error(`income profile disappeared immediately after save: ${saved}`);
  }
  return profile;
}

/**
 * Removes the profile entirely — the "I cleared my income" path that limits
 * rule 12 turns into **Paused — income unknown** rather than a base of ₱0.00.
 *
 * Sources are deleted FIRST: they carry a foreign key to `income_profiles`, so
 * the other order is rejected outright. Idempotent, so a retry is harmless.
 */
export async function clearIncomeProfile(): Promise<void> {
  await withUnitOfWork(async () => {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM income_profile_sources");
    await db.runAsync("DELETE FROM income_profiles");
  });
}

/**
 * Detection's working notes. Returns the "unknown" state on a device where
 * detection has never run — `getSetting` supplies `DEFAULT_SETTINGS`, so this
 * never returns `null` and never throws on a fresh install.
 */
export async function getIncomeDetectionState(): Promise<IncomeDetectionState> {
  return getSetting("income_detection_state");
}

/** Replaces the whole detection state. */
export async function setIncomeDetectionState(state: IncomeDetectionState): Promise<void> {
  await setSetting("income_detection_state", state);
}

/**
 * Every transaction a loan payment claims — income rule 1's exclusion, by way
 * of loans rule 17: a repayment of money someone owed you is your own money
 * coming back, not income, and counting it would inflate the figure every
 * percent-of-income limit is measured against.
 *
 * A READ ACROSS AGGREGATES, deliberately kept here rather than in a loans repo
 * that does not exist yet. `loan_payments.transaction_id` is `NOT NULL UNIQUE`
 * in 001_core.sql, so there is no `IS NOT NULL` filter — the m2 plan adds one,
 * which would quietly suggest the column is nullable to anyone reading it.
 */
export async function listLoanPaymentTransactionIds(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ transaction_id: string }>(
    "SELECT transaction_id FROM loan_payments",
  );
  return rows.map((row) => row.transaction_id);
}
