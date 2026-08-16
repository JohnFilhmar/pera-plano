// lib/privacy/data_wipe.ts — the Privacy centre's "Wipe everything" (m3b
// Task 6 rule 5; docs/04-features/11-settings-privacy.md Flow F, rules 10-11).
//
// DISTINCT FROM `lib/security/wipe.ts`'s `wipeAndStartOver`. That function is
// the §11a break-glass recovery primitive: it deletes the SQLCipher database
// FILE outright (see `wipeDatabase()`'s own doc — "not a logical clear
// (DELETE FROM ...)") and destroys both key wraps, because it exists for the
// state where NO key can ever open the file again. This function is the
// opposite case: the user's own choice, made from inside a session that is
// already unlocked. It empties every table with `DELETE FROM` and leaves the
// database file, its encryption key, and the app's ability to keep using
// itself untouched — the wipe the Privacy centre promises is "erase my data",
// never "destroy my ability to open the app again".
//
// "EVERY TABLE", ENUMERATED FROM THE SCHEMA ITSELF, NOT A HAND-WRITTEN LIST.
// This schema has grown across nine migration files (001_core.sql plus
// 002-008) and two of them — 005_loan_adjustments.sql, 006_bill_cycles.sql —
// added whole new tables, not just columns. A hand-written array copied from
// today's migrations is exactly the kind of list a TENTH migration silently
// outgrows: the table compiles, the wipe runs, nothing throws, and the user
// is told their data is gone while a `loan_adjustments` row (say) survives
// on disk. Reading the live table list from `sqlite_master` instead means
// the day a migration adds table number twenty-two, this function already
// wipes it — no second edit required, and nothing to forget.
import { getDatabase } from "@/lib/db/database";
import { resetSettings } from "@/lib/db/repos/app_settings_repo";
import { listDataTableNames } from "@/lib/db/table_names";
import { clearCaptureBuffer } from "@/modules/notification_listener";
import type { SQLiteDatabase } from "@/lib/db/database";

/**
 * `app_settings` is excluded from the generic sweep below and handled
 * separately, through `resetSettings()` — that repository already owns the
 * "every setting is now its documented default" promise (see its own doc:
 * an empty table already reads back as `DEFAULT_SETTINGS` for every key), so
 * this file states the intent in those words rather than re-deriving the
 * same effect from a bare `DELETE FROM app_settings` a second place.
 */
const SETTINGS_TABLE = "app_settings";

/**
 * Every table this wipe empties — `listDataTableNames` (lib/db/table_names.ts)
 * minus `app_settings`. Exported so `data_wipe.test.ts` can assert against
 * the SAME source of truth this function uses — a test that duplicated its
 * own hand-written list would only prove the two lists agree with each
 * other, not that either one is actually complete.
 */
export async function listWipeableTables(db: SQLiteDatabase): Promise<string[]> {
  const tables = await listDataTableNames(db);
  return tables.filter((name) => name !== SETTINGS_TABLE);
}

/**
 * Empties every data table, resets settings to their defaults, and drains
 * and discards the native pending-capture buffer — the complete "erase
 * everything" the Privacy centre's wipe flow promises (interface: m3b Task 6).
 *
 * FOREIGN KEYS ARE TURNED OFF FOR THE DURATION OF THIS WIPE, DELIBERATELY.
 * `database.ts` keeps `PRAGMA foreign_keys = ON` for the connection's whole
 * life (contract §3), and this schema has two relationships no fixed delete
 * order can satisfy with that pragma left on:
 *
 *   - `transactions.transfer_link_id` REFERENCES `transfer_links(id)`, and
 *     `transfer_links.{out,in}_transaction_id` REFERENCE `transactions(id)`
 *     right back — a genuine cycle. Whichever of the two is deleted first,
 *     the other still points at it.
 *   - `categories.parent_id` REFERENCES `categories(id)` — a self-reference,
 *     where a single `DELETE FROM categories` can hit a child row before its
 *     parent depending on physical row order, which this function has no
 *     control over and no reason to depend on.
 *
 * Disabling enforcement for exactly this transaction sidesteps both without
 * hand-maintaining a topological order that a future migration could
 * silently break. SQLite refuses to change this pragma while a transaction
 * is already open, so it is set BEFORE `withTransactionAsync` starts and
 * restored in `finally` once it has ended, whichever way — a wipe that
 * throws partway must never leave the connection permanently unprotected.
 * Emptying every table also means there is nothing left afterward FOR a
 * dangling reference to point at, so turning enforcement back on immediately
 * verifies nothing.
 */
export async function wipeAllData(): Promise<void> {
  const db = await getDatabase();
  const tables = await listWipeableTables(db);

  await db.execAsync("PRAGMA foreign_keys = OFF;");
  try {
    await db.withTransactionAsync(async () => {
      for (const table of tables) {
        await db.runAsync(`DELETE FROM ${table}`);
      }
    });
  } finally {
    await db.execAsync("PRAGMA foreign_keys = ON;");
  }

  await resetSettings();

  // The native pending-capture buffer (`pending_captures.ndjson`) lives
  // outside SQLite entirely — sealed ciphertext under the capture keypair,
  // written by the listener service. Nothing above touches it, and leaving
  // it behind would strand sealed captures under a wipe the user was told
  // erased everything. `clearCaptureBuffer()`, not `drainPendingCaptures()`,
  // is the right primitive here for the same reason `lib/security/wipe.ts`'s
  // `wipeAndStartOver()` calls it: it deletes the file outright and requires
  // NO authentication (see that module's own doc), so a wipe can never be
  // blocked by the capture keypair's post-unlock auth window the way a drain
  // could be.
  await clearCaptureBuffer();
}
