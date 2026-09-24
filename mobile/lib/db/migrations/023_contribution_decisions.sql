-- 023_contribution_decisions.sql: what the user decided about one payday's
-- planned goal contribution (GAP-056, goals rule 14).
--
-- WHAT RULE 14 NEEDS STORED, AND WHAT IT DOES NOT. A planned contribution is
-- pending until (a) money moved into the goal's wallet within three days covers
-- it, (b) the user records it, (c) the user skips it, or (d) the pay period
-- ends. (a) is a fact the ledger already holds and (d) one the next pay
-- settles, so both are derived where they are read
-- (lib/goals/planned_contributions.ts), and so is the contribution itself,
-- built from pay that arrived as safe-to-spend rule 6b requires. Only (b) and
-- (c) are the user's word, and nothing else in the database could hold them.
--
-- KEYED BY GOAL AND PAYDAY, the pair a planned contribution is made of: one
-- per goal per payday (rule 14), and a payday is a local date rather than a
-- credit (lib/income/paydays.ts says why).
--
-- Never edit 001-022. This is a new numbered migration, additive only.
CREATE TABLE contribution_decisions (
  goal_id TEXT NOT NULL REFERENCES goals(id),
  payday_date TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('recorded', 'skipped')),
  decided_at INTEGER NOT NULL,
  PRIMARY KEY (goal_id, payday_date)
);
