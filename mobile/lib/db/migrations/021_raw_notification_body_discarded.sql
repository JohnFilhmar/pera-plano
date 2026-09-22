-- 021_raw_notification_body_discarded.sql: the minimal record (GAP-107,
-- owner decision 2026-09-09).
--
-- WHAT WAS WRONG. docs/03-ingest-pipeline.md §1 principle 2 said a notification
-- that is clearly not money-related is never stored. The live path honoured
-- that, because it routes before it stores. The drain did not: it wrote the
-- whole buffered batch here and discarded the non-money captures afterwards, so
-- on an install whose provider filter admits every app (onboarding's "Skip"
-- writes exactly that) a friend's message sat in this table for thirty days.
--
-- WHAT THE OWNER CHOSE, which was neither option the entry offered. Dropping
-- before the store would let the money-signal heuristic's false negatives take
-- a transaction's only trace with them; storing whole breaks the principle. So
-- the drain keeps a MINIMAL RECORD: the package and the two times, with every
-- text field and the slot key NULL. The principle holds for the content, which
-- is what it is about, and a missed transaction can still be found in the
-- Privacy centre as "something arrived from this app at this time and was
-- ignored".
--
-- WHAT THIS COLUMN IS. When the body was discarded, and so that it was. The
-- recovery sweep reads it to leave a trimmed row alone: nothing points at one,
-- which is what `listUnprocessedRawCaptures` calls stranded work, but nothing
-- is left in it that any stage could read, so offering it on every launch for
-- thirty days would be the churn GAP-048 removed for muted packages. The
-- Privacy centre reads it to say why a row has no text.
--
-- THE CHECK IS THE PRIVACY PROMISE, HELD BY THE SCHEMA. A marked row can carry
-- no text and no slot key, whoever writes to it later. The slot key is covered
-- because its tag is the posting app's own label for the notification, and a
-- chat app puts the conversation there.
--
-- NULLABLE AND NOT BACKFILLED. A row already on the device kept its text
-- because the build that stored it did not route first, and SQL cannot tell
-- which of those rows the router would call not money-related. The recovery
-- sweep can, and trims such a row when it next reaches it.
--
-- Never edit 001-020. This is a new numbered migration, additive only.
ALTER TABLE raw_notifications ADD COLUMN body_discarded_at INTEGER
  CHECK (
    body_discarded_at IS NULL
    OR (title IS NULL AND text IS NULL AND sub_text IS NULL AND big_text IS NULL
        AND notification_key IS NULL)
  );
