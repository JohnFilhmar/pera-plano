-- 024_review_resolution.sql: how a Review Queue card was answered (GAP-057).
--
-- `resolve(id, resolution)` has always taken "confirmed" or "dismissed" and
-- dropped it, because the table had nowhere to put it. A dismissed card and a
-- confirmed one were then indistinguishable once closed, which rules out any
-- history of what the user decided and the deferred second-dismissal counter
-- (docs/09-v2-backlog.md §2b.3).
--
-- NULL ON EVERY CARD CLOSED BEFORE THIS MIGRATION, because nothing recorded the
-- answer, and on every open card. The CHECK ties the two columns together: a
-- resolution needs a resolved time, so reopening a card has to clear both.
--
-- Never edit 001-023. This is a new numbered migration, additive only.
ALTER TABLE review_queue_items ADD COLUMN resolution TEXT
  CHECK (
    resolution IS NULL
    OR (resolution IN ('confirmed', 'dismissed') AND resolved_at IS NOT NULL)
  );
