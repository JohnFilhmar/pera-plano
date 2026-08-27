-- 012_one_sided_transfer_review_kind.sql — the Review Queue learns about
-- transfers it only saw half of.
--
-- WHY A NEW KIND AND NOT `ambiguous-transfer`. That kind's payload carries a
-- `transferCounterpartTransactionId` — an existing ledger row the user is being
-- asked to confirm — and `resolve_actions.ts`'s `confirmAsTransfer` reads it and
-- links to it. A one-sided item has no such row: the whole point is that the
-- other leg produced no notification and does not exist yet. Reusing the kind
-- would hand that action a payload with nothing to link to.
--
-- WHY A REBUILD AND NOT AN `ALTER TABLE`. `kind` carries an inline
-- `CHECK (kind IN (...))` from 001_core.sql and SQLite has no
-- `ALTER TABLE ... DROP/ADD CONSTRAINT`. Same twelve-step dance as
-- 011_loan_match_review_kind.sql, and the same two things that must survive it:
--
--   THE INDEX. `DROP TABLE` takes `idx_review_queue_open` with it silently, and
--   `countOpen` runs every 30 seconds behind the tab badge. Recreated below.
--
--   THE FOREIGN KEY. `raw_notification_id REFERENCES raw_notifications(id)` is
--   restated verbatim so the Privacy Centre's raw-capture lifecycle keeps the
--   guarantee it had before this file ran.
--
-- Never edit 001-011 — add a new numbered migration instead.
CREATE TABLE review_queue_items_new (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('low-confidence', 'unknown-provider', 'ambiguous-transfer', 'possible-duplicate', 'loan-match', 'one-sided-transfer')),
  payload_json TEXT NOT NULL,
  raw_notification_id TEXT REFERENCES raw_notifications(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  resolved_at INTEGER
);

INSERT INTO review_queue_items_new (
  id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at
)
SELECT id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at
  FROM review_queue_items;

DROP TABLE review_queue_items;

ALTER TABLE review_queue_items_new RENAME TO review_queue_items;

CREATE INDEX idx_review_queue_open ON review_queue_items(resolved_at);
