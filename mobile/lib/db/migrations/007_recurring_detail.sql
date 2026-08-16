-- 007_recurring_detail.sql — M3 Part 2 Task 6 (owner decision, 2026-08-16).
--
-- 001_core's `recurring_patterns` carries only `merchant, amount, period,
-- confidence, acknowledged` (plus `bill_id` from migration 006) — enough for
-- the CONTRACT's coarse `period` enum but not enough for this task's two jobs:
--
--   PROMOTION. `promoteRecurringPatternToBill` (lib/bills/bills_service.ts)
--   takes a `periodDays` and a real posting `firstSeenAt`, and derives a
--   DueRule's day-of-month / weekday / semi-monthly shape from them. `period`
--   is a three-value enum ('weekly' | 'monthly' | 'annual') that cannot
--   express a 14-day fortnightly cadence, and it carries no date at all —
--   there is nothing here for that mapping to anchor on.
--
--   DISMISSAL. Recurring plan rule 3: "Dismissed patterns stay dismissed and
--   are not re-proposed unless their amount or cadence changes materially."
--   The existing `acknowledged` boolean already means something else — "this
--   is a real, counted obligation" (Reports rules 17-18) — and a dismissed
--   suggestion is a THIRD state, not the negation of that one: a pattern can
--   be unacknowledged-and-live (a pending suggestion), acknowledged (locked
--   in), or dismissed (suppressed). Folding dismissal into `acknowledged`
--   would make "acknowledged but later dismissed" or the reverse
--   inexpressible, and there would be nowhere to remember WHEN it was
--   dismissed for the "changes materially" comparison to run against.
--
-- `period` IS KEPT, unchanged, and every write still fills it in — it is
-- contract-pinned (types/domain.ts's `RecurringPeriod`) and Reports rule 17's
-- monthly-equivalent normalization ("weekly × 52 ÷ 12, monthly × 1, annual ÷
-- 12") reads that enum by name, not a day count. The two columns answer
-- different questions: `period` is the coarse bucket the rest of the app
-- already understands, `period_days` is the exact cadence this task's
-- promotion path needs.
ALTER TABLE recurring_patterns ADD COLUMN period_days INTEGER;

-- The detector's own `firstSeenAt`/`lastSeenAt` (lib/recurring/pattern_detector.ts),
-- carried through so the repository does not need to re-derive them from a
-- transaction history it does not have. `firstSeenAt` is the real posting date
-- `promoteRecurringPatternToBill` anchors a DueRule on; `lastSeenAt` plus
-- `period_days` is how the Subscriptions screen answers "next charge in N
-- days" without storing a projection that would drift out of date on its own.
ALTER TABLE recurring_patterns ADD COLUMN first_seen_at INTEGER;
ALTER TABLE recurring_patterns ADD COLUMN last_seen_at INTEGER;

-- NULL until dismissed, per the reasoning above. A timestamp rather than a
-- second boolean so the service can tell an old dismissal from a fresh one if
-- that ever matters, and so "not dismissed" and "dismissed at the epoch" can
-- never be confused the way two competing booleans could be.
ALTER TABLE recurring_patterns ADD COLUMN dismissed_at INTEGER;
