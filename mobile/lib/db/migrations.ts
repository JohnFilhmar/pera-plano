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
import loanMatchReviewKindSql from "./migrations/011_loan_match_review_kind.sql";
import oneSidedTransferReviewKindSql from "./migrations/012_one_sided_transfer_review_kind.sql";
import walletTraitsSql from "./migrations/013_wallet_traits.sql";
import dropWalletTypeSql from "./migrations/014_drop_wallet_type.sql";
import supportReportsSql from "./migrations/015_support_reports.sql";
import goalSoftDeleteSql from "./migrations/016_goal_soft_delete.sql";
import transactionAdjustmentsSql from "./migrations/017_transaction_adjustments.sql";

export type Migration = {
  version: number;
  name: string;
  sql: string;
  /**
   * Runs with `PRAGMA foreign_keys = OFF`, for a migration that rebuilds a
   * table OTHER TABLES REFERENCE.
   *
   * WHY THIS IS NOT SOMETHING A MIGRATION CAN DO FOR ITSELF. SQLite ignores a
   * `foreign_keys` pragma issued inside a transaction, and `runMigrations`
   * puts every migration in one. So a rebuild of `wallets` — referenced by
   * wallet_matchers, transactions, goals and loans — cannot drop the old table
   * from inside its own SQL without tripping the constraint, however correct
   * the end state is. The pragma is toggled around the transaction, which is
   * the only part that has to sit outside it; the migration itself still runs
   * inside one and still rolls back.
   *
   * Migrations 011 and 012 rebuilt `review_queue_items` without any of this,
   * because nothing references that table.
   *
   * THE PRICE OF ASKING is `PRAGMA foreign_key_check` before COMMIT — see
   * `applyMigration`. Turning enforcement off means a mistake in the copy step
   * orphans rows silently instead of failing loudly, and the check is what puts
   * the loud failure back.
   */
  disablesForeignKeys?: true;
};

/**
 * A migration that ran with foreign keys off and left rows pointing at
 * something that no longer exists. Thrown BEFORE COMMIT, so the rebuild is
 * rolled back rather than shipped.
 */
export class MigrationIntegrityError extends Error {
  constructor(
    readonly version: number,
    readonly violationCount: number,
  ) {
    super(
      `Migration ${version} left ${violationCount} orphaned foreign-key row(s); rolled back.`,
    );
    this.name = "MigrationIntegrityError";
  }
}

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
 * (owner-approved 2026-08-20); 011_loan_match_review_kind widens the
 * `review_queue_items.kind` CHECK with `'loan-match'` so the post-commit loan
 * matcher has a card to raise (docs/04-features/06-loans.md §"Flow: automatic
 * payment matching from the ledger" step 3); 012_one_sided_transfer_review_kind
 * widens the same CHECK with `'one-sided-transfer'` for a transfer leg whose
 * counterpart never arrives as a notification and so has no committed row to
 * link to — see that file's own header for why it isn't `'ambiguous-transfer'`.
 * 013_wallet_traits and 014_drop_wallet_type replace the onboarding wallet-type
 * question with an inferred held/owed verdict: 013 adds the columns beside
 * `type`, everything in between moves off `type`, and 014 rebuilds the table
 * without it. Two migrations rather than one so the app compiles and the suite
 * passes at every step of that change.
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
  { version: 11, name: "loan_match_review_kind", sql: loanMatchReviewKindSql },
  { version: 12, name: "one_sided_transfer_review_kind", sql: oneSidedTransferReviewKindSql },
  { version: 13, name: "wallet_traits", sql: walletTraitsSql },
  {
    version: 14,
    name: "drop_wallet_type",
    sql: dropWalletTypeSql,
    // The first migration to need this: `wallets` is referenced by four other
    // tables, so its rebuild cannot run with foreign keys enforced. See that
    // file's header and `Migration.disablesForeignKeys` above.
    disablesForeignKeys: true,
  },
  // Additive: two new tables, nothing rebuilt, so no `disablesForeignKeys`
  // even though `support_report_attachments` declares a foreign key — the
  // pragma is only needed to DROP a table others reference, and this
  // migration drops nothing.
  { version: 15, name: "support_reports", sql: supportReportsSql },
  // Rebuilds `goals` to drop a column-level UNIQUE, but needs NO
  // `disablesForeignKeys`: goals reference `wallets`, and nothing in the schema
  // references goals, so dropping the old table breaks no constraint. Same
  // shape as 011 and 012's `review_queue_items` rebuilds.
  { version: 16, name: "goal_soft_delete", sql: goalSoftDeleteSql },
  // Additive column plus a backfill of the rows two reconciliation hooks
  // already wrote. No rebuild, so no `disablesForeignKeys`.
  { version: 17, name: "transaction_adjustments", sql: transactionAdjustmentsSql },
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
    if (migration.disablesForeignKeys) {
      // OUTSIDE the transaction, because that is the only place the pragma has
      // any effect. Restored in `finally` so a failed rebuild cannot leave the
      // connection unenforced for everything that runs after it.
      await db.execAsync("PRAGMA foreign_keys = OFF;");
      try {
        await applyMigration(db, migration);
      } finally {
        await db.execAsync("PRAGMA foreign_keys = ON;");
      }
    } else {
      await applyMigration(db, migration);
    }
    applied.push(migration.version);
  }
  return applied;
}

/**
 * One migration, inside one transaction.
 *
 * The integrity check runs BEFORE the `schema_migrations` insert and before
 * COMMIT, so a rebuild that orphaned a row is rolled back whole — the version
 * is not recorded, and the next launch tries again rather than starting from a
 * database that quietly lost its references.
 */
async function applyMigration(db: SQLiteDatabase, migration: Migration): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync(migration.sql);

    if (migration.disablesForeignKeys) {
      const violations = await db.getAllAsync<{ table: string }>("PRAGMA foreign_key_check");
      if (violations.length > 0) {
        throw new MigrationIntegrityError(migration.version, violations.length);
      }
    }

    await db.runAsync(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      [migration.version, migration.name, Date.now()],
    );
  });
}
