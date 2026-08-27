-- 015_support_reports.sql — the durable outbox behind offline problem
-- reporting: a report the user wrote, plus the media they attached, held on
-- the device until the developer's ticketing system actually acknowledges it.
--
-- WHY A TABLE AND NOT A POST. Every other network call in this app is
-- fire-and-forget by design (services/telemetry.ts, services/parser_rules.ts):
-- a missed telemetry window costs nothing and a stale ruleset self-heals
-- tomorrow. A problem report is the one payload where dropping it on a failed
-- request loses something the user cannot reproduce — they wrote it, they
-- attached the screenshot that shows the bug, and the screenshot is of a state
-- they may never hit again. So it is written to disk first, sent second, and
-- deleted from the queue only once the server has said it holds the ticket.
-- That ordering is the whole feature; the retry timer is just the part that
-- makes it eventually true.
--
-- THIS TABLE HOLDS CONTENT ON PURPOSE, and is the only table in this schema
-- that does. `parse_stats` (009) is structurally incapable of holding a
-- merchant or an amount because docs/07-privacy-and-compliance.md §5 rule 3
-- promises numbers only; that promise is about telemetry the app collects and
-- sends on its own initiative. A problem report is the opposite transaction:
-- the user types it, attaches to it, reads a screen that says where it is
-- going, and presses Send. Nothing here is ever gathered automatically, and
-- nothing here is ever sent for any reason other than that press — the outbox
-- only ever RE-sends what a press already authorised.
--
-- `id` IS THE IDEMPOTENCY KEY, not just a primary key. A send can succeed on
-- the server and still fail on the wire (the response is lost to a dropped
-- connection), after which this device retries a report the ticketing system
-- already holds. The client-generated UUID travels in the request body so the
-- server can recognise the second delivery as the same report and return the
-- original ticket rather than opening a duplicate. Without it, one bad signal
-- turns one bug into seven tickets.
--
-- `next_attempt_at` IS AN ABSOLUTE INSTANT, not a delay. Storing "wait 8
-- minutes" would restart the wait on every app launch, so a user who opens the
-- app every few minutes could hold a report unsent indefinitely; storing the
-- instant means time passes while the app is closed, which is when most of it
-- passes. The composite index below is exactly the query the outbox runner
-- makes on every launch and every foreground ("queued rows that are due"), so
-- it stays an index seek rather than a scan as the table ages.
--
-- ATTACHMENTS STORE A PATH, NOT A BLOB. The files are copied into the app's
-- own document directory at attach time (lib/support/attachments.ts) and this
-- table points at them. Screenshots are hundreds of kilobytes each; putting
-- them in SQLite would bloat the encrypted database file — which is opened,
-- keyed and read on every cold start — for data that is written once and read
-- once. The ON DELETE CASCADE is what keeps the two halves from drifting when
-- a report is discarded or purged.
--
-- Never edit 001-014 — this is a new numbered migration, additive only.
CREATE TABLE support_reports (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  topic TEXT NOT NULL,
  -- 'queued' | 'sent' | 'rejected'. No 'sending': see types/support.ts's
  -- SupportReportStatus for why an in-flight state is held in memory instead
  -- of in a row an OS kill could strand.
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  sent_at INTEGER,
  ticket_ref TEXT
);

CREATE INDEX idx_support_reports_status_next_attempt
  ON support_reports(status, next_attempt_at);

CREATE TABLE support_report_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  report_id TEXT NOT NULL REFERENCES support_reports(id) ON DELETE CASCADE,
  file_uri TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_support_report_attachments_report_id
  ON support_report_attachments(report_id);
