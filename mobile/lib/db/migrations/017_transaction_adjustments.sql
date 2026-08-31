-- 017_transaction_adjustments.sql — fixes the owner's 2026-08-30 device report,
-- "wallet adjust balance counts as expense".
--
-- WHAT THE BUG WAS. A wallet's balance is never patched directly: it is the
-- ledger's running total, moved only by a transaction that explains the move
-- (wallet_form.tsx:11-13). So "Adjust balance" and "Cash reconciliation" both
-- commit a real Transaction for the DIFFERENCE between what the ledger thought
-- the wallet held and what the user says it actually holds. That part is right
-- and stays.
--
-- What was missing is a way for the row to say what it IS. This schema had
-- exactly one expression of "not spending, not income" — `transfer_link_id IS
-- NOT NULL`, invariant I2 — and an adjustment carries no transfer link, so
-- every figure in the app read it as an ordinary purchase. On the reporting
-- device that turned one correction into a −₱4,964.60 expense: a ₱266 daily
-- limit read ₱4,998.03 spent, eight categories showed "exceeded", and
-- Safe-to-Spend pinned at ₱0.00 with "you're ₱4,303.52 over".
--
-- WHY A COLUMN AND NOT A CATEGORY. The obvious cheaper fix is a system
-- category — "Balance adjustment" — excluded by id. It does not hold: the
-- transaction detail screen offers a "Change" button on category, so one tap
-- would recategorise the row into Food & Dining and it would start counting
-- again. What counts as spending must not be user-editable through a control
-- that exists to answer a different question. `transfer_link_id` is not
-- editable either (`TransactionPatch` deliberately omits it), and this column
-- follows it.
--
-- WHY NOT A `kind` ENUM. A `kind TEXT CHECK (kind IN (...))` would model
-- transfers, adjustments and ordinary rows in one place, which reads well —
-- but transfers are already modelled by a foreign key to a link row that
-- carries the pairing, and collapsing that into a string would either
-- duplicate the truth or invite the two to disagree. One boolean for the one
-- new fact is the smaller claim.
--
-- ADDITIVE, NOT A REBUILD. `ALTER TABLE ... ADD COLUMN` with a NOT NULL
-- DEFAULT 0 is legal in SQLite because the default is a constant, and every
-- existing row reads as "not an adjustment" — correct for every notification,
-- manual entry and transfer leg already on a device.
--
-- THE BACKFILL IS THE POINT OF SHIPPING THIS AS A MIGRATION rather than only
-- fixing the write path. Devices already carry adjustment rows — the reporting
-- device carries the −₱4,964.60 one — and a fix that only marked FUTURE
-- adjustments would leave those users with a permanently wrong spend history
-- and no way to correct it short of deleting ledger rows. The two note strings
-- below are written by exactly two call sites and by nothing else:
--
--   'Starting balance / manual correction' — BALANCE_CORRECTION_NOTE,
--     hooks/mutations/use_correct_wallet_balance.ts
--   'Cash reconciliation'                  — RECONCILE_NOTE,
--     lib/wallets/reconcile.ts
--
-- They are constants, not user input: the notes are stamped by the hook, and
-- neither sheet lets the user type a note at all. A hand-typed manual entry
-- whose note happened to match one of them character-for-character would be
-- caught too — an accepted and vanishingly unlikely cost, and the failure mode
-- is that one row stops counting as spend, which is recoverable by editing the
-- note. Matching on the note is the only evidence these rows left behind; there
-- was no other marker to key on, which is the bug.
--
-- The index is the `sumSpend` predicate as it now stands. That query runs on
-- every limit evaluation and on every Safe-to-Spend recompute, which is every
-- ledger write, so the added `is_adjustment = 0` term should not turn an index
-- seek into a scan as a ledger ages.
--
-- Never edit 001-016 — this is a new numbered migration, additive only.
ALTER TABLE transactions ADD COLUMN is_adjustment INTEGER NOT NULL DEFAULT 0;

-- `updated_at` is deliberately left alone: this classifies a row, it does not
-- edit one, and bumping the stamp would make a schema upgrade look like a user
-- correction in the one field that records when the user last touched it.
UPDATE transactions
   SET is_adjustment = 1
 WHERE note IN ('Starting balance / manual correction', 'Cash reconciliation');

CREATE INDEX IF NOT EXISTS idx_transactions_spend_window
  ON transactions (direction, is_adjustment, occurred_at)
  WHERE transfer_link_id IS NULL;
