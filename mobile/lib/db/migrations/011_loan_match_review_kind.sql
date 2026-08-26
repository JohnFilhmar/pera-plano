-- 011_loan_match_review_kind.sql — the Review Queue learns about loans.
--
-- ONE NEW `kind` VALUE, `'loan-match'`, AND A WHOLE TABLE REBUILT TO GET IT.
--
-- WHY THE KIND HAS TO EXIST. docs/04-features/06-loans.md §"Flow: automatic
-- payment matching from the ledger" step 1 says the matcher runs "after a
-- Transaction commits to the ledger", and step 3 says everything that is not
-- an explicit provider loan event "becomes a suggestion — never a silent
-- commit. The user confirms or rejects from the loan detail OR THE REVIEW
-- QUEUE." Only the first half of that sentence shipped: candidates were
-- computed on demand when a screen asked for them, so a repayment that landed
-- while the user was nowhere near Plan -> Loans was never mentioned to anyone.
-- The queue is the half that does the mentioning, and a queue item needs a
-- `kind` the CHECK constraint will accept.
--
-- NOT ONE OF THE EXISTING FOUR, DELIBERATELY. `low-confidence`,
-- `unknown-provider`, `ambiguous-transfer` and `possible-duplicate` all mean
-- "this row is not in your ledger yet and the pipeline will not put it there
-- without you". A loan-match item means the exact opposite: the money already
-- moved, the transaction is committed and correct, and the only open question
-- is whether it also pays down a loan. Reusing `low-confidence` for it would
-- hand `resolve_actions.ts`'s `confirmItem` a payload it would try to commit a
-- SECOND transaction from — the same purchase in the ledger twice.
--
-- WHY A REBUILD AND NOT AN `ALTER TABLE`. `kind` carries a
-- `CHECK (kind IN (...))` written into 001_core.sql's `CREATE TABLE`, and
-- SQLite has no `ALTER TABLE ... DROP/ADD CONSTRAINT`. The only supported way
-- to widen an inline CHECK is the documented twelve-step dance in the SQLite
-- manual's "Making Other Kinds Of Table Schema Changes" — create the
-- replacement, copy every row, drop the original, rename, then rebuild the
-- indexes the drop took with it. Editing 001_core.sql instead would be the one
-- thing this schema's every migration header forbids: devices already carry
-- 001 applied, and a changed 001 would never re-run on any of them.
--
-- WHAT COULD GO WRONG AND WHAT PREVENTS IT:
--
--   THE INDEX. `DROP TABLE` takes `idx_review_queue_open` with it, silently.
--   `listOpen`/`countOpen`/`purgeExpired` all filter on `resolved_at`, and
--   `countOpen` in particular runs every 30 seconds behind the tab badge
--   (`use_review_count.ts` is the app's only polling query). A missing index
--   there is not an error — it is a full scan that gets slower for the life of
--   the install. It is recreated below, with the same name and the same
--   column.
--
--   THE FOREIGN KEY. `raw_notification_id REFERENCES raw_notifications(id)` is
--   restated verbatim on the replacement, because a rebuild that dropped it
--   would leave the Privacy Centre's raw-capture lifecycle with one fewer
--   guarantee than it had before this file ran. Nothing in the schema points
--   AT `review_queue_items`, so the rename below has no child tables to
--   repoint — checked, not assumed.
--
--   THE ROW ORDER. The copy is an unordered `INSERT ... SELECT`, which is
--   fine: `listOpen` orders by `created_at` in SQL and `app/review/index.tsx`
--   re-sorts what it is handed (`sortOldestFirst`), so nothing anywhere reads
--   rowid order as meaning.
--
-- `id` is restated as `TEXT PRIMARY KEY NOT NULL` rather than being allowed to
-- become an INTEGER-affinity rowid alias — the columns below are 001_core's
-- own, character for character, plus four characters inside the CHECK list.
--
-- Never edit 001-010 — add a new numbered migration instead.
CREATE TABLE review_queue_items_new (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('low-confidence', 'unknown-provider', 'ambiguous-transfer', 'possible-duplicate', 'loan-match')),
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
