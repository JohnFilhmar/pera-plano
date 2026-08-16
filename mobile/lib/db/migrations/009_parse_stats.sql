-- 009_parse_stats.sql — local, content-free parse-outcome counters behind
-- the Parser diagnostics screen (m3b Task 7).
--
-- WHY THIS EXISTS. docs/04-features/11-settings-privacy.md Flow G / rule 15:
-- the diagnostics screen shows per-provider parse activity as COUNTS ONLY, and
-- the interface contract's telemetry route (`POST /v1/telemetry/parse_stats`)
-- promises the exact same shape is ALL that is ever shared when the opt-in
-- toggle is on — "numbers only, never content". This table is the local store
-- behind both promises, so it is structurally incapable of holding anything
-- else: five columns, none of them free text that could carry a merchant, an
-- amount, or a notification body. `provider_key` is the parser catalogue's
-- short identifier (e.g. "gcash", "bpi-sms") — never raw captured text.
--
-- ONE ROW PER (provider_key, day), NOT one row per parse event. A device
-- captures notifications for years; an unbounded per-event log would grow
-- forever behind a screen that only ever asks "counts over the last N days"
-- (Flow G step 2's rolling 30-day window). Bucketing by day keeps the table
-- bounded by providers x days rather than by total notification volume, while
-- `day_start_at` still lets `getParseStats(sinceMs)` express any window —
-- Flow G's rolling 30 days today, and the server telemetry batch's own
-- `periodStart`/`periodEnd` (contract §6) later — as a plain `WHERE
-- day_start_at >= ?`.
--
-- `day_start_at` is LOCAL midnight in epoch ms (`lib/dates.ts`'s
-- `startOfLocalDay`, the same bucketing every other calendar question in this
-- app already uses), not a date string — comparing against a `sinceMs` cutoff
-- would otherwise need a string/epoch conversion on every read.
--
-- The UNIQUE pair is the invariant `recordParseResult` depends on: at most one
-- row may exist for a given provider on a given day, so incrementing is
-- always "update the one row or insert it", never "which of several rows do I
-- update".
--
-- Never edit 001-008 — this is a new numbered migration, additive only.
CREATE TABLE parse_stats (
  id TEXT PRIMARY KEY NOT NULL,
  provider_key TEXT NOT NULL,
  day_start_at INTEGER NOT NULL,
  parsed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE (provider_key, day_start_at)
);

CREATE INDEX idx_parse_stats_day_start_at ON parse_stats(day_start_at);
