import type { SQLiteDatabase } from "./database";
import coreSql from "./migrations/001_core.sql";

export type Migration = { version: number; name: string; sql: string };

/**
 * Registry of numbered migrations, ascending. Task 7 registers 001_core.
 * NEVER edit a shipped migration — add a new numbered one instead.
 *
 * Jest cache gotcha: babel-plugin-inline-import inlines each `*.sql` file's contents into
 * THIS file's transformed output at babel-transform time. Jest's transform cache is keyed
 * on this file's own mtime/content, not on the `.sql` file it inlines — so editing only a
 * migration `.sql` file can leave a stale, pre-edit SQL string cached and silently reused
 * by the next `jest` run. After editing any `*.sql` migration, run once with
 * `--no-cache` (or `jest --clearCache`) before trusting a green result.
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
