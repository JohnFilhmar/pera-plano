// lib/privacy/data_export.ts — the Privacy centre's "Export everything" (m3b
// Task 6 rule 4; docs/04-features/11-settings-privacy.md Flow E, rule 7;
// docs/07-privacy-and-compliance.md §4 row 7, §7 "Export everything").
//
// RAW NOTIFICATION TEXT IS EXCLUDED ENTIRELY — NOT REDACTED, NOT
// FIELD-FILTERED, THE WHOLE `raw_notifications` TABLE IS LEFT OUT. This is a
// hard project rule (M3 Global Constraints: "raw notification text never
// leaves the device — excluded from CSV export, export-everything, and
// telemetry") and docs/04-features/11-settings-privacy.md Flow E step 2's own
// enumerated inclusion list — Wallets, Transactions, Transfer Links,
// Categories, Limits, IncomeProfile, Goals, Loans, Bills, RecurringPatterns,
// UserRules — never names raw_notifications at all. docs/07 §5 rule 2 gives
// the reason: captured text routinely carries a THIRD PARTY's personal data
// (a padala sender's name, a loan counterparty), so keeping it view-only
// in-app under its own 30-day TTL, rather than letting it leave the device in
// a file the user can forward or lose, is this app's data-minimization
// stance. Leaving out the whole table rather than trying to strip just the
// text columns is also the only version of this rule that cannot regress
// silently: a future column added to `raw_notifications` is excluded by
// construction, not because someone remembered to re-exclude it.
//
// EVERY OTHER TABLE, ENUMERATED THE SAME WAY `data_wipe.ts` DOES — read live
// from `sqlite_master` (lib/db/table_names.ts's `listDataTableNames`) rather
// than hand-copied from the migrations, for the identical reason: a
// hand-written list silently stops being "every table" the moment a
// migration adds one and nobody remembers to update this file. Imported from
// `lib/db/table_names.ts` rather than from `data_wipe.ts` directly so this
// file never transitively pulls in `modules/notification_listener` (which
// `data_wipe.ts` needs for `clearCaptureBuffer()` but this file has no
// business touching) — see that module's own header for why.
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { getDatabase } from "@/lib/db/database";
import { toDateIso } from "@/lib/dates";
import { listDataTableNames } from "@/lib/db/table_names";
import type { SQLiteDatabase } from "@/lib/db/database";

/** The one table an export must never include — see this file's header. */
const RAW_NOTIFICATION_TEXT_TABLE = "raw_notifications";

/**
 * Every table this export dumps: `listDataTableNames`'s live enumeration
 * with the raw capture text table excluded. `app_settings` IS included —
 * settings are part of "everything PeraPlano holds about you" for
 * portability purposes, and nothing in `app_settings` is raw notification
 * content (`AppSettings`'s own fields are booleans, small numbers, id maps —
 * see lib/db/repos/app_settings_repo.ts).
 */
async function listExportableTables(db: SQLiteDatabase): Promise<string[]> {
  const tables = await listDataTableNames(db);
  return tables.filter((table) => table !== RAW_NOTIFICATION_TEXT_TABLE).sort();
}

/**
 * The schema version this export was taken against — the highest migration
 * version `runMigrations()` has applied, read from `schema_migrations`
 * itself rather than hard-coded, so this number can never drift from the
 * database the rest of the bundle was actually read from.
 */
async function currentSchemaVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ version: number }>(
    "SELECT MAX(version) AS version FROM schema_migrations",
  );
  return row?.version ?? 0;
}

export type DataExportBundle = {
  schemaVersion: number;
  exportedAt: number;
  /** One entry per exported table, each an array of its raw rows. */
  data: Record<string, Record<string, unknown>[]>;
};

/**
 * Reads every exportable table into one JSON-serializable bundle. Exported
 * (not just used internally by `exportAllData`) so the export test can
 * assert on the bundle's SHAPE without also mocking the filesystem and share
 * sheet — matching `buildTransactionsCsv`/`exportTransactionsCsv`'s own split
 * in lib/reports/csv_export.ts between the pure data-shaping function and the
 * I/O wrapper around it.
 */
export async function buildDataExportBundle(now: number): Promise<DataExportBundle> {
  const db = await getDatabase();
  const [tables, schemaVersion] = await Promise.all([
    listExportableTables(db),
    currentSchemaVersion(db),
  ]);

  const data: Record<string, Record<string, unknown>[]> = {};
  for (const table of tables) {
    data[table] = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${table}`);
  }

  return { schemaVersion, exportedAt: now, data };
}

/**
 * Writes the export bundle to the app's cache directory as JSON and hands it
 * to the OS share sheet, returning the uri it was written to — the same
 * cache-directory-then-share pattern `exportTransactionsCsv`
 * (lib/reports/csv_export.ts) uses, down to the file's lifetime: it is
 * deleted once the share resolves or fails, so the uri names where the bundle
 * went, not something the caller can still read. Throws when the device has
 * no share sheet at all.
 *
 * `now` is a parameter, never `Date.now()` read internally — the global "no
 * bare Date.now() in testable paths" constraint, and the literal interface
 * this task specifies: `exportAllData(now: number): Promise<string>`.
 *
 * NO ENTITLEMENT CHECK — docs/07-privacy-and-compliance.md §7 rule 8 and
 * docs/04-features/11-settings-privacy.md Flow E step 4: export and wipe are
 * privacy rights available on every tier, never gated. There is nothing here
 * for a PlusGate to wrap.
 */
export async function exportAllData(now: number): Promise<string> {
  const bundle = await buildDataExportBundle(now);
  const json = JSON.stringify(bundle);

  const cacheDirectory = FileSystem.cacheDirectory;
  if (!cacheDirectory) {
    throw new Error("data_export: expo-file-system reports no cache directory");
  }
  const dateLabel = toDateIso(new Date(now));
  const fileUri = `${cacheDirectory}peraplano-export-${dateLabel}.json`;

  // Asked BEFORE the write, not after: a device with no share target has no
  // use for the file, and the cheapest plaintext copy of the whole database
  // to protect is the one that was never written. Throwing is the point —
  // resolving normally here would have the Privacy centre's export button
  // report a success that never happened.
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("data_export: sharing is unavailable on this device");
  }

  await FileSystem.writeAsStringAsync(fileUri, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // The file is transient. It is every exportable table in plaintext — the
  // whole ledger, wallets, loans, settings — sitting beside the ENCRYPTED
  // database that docs/12-encryption-and-app-lock.md promises is the only
  // copy at rest, so it lives only as long as the share sheet needs it.
  // `finally` because a cancelled or failed share must not leave it behind
  // either, and `idempotent` so a delete of an already-gone file is not
  // itself an error.
  try {
    await Sharing.shareAsync(fileUri, {
      mimeType: "application/json",
      dialogTitle: "Export your data",
    });
  } finally {
    await FileSystem.deleteAsync(fileUri, { idempotent: true });
  }

  return fileUri;
}
