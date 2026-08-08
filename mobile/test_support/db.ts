import { closeDatabase, getDatabase, unlockDatabase } from "@/lib/db/database";
import { runMigrations } from "@/lib/db/migrations";
import type { SQLiteDatabase } from "@/lib/db/database";

// A fixed, non-secret 32-byte key used ONLY under Jest, where the mocked
// @op-engineering/op-sqlite (test_support/sqlite_mock.ts) is backed by sql.js and never reads
// this value at all — the mock accepts and ignores op-sqlite's encryptionKey option entirely
// (see that file's header comment). It exists purely to satisfy database.ts's new unlock
// gate (Task 7): getDatabase() throws DatabaseLockedError until unlockDatabase(dek) has run.
export const TEST_DEK = new Uint8Array(32).fill(0x42);

/** Fresh in-memory DB with the full schema applied. Call in beforeEach. */
export async function freshDb(): Promise<SQLiteDatabase> {
  await closeDatabase();
  await unlockDatabase(TEST_DEK);
  const db = await getDatabase();
  await runMigrations(db);
  return db;
}
