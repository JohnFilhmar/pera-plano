-- 019_loan_match_rejections.sql -- the owner's 2026-09-05 device report:
-- "clicking 'None of These' is not working properly, could be because there's
-- no actual wired function for that button and just closes the shown element".
--
-- WHAT THE BUTTON MEANT BEFORE THIS TABLE. Nothing. It called `onDismiss`, the
-- sheet closed, and the next open re-scored the same rows and offered them
-- again under a button still reading "3 possible payments". The user answered a
-- question the app immediately forgot, which is worse than not asking it.
--
-- ONE PAIR PER ROW, AND THAT IS WHAT KEEPS RULE 10 INTACT. Loans rule 10:
-- rejecting a suggestion "never creates a negative UserRule automatically". A
-- row here is not a rule. It silences exactly one transaction against exactly
-- one loan and says nothing about the merchant, the counterparty, or the next
-- transaction from the same person. The rejection COUNTER that rule 10 goes on
-- to describe ("repeated rejections for the same merchant surface a one-time
-- prompt") still has nowhere to live, and this table is deliberately not it.
--
-- STILL REACHABLE, NEVER LOST. `findPaymentCandidates` consults this table for
-- the SUGGESTED list only. "Show every transaction" drops the score floor and
-- ignores it, so a user who rejects a row and then realises it was the payment
-- can still find and confirm it. A rejection that could not be undone would be
-- a worse defect than the one it fixes.
--
-- CASCADE ON BOTH SIDES, UNLIKE `loan_payments`. 001_core.sql's payments carry
-- no CASCADE because they are LEDGER rows and must never disappear quietly. A
-- rejection is a UI memory: a dangling one would filter a candidate out of a
-- loan that no longer exists, and nothing would ever show the user why.
CREATE TABLE IF NOT EXISTS loan_match_rejections (
  id TEXT PRIMARY KEY NOT NULL,
  loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  UNIQUE (loan_id, transaction_id)
);

-- The only read is "which transactions has this loan rejected", once per open
-- of the loan detail screen.
CREATE INDEX IF NOT EXISTS idx_loan_match_rejections_loan
  ON loan_match_rejections (loan_id);
