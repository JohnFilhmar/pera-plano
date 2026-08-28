-- 016_goal_soft_delete.sql — owner-approved 2026-08-28.
--
-- GOALS WERE THE LAST HARD DELETE. 010_soft_delete_and_derived_limits.sql gave
-- loans and limits the `archived_at` bills already had, under the owner's rule
-- "soft-delete data, no hard delete" — and it did not reach goals, because
-- goals had an argument for the exception: `deleteGoal` never touched the
-- linked wallet or a peso in it, so deleting a goal destroyed a lens over the
-- money rather than the money. That argument is sound about the MONEY and says
-- nothing about the PLAN. A goal carries a target, a deadline, a payday rule
-- and a created date, and the pace the app quotes is measured from that date;
-- rebuilding a goal after a mistaken delete restarts all of it. The owner's
-- report was "no way to see and unarchive archived goals", which only reads as
-- a bug if goals were expected to behave like every other Plan entity. They now
-- do.
--
-- WHY THIS REBUILDS THE TABLE INSTEAD OF ADDING ONE COLUMN.
--
-- `linked_wallet_id TEXT NOT NULL UNIQUE` (001_core.sql) is invariant I10's
-- enforcement: one goal per savings account. A column-level UNIQUE constraint
-- is part of the table definition, and SQLite's ALTER TABLE cannot drop one —
-- the only way out is a rebuild.
--
-- It has to go, because with `archived_at` added and UNIQUE left alone, an
-- archived goal would keep holding its wallet forever. That is a REGRESSION on
-- what hard delete already did right: `deleteGoal`'s own contract was that
-- deleting frees the account so the user can start fresh on it. A "delete" that
-- silently reserved the wallet against a goal the user cannot see would be
-- worse than either the old behaviour or no change at all.
--
-- The replacement is a PARTIAL unique index — the constraint applied to live
-- rows only. Two archived goals may share a wallet (a user who retried a plan
-- twice on the same account), exactly one live goal may claim it, and I10 holds
-- where it means something.
--
-- NO `disablesForeignKeys` FLAG NEEDED, unlike 014's `wallets` rebuild. Goals
-- REFERENCE wallets; nothing in the schema references goals, so dropping the
-- old table breaks no constraint. 011 and 012 rebuilt `review_queue_items` the
-- same way and for the same reason.
--
-- `archived_at` is nullable and carries WHEN, not merely WHETHER, matching
-- bills, loans and limits. Every existing row copies across as NULL, which
-- reads as "not archived" — correct for every goal already on a device, so
-- there is no backfill.
--
-- Never edit 001-015 — add a new numbered migration instead.
ALTER TABLE goals RENAME TO goals_old;

CREATE TABLE goals (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  target_amount INTEGER NOT NULL CHECK (target_amount > 0),
  target_date TEXT,
  -- UNIQUE dropped here and re-expressed as the partial index below.
  linked_wallet_id TEXT NOT NULL REFERENCES wallets(id),
  contribution_rule_json TEXT,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO goals (
  id, name, target_amount, target_date, linked_wallet_id,
  contribution_rule_json, archived_at, created_at, updated_at
)
SELECT
  id, name, target_amount, target_date, linked_wallet_id,
  contribution_rule_json, NULL, created_at, updated_at
FROM goals_old;

DROP TABLE goals_old;

CREATE UNIQUE INDEX goals_one_live_goal_per_wallet
  ON goals (linked_wallet_id)
  WHERE archived_at IS NULL;
