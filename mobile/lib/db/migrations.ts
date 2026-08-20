import type { SQLiteDatabase } from "./database";
import coreSql from "./migrations/001_core.sql";
import balanceAfterSql from "./migrations/002_balance_after.sql";
import driftDismissalSql from "./migrations/003_drift_dismissal.sql";
import limitAlertStateSql from "./migrations/004_limit_alert_state.sql";
import loanAdjustmentsSql from "./migrations/005_loan_adjustments.sql";
import billCyclesSql from "./migrations/006_bill_cycles.sql";
import recurringDetailSql from "./migrations/007_recurring_detail.sql";
import loanRemindersSql from "./migrations/008_loan_reminders.sql";
import parseStatsSql from "./migrations/009_parse_stats.sql";
import softDeleteAndDerivedLimitsSql from "./migrations/010_soft_delete_and_derived_limits.sql";

export type Migration = { version: number; name: string; sql: string };

/**
 * Registry of numbered migrations, ascending. Task 7 registers 001_core;
 * m1c Task 3b registers 002_balance_after; 003_drift_dismissal lands with
 * wallets rule 3's dismissal flow; 004_limit_alert_state lands with m2 Task 3's
 * limits repository; 005_loan_adjustments lands with m2b Task 5;
 * 006_bill_cycles lands with m2c Task 1; 007_recurring_detail lands with M3
 * Part 2 Task 6; 008_loan_reminders closes the per-loan reminder gap recorded
 * in lib/loans/loan_reminders.ts (docs/04-features/06-loans.md rule 15,
 * owner-approved 2026-08-16); 009_parse_stats adds the content-free
 * parse-outcome counters behind m3b Task 7's Parser diagnostics screen;
 * 010_soft_delete_and_derived_limits gives loans and limits the `archived_at`
 * bills already had (owner: "no hard delete") and marks the limits onboarding
 * derives at the other cadences so the Free cap can ignore them
 * (owner-approved 2026-08-20).
 * NEVER edit a shipped migration — add a new numbered one instead.
 *
 * Jest cache gotcha: babel-plugin-inline-import inlines each `*.sql` file's contents into
 * THIS file's transformed output at babel-transform time. Jest's transform cache is keyed
 * on this file's own mtime/content, not on the `.sql` file it inlines — so editing only a
 * migration `.sql` file can leave a stale, pre-edit SQL string cached and silently reused
 * by the next `jest` run. After editing any `*.sql` migration, run once with
 * `--no-cache` (or `jest --clearCache`) before trusting a green result.
 */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: "core", sql: coreSql },
  { version: 2, name: "balance_after", sql: balanceAfterSql },
  { version: 3, name: "drift_dismissal", sql: driftDismissalSql },
  { version: 4, name: "limit_alert_state", sql: limitAlertStateSql },
  { version: 5, name: "loan_adjustments", sql: loanAdjustmentsSql },
  { version: 6, name: "bill_cycles", sql: billCyclesSql },
  { version: 7, name: "recurring_detail", sql: recurringDetailSql },
  { version: 8, name: "loan_reminders", sql: loanRemindersSql },
  { version: 9, name: "parse_stats", sql: parseStatsSql },
  {
    version: 10,
    name: "soft_delete_and_derived_limits",
    sql: softDeleteAndDerivedLimitsSql,
  },
];

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
