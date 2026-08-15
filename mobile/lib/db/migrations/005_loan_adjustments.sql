-- 005_loan_adjustments.sql — the part of a loan's history that never touched
-- tracked money.
--
-- ADDED BY THE PROJECT OWNER'S EXPLICIT DECISION (2026-08-15), through the same
-- escalation path migration 004 used.
--
-- WHY A SECOND TABLE AND NOT A NULLABLE COLUMN ON loan_payments. Payments and
-- adjustments are different facts, and docs/04-features/06-loans.md keeps them
-- apart deliberately:
--
--   Rule 7  — "Every paymentHistory[] entry references either a ledger
--             Transaction ... or a balance adjustment (Rule 13). There are no
--             free-floating payment records."
--   Rule 13 — adjustments "cover reality the app cannot see: accrued interest
--             or fees on free-form loans, lender-side corrections, penalties,
--             or payments made entirely outside tracked money. Each adjustment
--             carries an amount, a date, and a REQUIRED note, and appears in
--             the loan's history CLEARLY MARKED as an adjustment, not a
--             payment."
--
-- `loan_payments.transaction_id` is NOT NULL UNIQUE in 001_core.sql, which is
-- domain invariant I12 ("a Transaction appears in at most one") and rule 7's
-- "no free-floating payment records" in schema form. Relaxing it to hold
-- adjustments would destroy both: every adjustment would be an untraceable
-- payment row, and the history could no longer tell the user which entries
-- correspond to money that actually moved.
--
-- The m2b plan's own `recordPayment({ transactionId?: string | null })` is that
-- conflation in TypeScript. It cannot be implemented against this schema, and
-- it should not be.
--
-- SIGNED AMOUNTS, DELIBERATELY. An adjustment can go either way — accrued
-- interest and a penalty INCREASE what is owed, a lender-side correction can
-- decrease it — so there is no CHECK on the sign, unlike every other money
-- column in this schema. `outstanding = principal - payments + adjustments`.
--
-- `note` IS NOT NULL because rule 13 requires it. An adjustment with no
-- explanation is a number the user will not recognise in six months, on the one
-- part of a loan's history that has no ledger entry to fall back on.
--
-- Never edit 001-004 — add a new numbered migration instead.

CREATE TABLE loan_adjustments (
  id TEXT PRIMARY KEY NOT NULL,
  loan_id TEXT NOT NULL REFERENCES loans(id),
  -- Signed centavos: positive increases the balance owed, negative reduces it.
  amount INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  -- Required by rule 13. Empty strings are not blocked here; the repository
  -- rejects them, where a useful error message can be attached.
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_loan_adjustments_loan ON loan_adjustments(loan_id);
