import * as SQLite from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";

const DB_NAME = "peraplano.db";

let dbPromise: Promise<SQLiteDatabase> | null = null;

async function open(): Promise<SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  // Contract §3: foreign keys are always enforced.
  await db.execAsync("PRAGMA foreign_keys = ON;");
  return db;
}

/** Singleton database handle. All repos go through this. */
export function getDatabase(): Promise<SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

/** Close and forget the handle. Used by tests for per-test isolation. */
export async function closeDatabase(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  dbPromise = null;
  await db.closeAsync();
}
