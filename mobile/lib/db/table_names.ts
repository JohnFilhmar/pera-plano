// lib/db/table_names.ts — the live list of user-data tables this schema
// currently declares, read from SQLite's own catalogue rather than
// hand-copied from the migrations.
//
// WHY THIS IS ITS OWN FILE. Both `lib/privacy/data_wipe.ts` (every table to
// empty) and `lib/privacy/data_export.ts` (every table to dump, minus
// raw_notifications) need the SAME base enumeration, and duplicating the
// `sqlite_master` query in two places would let the two lists drift the
// moment one of them is edited and the other forgotten. Putting it here
// instead of exporting it from `data_wipe.ts` (which is where it was first
// written) keeps `data_export.ts` from transitively importing
// `modules/notification_listener` — `data_wipe.ts` needs that native module
// for `clearCaptureBuffer()`, and a value import of it drags
// `requireNativeModule` into every consumer, including this file's own pure
// data-shaping test. This module has no native import of any kind.
import type { SQLiteDatabase } from "./database";

/**
 * Never a data table: `schema_migrations` is migrations.ts's own bookkeeping
 * of which numbered migrations have already run, and emptying it would make
 * the next `runMigrations()` call (every app launch) believe none of them
 * ever applied and re-issue every `CREATE TABLE` against tables this
 * function only just finished emptying, not dropping. `sqlite_sequence` is
 * SQLite's own internal AUTOINCREMENT bookkeeping table — unused today (no
 * column in this schema declares AUTOINCREMENT), excluded anyway as a guard
 * against a future one that does.
 */
const INFRASTRUCTURE_TABLES = new Set(["schema_migrations", "sqlite_sequence"]);

/**
 * Every table SQLite currently knows about, minus the infrastructure ones
 * above. Read live rather than hand-written — see this file's header — so a
 * migration that adds a table (005_loan_adjustments.sql and
 * 006_bill_cycles.sql both did) is covered here the moment it ships, with no
 * second edit required and nothing to forget.
 */
export async function listDataTableNames(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  return rows.map((row) => row.name).filter((name) => !INFRASTRUCTURE_TABLES.has(name));
}
