import type { SQLiteDatabase } from "expo-sqlite";
import coreSql from "./migrations/001_core.sql";

export type Migration = { version: number; name: string; sql: string };

/**
 * Registry of numbered migrations, ascending. Task 7 registers 001_core.
 * NEVER edit a shipped migration — add a new numbered one instead.
 */
export const MIGRATIONS: Migration[] = [{ version: 1, name: "core", sql: coreSql }];

/**
 * Applies every migration whose version is not yet in schema_migrations,
 * each inside its own transaction. Returns the versions applied this run.
 */
export async function runMigrations(
  db: SQLiteDatabase,
  migrations: Migration[] = MIGRATIONS,
): Promise<number[]> {
  await db.execAsync(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       name TEXT NOT NULL,
       applied_at INTEGER NOT NULL
     );`,
  );
  const rows = await db.getAllAsync<{ version: number }>(
    "SELECT version FROM schema_migrations",
  );
  const done = new Set(rows.map((r) => r.version));
  const pending = [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((m) => !done.has(m.version));

  const applied: number[] = [];
  for (const migration of pending) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.name, Date.now()],
      );
    });
    applied.push(migration.version);
  }
  return applied;
}
