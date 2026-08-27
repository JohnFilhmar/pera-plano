-- 014_drop_wallet_type.sql — the type question leaves the schema, now that
-- nothing asks it and nothing reads it.
--
-- WHY THIS ONE NEEDS `disablesForeignKeys` AND 011/012 DID NOT. Those rebuilt
-- `review_queue_items`, which no table references. FOUR tables reference
-- `wallets(id)` — wallet_matchers, transactions, goals, loans — and the
-- connection runs with `PRAGMA foreign_keys = ON` (lib/db/database.ts). SQLite
-- IGNORES a foreign_keys pragma issued inside a transaction, and the runner
-- wraps every migration in one, so this migration declares
-- `disablesForeignKeys: true` and the runner toggles the pragma AROUND that
-- transaction — then runs `PRAGMA foreign_key_check` BEFORE COMMIT, so a
-- rebuild that orphaned a transaction's `wallet_id` rolls back whole instead of
-- shipping. See lib/db/migrations.ts and its own suite.
--
-- 013 ADDED, THIS ONE REMOVES, AND THE ORDER MATTERS. Everything between the
-- two migrations reads the new columns while `type` sits there unused; that is
-- what let the app compile and the suite pass at every step of the change.
--
-- WHAT IS LOST, STATED PLAINLY: the bank / e-wallet / savings distinction, for
-- every wallet that had one. Nothing reads it, nothing displays it, and the two
-- facts it used to stand in for are both preserved — `owed_balance` came across
-- in 013, and "nothing routes here" is a COUNT over wallet_matchers, which this
-- migration does not touch.
--
-- Never edit 001-013 — add a new numbered migration instead.
CREATE TABLE wallets_new (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PHP',
  is_archived INTEGER NOT NULL DEFAULT 0,
  -- RESTATED VERBATIM FROM 003_drift_dismissal.sql, foreign key and all. A
  -- rebuild that recreates a column without its REFERENCES clause drops the
  -- constraint silently: nothing fails, and from then on a dismissal can name a
  -- transaction that does not exist — which never matches the current reporting
  -- transaction, so the drift badge looks dismissed for a reason nobody can
  -- explain. This suite's 003 test is what caught it.
  drift_dismissed_transaction_id TEXT REFERENCES transactions(id),
  owed_balance INTEGER NOT NULL DEFAULT 0,
  owed_pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO wallets_new (
  id, name, balance, currency, is_archived, drift_dismissed_transaction_id,
  owed_balance, owed_pinned, created_at, updated_at
)
SELECT id, name, balance, currency, is_archived, drift_dismissed_transaction_id,
       owed_balance, owed_pinned, created_at, updated_at
  FROM wallets;

DROP TABLE wallets;

ALTER TABLE wallets_new RENAME TO wallets;
