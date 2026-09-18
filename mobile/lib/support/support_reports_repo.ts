// lib/support/support_reports_repo.ts — the only SQL surface for
// `support_reports` and `support_report_attachments` (migration 015): the
// durable outbox behind offline problem reporting.
//
// Same house shape as `lib/diagnostics/parse_stats_repo.ts` — thin functions
// over `getDatabase()`, no clock (`now` is always a parameter, per
// `lib/clock.ts`), no network, and no decisions about WHETHER to send. The
// runner (`lib/support/outbox_runner.ts`) owns that; this file owns what the
// rows say.
//
// EVERY STATE TRANSITION IS A NAMED FUNCTION HERE — `markSent`,
// `recordFailure`, `markRejected`, `requeue` — rather than a generic
// `updateReport(fields)`. A queue whose transitions are spelled out is a queue
// you can read the rules of in one file: `recordFailure` is the ONLY thing
// that advances `attempt_count`, and it is therefore the only place the retry
// schedule is ever consulted. A generic setter would let a future caller move
// `next_attempt_at` without touching `attempt_count`, which is how a report
// ends up retrying at one minute forever.
//
// DELETION RETURNS FILE URIS instead of deleting files itself. This module
// must not import `expo-file-system` — `lib/db/table_names.ts`'s header
// records the same discipline for the same reason (a native import spreads to
// every consumer and every test of them). The caller pairs the row deletion
// with `lib/support/attachments.ts`'s file deletion; the SQL half is the half
// that has to be atomic, and it is.
import { getDatabase } from "@/lib/db/database";
import { withUnitOfWork } from "@/lib/db/unit_of_work";
import { newId } from "@/lib/ids";
import { nextAttemptAt } from "@/lib/support/retry_schedule";
import type { EpochMs } from "@/types/domain";
import {
  SUPPORT_TOPICS,
  type NewSupportReport,
  type SupportReport,
  type SupportReportAttachment,
  type SupportReportStatus,
  type SupportTopic,
} from "@/types/support";

type ReportRow = {
  id: string;
  title: string;
  description: string;
  topic: string;
  status: string;
  attempt_count: number;
  next_attempt_at: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
  sent_at: number | null;
  ticket_ref: string | null;
};

type AttachmentRow = {
  id: string;
  report_id: string;
  file_uri: string;
  mime_type: string;
  byte_size: number;
  created_at: number;
};

const TOPIC_SET: ReadonlySet<string> = new Set<string>(SUPPORT_TOPICS);

/**
 * Narrows a stored topic string back to the union.
 *
 * The column is plain TEXT, so a row written by an older build (or by a
 * migration that outlives a topic this build has since dropped) can hold a
 * string this app no longer knows. That report is still a real report someone
 * wrote, and refusing to read it would strand it in the outbox forever, so an
 * unknown topic degrades to `"other"` rather than throwing. The server's
 * ticket router sees the same fallback and files it for manual triage, which
 * is the correct outcome for a category nobody can name any more.
 */
function toTopic(value: string): SupportTopic {
  return TOPIC_SET.has(value) ? (value as SupportTopic) : "other";
}

/**
 * Narrows a stored status the same way, and for the same reason — except the
 * fallback here is `"queued"`. An unreadable status on a report that was never
 * confirmed sent must err towards sending it again (the server's idempotency
 * key makes a duplicate delivery harmless) rather than towards silently
 * dropping it, which is the failure this whole feature exists to prevent.
 */
function toStatus(value: string): SupportReportStatus {
  return value === "sent" || value === "rejected" ? value : "queued";
}

function toAttachment(row: AttachmentRow): SupportReportAttachment {
  return {
    id: row.id,
    reportId: row.report_id,
    fileUri: row.file_uri,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

function toReport(row: ReportRow, attachments: SupportReportAttachment[]): SupportReport {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    topic: toTopic(row.topic),
    status: toStatus(row.status),
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.sent_at,
    ticketRef: row.ticket_ref,
    attachments,
  };
}

/**
 * Loads the attachments for a set of reports in ONE query and groups them,
 * rather than one query per report. A report has at most a handful of files,
 * but the outbox flush reads every due report at once, and a per-report round
 * trip against an encrypted database on a mid-range Android is the kind of
 * N+1 that only shows up on the device.
 */
async function attachmentsByReport(
  reportIds: string[],
): Promise<Map<string, SupportReportAttachment[]>> {
  const grouped = new Map<string, SupportReportAttachment[]>();
  if (reportIds.length === 0) return grouped;

  const db = await getDatabase();
  // Placeholders are generated from the array's own length and every id is
  // still bound, never interpolated — the string below contains no caller
  // data at all.
  const placeholders = reportIds.map(() => "?").join(", ");
  const rows = await db.getAllAsync<AttachmentRow>(
    `SELECT id, report_id, file_uri, mime_type, byte_size, created_at
     FROM support_report_attachments
     WHERE report_id IN (${placeholders})
     ORDER BY created_at ASC`,
    reportIds,
  );

  for (const row of rows) {
    const list = grouped.get(row.report_id);
    if (list === undefined) {
      grouped.set(row.report_id, [toAttachment(row)]);
    } else {
      list.push(toAttachment(row));
    }
  }
  return grouped;
}

async function hydrate(rows: ReportRow[]): Promise<SupportReport[]> {
  const grouped = await attachmentsByReport(rows.map((row) => row.id));
  return rows.map((row) => toReport(row, grouped.get(row.id) ?? []));
}

/**
 * Writes a new report and its attachments to the outbox and returns the
 * stored row.
 *
 * ONE TRANSACTION, so a report can never exist without the screenshots the
 * user attached to it — a half-written report would be sent, and would be
 * missing exactly the evidence it was written to carry.
 *
 * `next_attempt_at` is `now`, not `now + one minute`: the first send is
 * immediate. The schedule in `retry_schedule.ts` describes what happens
 * AFTER a failure, and a user who presses Send with four bars of signal
 * should not wait a minute to find that out.
 */
export async function enqueueSupportReport(
  input: NewSupportReport,
  now: EpochMs,
): Promise<SupportReport> {
  const reportId = newId();

  await withUnitOfWork(async () => {
    const db = await getDatabase();
    await db.runAsync(
      `INSERT INTO support_reports
         (id, title, description, topic, status, attempt_count, next_attempt_at,
          last_error, created_at, updated_at, sent_at, ticket_ref)
       VALUES (?, ?, ?, ?, 'queued', 0, ?, NULL, ?, ?, NULL, NULL)`,
      [reportId, input.title, input.description, input.topic, now, now, now],
    );

    for (const attachment of input.attachments) {
      await db.runAsync(
        `INSERT INTO support_report_attachments
           (id, report_id, file_uri, mime_type, byte_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [newId(), reportId, attachment.fileUri, attachment.mimeType, attachment.byteSize, now],
      );
    }
  });

  const stored = await getSupportReport(reportId);
  if (stored === null) {
    // The transaction above committed; a missing row here means the database
    // is not doing what SQLite says it does. Loud, because every other
    // failure in this feature is deliberately quiet.
    throw new Error(`Support report ${reportId} vanished immediately after insert.`);
  }
  return stored;
}

/** One report by id, attachments included, or `null` if it is not there. */
export async function getSupportReport(id: string): Promise<SupportReport | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ReportRow>("SELECT * FROM support_reports WHERE id = ?", [id]);
  if (row === null) return null;
  const [report] = await hydrate([row]);
  return report;
}

/**
 * Queued reports whose `next_attempt_at` has arrived, oldest first.
 *
 * OLDEST FIRST MATTERS. Two reports written on the same offline afternoon
 * describe a sequence of events, and a ticketing system that receives them
 * out of order shows the developer the second half of the story first. It is
 * also the fair order: the report that has been waiting longest goes through
 * the one window of signal the user gets.
 */
export async function listDueSupportReports(now: EpochMs): Promise<SupportReport[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ReportRow>(
    `SELECT * FROM support_reports
     WHERE status = 'queued' AND next_attempt_at <= ?
     ORDER BY created_at ASC`,
    [now],
  );
  return hydrate(rows);
}

/**
 * Everything the user still has outstanding — queued and rejected both,
 * newest first, for the "waiting to send" list on the report screen.
 *
 * Rejected reports are in this list on purpose: a report the server refused
 * is still the user's, still on their phone, and still needs them to decide
 * between retrying it and throwing it away. Hiding it would look identical to
 * having sent it.
 */
export async function listUnsentSupportReports(): Promise<SupportReport[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ReportRow>(
    `SELECT * FROM support_reports
     WHERE status IN ('queued', 'rejected')
     ORDER BY created_at DESC`,
  );
  return hydrate(rows);
}

/**
 * The earliest instant any queued report becomes due, or `null` when the
 * queue is empty. The runner's timer sleeps until exactly this — one wake-up
 * for the whole queue rather than one per report.
 */
export async function nextSupportReportDueAt(): Promise<EpochMs | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ due_at: number | null }>(
    "SELECT MIN(next_attempt_at) AS due_at FROM support_reports WHERE status = 'queued'",
  );
  return row?.due_at ?? null;
}

/**
 * The server accepted the report. `ticket_ref` is whatever id the ticketing
 * system minted, kept so the user's own screen can show it and so a support
 * conversation has something to quote.
 *
 * `last_error` is cleared here. A report that arrived after six failures is
 * simply sent; leaving the last failure attached to it would render as
 * "Sent — No connection", which reads as a contradiction.
 */
export async function markSupportReportSent(
  id: string,
  ticketRef: string | null,
  now: EpochMs,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE support_reports
     SET status = 'sent', sent_at = ?, ticket_ref = ?, last_error = NULL, updated_at = ?
     WHERE id = ?`,
    [now, ticketRef, now, id],
  );
}

/**
 * A retryable failure — no connection, a timeout, a 5xx. Advances
 * `attempt_count` and pushes `next_attempt_at` out by whatever the schedule
 * says that attempt count is worth.
 *
 * THE INCREMENT AND THE RESCHEDULE ARE ONE STATEMENT, computed from the row's
 * own `attempt_count + 1` rather than from a count the caller read a moment
 * ago. Two flushes overlapping — a foreground event landing while a launch
 * flush is still in flight — would otherwise both read attempt 3, both write
 * attempt 4, and quietly halve the backoff. (`outbox_runner.ts` also holds a
 * mutex against exactly that, but the row should be correct on its own.)
 *
 * Returns the resulting attempt count so the caller can log a schedule that
 * matches what was actually written.
 */
export async function recordSupportReportFailure(
  id: string,
  reason: string,
  now: EpochMs,
): Promise<number> {
  const db = await getDatabase();
  const current = await db.getFirstAsync<{ attempt_count: number }>(
    "SELECT attempt_count FROM support_reports WHERE id = ?",
    [id],
  );
  if (current === null) return 0;

  const attemptCount = current.attempt_count + 1;
  await db.runAsync(
    `UPDATE support_reports
     SET attempt_count = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
    [attemptCount, nextAttemptAt(attemptCount, now), reason, now, id],
  );
  return attemptCount;
}

/**
 * The server refused the report in a way that retrying cannot fix. Parks it
 * for the user to deal with — see `SupportReportStatus` in types/support.ts
 * for why the endless schedule needs this escape hatch.
 */
export async function markSupportReportRejected(
  id: string,
  reason: string,
  now: EpochMs,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE support_reports SET status = 'rejected', last_error = ?, updated_at = ? WHERE id = ?",
    [reason, now, id],
  );
}

/**
 * The user pressed "Try again" on a rejected report. Resets the attempt count
 * to zero, so the schedule starts at one minute rather than resuming
 * mid-cycle at thirty-two — the user just told us something changed (they
 * shortened the description, they got on Wi-Fi), and treating that as attempt
 * eight would make them wait out a backoff earned by a different problem.
 */
export async function requeueSupportReport(id: string, now: EpochMs): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE support_reports
     SET status = 'queued', attempt_count = 0, next_attempt_at = ?, last_error = NULL, updated_at = ?
     WHERE id = ?`,
    [now, now, id],
  );
}

/**
 * Deletes a report and its attachment rows, returning the file URIs the
 * caller must now delete from disk. Returns an empty array for an id that is
 * not there, rather than throwing — a double-discard (two taps, one slow
 * database) is not an error worth surfacing.
 *
 * The attachment rows go with it via ON DELETE CASCADE (migration 015), so
 * the URIs are read BEFORE the delete, not after.
 */
export async function deleteSupportReport(id: string): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ file_uri: string }>(
    "SELECT file_uri FROM support_report_attachments WHERE report_id = ?",
    [id],
  );
  await db.runAsync("DELETE FROM support_reports WHERE id = ?", [id]);
  return rows.map((row) => row.file_uri);
}

/**
 * Retention for the outbox: drops reports that were confirmed sent before
 * `cutoff` and returns their attachment URIs for the caller to unlink.
 *
 * SENT ROWS ONLY. A queued report is never purged however old it is — a phone
 * that spent three months without a data plan still holds a report someone
 * meant to send, and deleting it would be this feature failing at the one
 * thing it promises. Rejected rows survive too: they are waiting on a
 * decision only the user can make.
 */
/**
 * Every attachment file URI any row still points at (GAP-072).
 *
 * THE INPUT TO THE LAUNCH SWEEP, and the reason it is a plain full-table read
 * with no status filter: the sweep unlinks whatever this does NOT return, so a
 * clause that accidentally excluded a status would delete the files of reports
 * still waiting to send. Rows are the authority here, not statuses.
 */
export async function listAllAttachmentFileUris(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ file_uri: string }>(
    "SELECT file_uri FROM support_report_attachments",
  );
  return rows.map((row) => row.file_uri);
}

export async function purgeSentSupportReports(cutoff: EpochMs): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ file_uri: string }>(
    `SELECT a.file_uri AS file_uri
     FROM support_report_attachments a
     JOIN support_reports r ON r.id = a.report_id
     WHERE r.status = 'sent' AND r.sent_at IS NOT NULL AND r.sent_at < ?`,
    [cutoff],
  );
  await db.runAsync(
    "DELETE FROM support_reports WHERE status = 'sent' AND sent_at IS NOT NULL AND sent_at < ?",
    [cutoff],
  );
  return rows.map((row) => row.file_uri);
}
