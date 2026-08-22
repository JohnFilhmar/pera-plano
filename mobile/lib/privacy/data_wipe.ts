// lib/privacy/data_wipe.ts — the Privacy centre's "Wipe everything" (m3b
// Task 6 rule 5; docs/04-features/11-settings-privacy.md Flow F, rules 10-11).
//
// NO LONGER THE PRIVACY CENTRE'S WIPE — READ THIS BEFORE CALLING IT. This
// file's header used to draw a distinction against `lib/security/wipe.ts`'s
// `wipeAndStartOver` in exactly the wrong direction: that function deletes
// the SQLCipher database FILE outright (see `wipeDatabase()`'s own doc — "not
// a logical clear (DELETE FROM ...)") and destroys both key wraps, and this
// one empties every table with `DELETE FROM` while leaving the file, its
// encryption key, and the device's key wraps intact. The claim that the
// Privacy centre wanted the second shape — "erase my data", never "destroy my
// ability to open the app again" — turned out to be false in the only place
// it mattered: on a real device, "Erase everything" cleared the ledger and
// then dropped the user into onboarding with the SAME recovery phrase and the
// SAME fingerprint enrolment, because the keys this function preserves are
// exactly what makes `app/(onboarding)/index.tsx` skip its device-lock and
// phrase screens. The destructive copy promises a factory reset, so
// `app/(tabs)/more/privacy.tsx` now calls the lock context's
// `wipeAndStartOver` instead, and the state this function leaves behind is
// not what that screen wants.
//
// KEPT, NOT DELETED, because the logical sweep is still the only correct
// primitive for "empty every table while the session stays usable" — no
// production caller wants that today (the screen was the only one), but the
// behaviour is fully specified and proven by lib/privacy/__tests__/
// data_wipe.test.ts, and `listWipeableTables` below is the schema-derived
// table enumeration that suite and any future in-session reset both build on.
// Anything that adopts it must be a caller that genuinely wants the keys and
// the file to survive.
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
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getDatabase } from "@/lib/db/database";
import { resetSettings } from "@/lib/db/repos/app_settings_repo";
import { listDataTableNames } from "@/lib/db/table_names";
import { clearCaptureBuffer } from "@/modules/notification_listener";
import { THEME_STORAGE_KEY } from "@/contexts/theme_context";
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
 * and discards the native pending-capture buffer, leaving the database file
 * and both key wraps in place so the current session stays usable. That last
 * clause is why this is no longer what the Privacy centre's wipe flow calls —
 * see this file's header.
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

  // The theme preference lives OUTSIDE SQLite entirely — AsyncStorage, via
  // `contexts/theme_context.tsx` — because `app_settings` deliberately has no
  // `theme_preference` key for it (see that repository's own doc). Without
  // this line, `resetSettings()` above would have nothing to clear and the
  // theme would survive a wipe, contradicting the docs' explicit promise
  // that "every setting" is erased. `removeItem` rather than writing "auto"
  // back: an absent key is exactly what `ThemeProvider`'s mount-time read
  // already treats as "use the default", so this needs no special-casing on
  // the read side to become true.
  await AsyncStorage.removeItem(THEME_STORAGE_KEY);

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
