-- 022_goal_milestone.sql: the milestone a goal has reached (GAP-055, goals
-- rule 12).
--
-- WHAT RULE 12 NEEDS STORED. A milestone fires when progress FIRST crosses 25,
-- 50, 75 or 100 percent, at most once per goal lifetime, so a dip and a
-- recovery cannot re-trigger it (rule 12), nor can a raised target (rule 20) or
-- a downward reconciliation (rule 21). That is a fact about the goal's history
-- rather than its current balance, and nothing stored it.
--
-- ONE HIGH-WATER MARK, NOT A LIST OF FIRED THRESHOLDS. The entry proposed a
-- JSON array. The thresholds are ordered, and when one change crosses several
-- only the highest is announced (the rule Limits follow, docs/06 §6.2 rule 2),
-- so every threshold at or below the mark has been passed and none above it
-- has. One integer says exactly that, and the CHECK holds it to the five values
-- rule 12 names.
--
-- BACKFILLED FROM EACH GOAL'S CURRENT PROGRESS. Every goal already on a device
-- has progress nobody announced. Starting them all at 0 would post a
-- celebration for weeks-old saving on the first commit after the update, so
-- each goal starts at the milestone its linked wallet already meets. A goal
-- created from here on starts the same way: the balance a wallet held before
-- the goal existed is stated in the creation flow (rule 4), never announced.
-- The arithmetic matches `milestoneFor` in lib/goals/goal_math.ts.
--
-- Never edit 001-021. This is a new numbered migration, additive only.
ALTER TABLE goals ADD COLUMN milestone_reached INTEGER NOT NULL DEFAULT 0
  CHECK (milestone_reached IN (0, 25, 50, 75, 100));

UPDATE goals SET milestone_reached = COALESCE((
  SELECT CASE
    WHEN w.balance * 100 >= goals.target_amount * 100 THEN 100
    WHEN w.balance * 100 >= goals.target_amount * 75 THEN 75
    WHEN w.balance * 100 >= goals.target_amount * 50 THEN 50
    WHEN w.balance * 100 >= goals.target_amount * 25 THEN 25
    ELSE 0
  END
  FROM wallets w WHERE w.id = goals.linked_wallet_id
), 0);
