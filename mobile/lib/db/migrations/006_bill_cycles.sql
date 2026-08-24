-- 006_bill_cycles.sql — m2c Task 1 (owner decision, 2026-08-15).
--
-- 001_core's `bill_payments` can express exactly one fact: this cycle was paid,
-- by this ledger transaction. `transaction_id` is NOT NULL UNIQUE, which is
-- invariant I12 and is correct for what that table is. But docs/04-features/
-- 07-bills.md needs a CYCLE to be a thing in its own right:
--
--   rule 21  a cycle is Overdue the day after its adjusted due date unless it
--            is paid OR SKIPPED — and there is nowhere to record a skip
--   flow     "Paid outside my wallets" resolves a cycle "with no ledger entry",
--            which a NOT NULL transaction_id forbids outright
--   rule 22  overdue escalation is capped at THREE notifications PER CYCLE, so
--            the count is a per-cycle fact
--   rule 25  "If the next due date arrives while a previous cycle is still
--            overdue, both cycles are listed ... resolved independently" — two
--            open cycles at once, each with its own state
--   rule 6   the estimator averages the last three MATCHED payments and
--            "skipped cycles and rejected matches never feed the estimate",
--            which requires telling those cases apart in storage
--
-- `bill_payments` IS LEFT EXACTLY AS IT IS. It stays the paid-with-a-transaction
-- join, so I12 keeps its teeth and nothing already written to it changes
-- meaning. A cycle row points AT a payment row when one exists.
CREATE TABLE bill_cycles (
  id TEXT PRIMARY KEY NOT NULL,
  bill_id TEXT NOT NULL REFERENCES bills(id),
  -- The ADJUSTED date (rule 3's weekday shift already applied), because every
  -- downstream date — reminders, the auto-match window, the overdue boundary —
  -- is computed from the adjusted one. The unadjusted date is recomputable from
  -- the rule when the detail screen wants to show it.
  due_date TEXT NOT NULL,
  -- 'paid' always has a bill_payment; 'resolved_external' is the spec's "Paid
  -- outside my wallets" and deliberately has none; 'skipped' is rule 21's other
  -- resolution. An unresolved cycle normally has NO ROW AT ALL — a bill with
  -- fifty untouched months should not carry fifty rows saying nothing happened
  -- — so 'open' exists for the ONE case that needs a row before resolution:
  -- rule 22's overdue-notice count. 'open' rather than reusing 'skipped' as a
  -- placeholder, because a query for skipped cycles must never sweep up a
  -- cycle that is merely overdue: rule 24 keeps overdue amounts subtracting
  -- from Safe-to-Spend, and rule 6 excludes skipped ones from the estimate.
  state TEXT NOT NULL CHECK (state IN ('open', 'paid', 'skipped', 'resolved_external')),
  bill_payment_id TEXT REFERENCES bill_payments(id),
  -- Rule 22's cap. Counted here rather than derived from notification ids
  -- because the OS forgets queued notifications across a reinstall and the cap
  -- must survive that; a user does not get three fresh naggings per reinstall.
  overdue_notices_sent INTEGER NOT NULL DEFAULT 0,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- One state per occurrence. A cycle cannot be both skipped and paid, and
  -- re-resolving the same due date is a CORRECTION of the existing row.
  UNIQUE (bill_id, due_date),
  -- 'paid' means a linked payment, and the other two mean none. Written as a
  -- CHECK so no code path can produce a paid cycle with nothing behind it.
  CHECK (
    (state = 'paid' AND bill_payment_id IS NOT NULL)
    OR (state != 'paid' AND bill_payment_id IS NULL)
  )
);

CREATE INDEX idx_bill_cycles_bill ON bill_cycles(bill_id, due_date);

-- Rule 27: "Archiving a bill stops future cycles, reminders, and matching;
-- history and linked transactions are untouched." A timestamp rather than a
-- flag: the Bills list needs to know WHEN a bill stopped producing cycles to
-- avoid conjuring occurrences after that date.
ALTER TABLE bills ADD COLUMN archived_at INTEGER;

-- Rules 28-29: promotion "sets the pattern's acknowledged: true and links
-- pattern -> bill", and an acknowledged linked pattern "is excluded from
-- 'locked in' totals to avoid double counting one obligation in two surfaces".
-- `acknowledged` alone cannot express the link, and without the link the M3
-- reports side has no way to know WHICH bill already counts that money.
ALTER TABLE recurring_patterns ADD COLUMN bill_id TEXT REFERENCES bills(id);
