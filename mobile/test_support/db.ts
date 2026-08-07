import { closeDatabase, getDatabase } from "@/lib/db/database";
import { runMigrations } from "@/lib/db/migrations";
import type { SQLiteDatabase } from "expo-sqlite";

/** Fresh in-memory DB with the full schema applied. Call in beforeEach. */
export async function freshDb(): Promise<SQLiteDatabase> {
  await closeDatabase();
  const db = await getDatabase();
  await runMigrations(db);
  return db;
}
