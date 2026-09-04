// lib/db/repos/raw_notifications_repo.ts — the only SQL surface for captured
// notification text, and the only place in the app where that text is ever
// written to disk (plan Task 10 rule 9; contract §3 invariant 3).
//
// Everything about this table is shaped by the promise the onboarding screen
// makes: raw text stays on the phone and is gone in 30 days. So:
//
//   - Nothing here syncs. There is no export path, no server column, and the
//     table is not part of any backup payload.
//   - Every row carries `expires_at` from the moment it is written, and
//     `purgeExpiredRawCaptures` (run at bootstrap) is what keeps the promise.
//   - The row id IS the `RawCapture.id` the native buffer assigned. That is not
//     a shortcut: pipeline rule 11 makes the at-least-once native drain safe by
//     asking "have I already seen this capture?", and this table is where the
//     answer lives.
//
// Same house shape as wallets_repo.ts: thin functions over getDatabase(),
// domain types from types/domain.ts, no entitlement checks.
import { getDatabase } from "@/lib/db/database";
import type { EpochMs, RawCapture } from "@/types/domain";

/**
 * The retention window, spec §1 principle 2 / §9.3 rule 1 / docs §12: thirty
 * days from first capture, then the text is destroyed and the Transaction it
 * produced keeps only its parsed fields.
 *
 * Exported so the retention copy in the Settings screen (m3b) and this table
 * cannot drift — a screen that promises 30 days over a table that keeps 45 is
 * a privacy claim the app does not honour.
 */
export const RAW_CAPTURE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type RawNotificationRow = {
  id: string;
  package_name: string;
  title: string | null;
  text: string | null;
  sub_text: string | null;
  big_text: string | null;
  posted_at: number;
  captured_at: number;
  /** Migration 018. NULL on every row stored before it — see `RawCapture.notificationKey`. */
  notification_key: string | null;
};

function rowToRawCapture(row: RawNotificationRow): RawCapture {
  return {
    id: row.id,
    packageName: row.package_name,
    title: row.title,
    text: row.text,
    subText: row.sub_text,
    bigText: row.big_text,
    postedAt: row.posted_at,
    capturedAt: row.captured_at,
    notificationKey: row.notification_key,
  };
}

/**
 * A `RawCapture` plus the ONE extra fact the Privacy centre's captured list
 * needs to render its countdown: when this row expires.
 *
 * A SEPARATE TYPE, not a widened `RawCapture` — same reasoning as
 * `getRawCaptureExpiry`'s own doc: `RawCapture` is interface-contract §4, the
 * shape the Kotlin listener hands across the bridge, and it has no
 * `expiresAt` because the native side never assigns one. This type exists
 * only on this side of that boundary, for callers that already need the
 * expiry alongside the text (m3b Task 6) and would otherwise pay a second
 * per-row query for it.
 */
export type StoredRawCapture = RawCapture & { expiresAt: EpochMs };

function rowToStoredRawCapture(row: RawNotificationRow & { expires_at: number }): StoredRawCapture {
  return { ...rowToRawCapture(row), expiresAt: row.expires_at };
}

/**
 * Every capture that has not yet expired, newest-captured first — the exact
 * rows behind "What PeraPlano captured" (m3b Task 6 rule 3; docs
 * §04-features/11-settings-privacy.md Flow C).
 *
 * FILTERED BY THE CALLER'S `now`, NOT BY WHETHER A PURGE HAS RUN YET.
 * `purgeExpiredRawCaptures` only runs at bootstrap (lib/bootstrap.ts), so a
 * long session can hold rows whose `expires_at` passed hours ago and have not
 * been swept yet. This list is the proof behind the 30-day promise — showing
 * one of those rows would show text the user was told is already gone, which
 * is the one thing this screen must never do. `now` is a parameter rather
 * than read from the clock here for the same reason every other function in
 * this repository that touches retention takes it as one: a caller that
 * cannot pin the instant cannot test the promise at all.
 *
 * NEWEST-CAPTURED-FIRST, matching `listObservedPackages`'s own ordering
 * convention: recency is what a user scanning "what did you record" actually
 * wants to see first.
 */
export async function listRawCaptures(now: EpochMs): Promise<StoredRawCapture[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<RawNotificationRow & { expires_at: number }>(
    "SELECT * FROM raw_notifications WHERE expires_at > ? ORDER BY captured_at DESC",
    [now],
  );
  return rows.map(rowToStoredRawCapture);
}

/**
 * Persists one capture and returns its id — which is the capture's own id, so
 * a caller can use it as `transactions.raw_notification_id` without a second
 * read.
 *
 * `now` is passed in rather than read from the clock because the pipeline
 * stamps a whole drained batch with one `now` (rule 10), and because a test
 * that cannot pin the expiry cannot check the retention promise at all.
 *
 * IDEMPOTENT, AND THE FIRST WRITE WINS. `INSERT OR IGNORE` rather than a bare
 * INSERT, and rather than an upsert:
 *
 *   - A bare INSERT throws on the primary key when the at-least-once native
 *     drain hands back a batch it already delivered (rule 11). Inside the
 *     rule-10 bulk persist that would abort the pass partway, losing every
 *     capture behind the collision — the precise failure rule 10 exists to
 *     prevent.
 *   - An upsert would refresh `expires_at` on every replay, quietly extending
 *     the retention window past the 30 days the user was promised, and would
 *     overwrite the text a committed Transaction was actually derived from.
 *
 * Storing is therefore safe to repeat and never changes an existing row.
 * Callers that need to know whether this capture is NEW ask `hasRawCapture`
 * first — the two are separate on purpose, because "did I store it" and "had I
 * seen it before" are different questions and only the second decides a replay.
 */
export async function storeRawCapture(capture: RawCapture, now: number): Promise<string> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO raw_notifications
       (id, package_name, title, text, sub_text, big_text, posted_at, captured_at, expires_at,
        notification_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      capture.id,
      capture.packageName,
      capture.title,
      capture.text,
      capture.subText,
      capture.bigText,
      capture.postedAt,
      capture.capturedAt,
      now + RAW_CAPTURE_TTL_MS,
      capture.notificationKey ?? null,
    ],
  );
  return capture.id;
}

/**
 * The stored capture, or `null` when it was never stored or has been purged.
 *
 * `null` is a normal answer, not an error: the "Why was this recorded?" screen
 * reaches a Transaction older than 30 days exactly this way and shows
 * "original notification text expired" (spec §9.3 rule 1).
 */
export async function getRawCapture(id: string): Promise<RawCapture | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<RawNotificationRow>(
    "SELECT * FROM raw_notifications WHERE id = ?",
    [id],
  );
  return row ? rowToRawCapture(row) : null;
}

/**
 * When this capture will be destroyed, or `null` when it is already gone.
 *
 * A SEPARATE ACCESSOR RATHER THAN A FIELD ON `RawCapture`. That type is
 * interface-contract §4 — the shape the Kotlin listener hands across the native
 * bridge — and it has no `expiresAt`, because the native side does not assign
 * one: `storeRawCapture` computes it here, from the STORE time. Adding it to
 * the type to save the "Why was this recorded?" panel one read would change a
 * native contract for the benefit of one screen.
 *
 * READ IT, NEVER DERIVE IT. `capturedAt + RAW_CAPTURE_TTL_MS` is the obvious
 * shortcut and it is wrong whenever the two clocks differ, which is exactly
 * what a replayed batch or a drain deferred until the next unlock produces: a
 * capture taken on the 1st and stored on the 8th is deleted on the 38th, not
 * the 31st. `purgeExpiredRawCaptures` deletes on THIS column, so any countdown
 * computed from anything else is the app promising a deletion date the database
 * will not honour — on the one screen whose entire job is being trustworthy
 * about deletion.
 *
 * `null` covers "never stored" and "already purged" alike, and both are normal
 * answers: the panel renders its expired notice for either.
 */
export async function getRawCaptureExpiry(id: string): Promise<EpochMs | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ expires_at: number }>(
    "SELECT expires_at FROM raw_notifications WHERE id = ?",
    [id],
  );
  return row ? row.expires_at : null;
}

/**
 * Whether this capture has been stored before — pipeline rule 11's replay
 * check, asked once per capture before any parsing work.
 *
 * A COUNT, not a `getRawCapture(...) !== null`: the answer is one bit and the
 * row carries the user's notification text, which there is no reason to read
 * into memory to discover we already have it.
 */
export async function hasRawCapture(id: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM raw_notifications WHERE id = ?",
    [id],
  );
  return (row?.count ?? 0) > 0;
}

/**
 * Captures that were stored and then produced nothing — no Transaction, no
 * Review Queue card — oldest-captured first, at most `limit` of them.
 *
 * THE RECOVERY LIST THE PIPELINE NEVER HAD. `storeRawCapture` runs BEFORE the
 * stages (pipeline rule 2), so a stage that throws — SQLite busy, a corrupt
 * user rule, the process killed mid-batch — leaves a durable row nothing ever
 * looks at again, while `hasRawCapture` calls every later delivery of that
 * notification a replay. The money movement disappears with no row, no card
 * and no error. This is the query `startIngest` sweeps to find those rows and
 * put them back through the stages.
 *
 * TWO `NOT EXISTS` RATHER THAN A `processed_at` COLUMN, and the difference is
 * not free. A column would record whether the stages RAN; this asks whether
 * they left anything BEHIND, which is a different question and is wrong in two
 * knowable ways:
 *
 *   - A capture the stages deliberately ignored — the DedupeGate's `duplicate`
 *     verdict, the review floor's `unreadable` discard — points at neither
 *     table, so it is swept again on every launch. Re-running it is SAFE: every
 *     verdict is anchored on the event's own `occurredAt` rather than on when
 *     the stages run, so a later pass reaches the same answer. It is repeated
 *     work, not a wrong one.
 *   - A capture whose committed Transaction is later DELETED looks unprocessed
 *     again, and a sweep would re-commit it. `mergeDuplicate`
 *     (lib/review/resolve_actions.ts) is the only caller of `deleteTransaction`
 *     in the app, and it closes this itself: the merge leaves a resolved card
 *     on the dropped capture, which the second `NOT EXISTS` below then reads.
 *     `isRawCaptureUnreferenced` is the singular form of that same predicate,
 *     so the merge decides whether to write the marker by asking the exact
 *     question this sweep will ask later.
 *
 * The first wants the column, and the column wants a migration, so it is
 * recorded here rather than left for the next reader to rediscover.
 *
 * BOUNDED BY `expires_at`, exactly as `listRawCaptures` is and for the same
 * reason: `purgeExpiredRawCaptures` only runs at bootstrap, so a long session
 * holds rows whose 30 days ran out hours ago. Reprocessing one would be the app
 * acting on text it told the user was already destroyed.
 *
 * OLDEST-CAPTURED FIRST, the opposite of `listRawCaptures`'s newest-first: this
 * list feeds pipeline rule 8, where an older capture must never be committed
 * after a newer one. Capped so a device carrying hundreds of stranded rows does
 * not spend its whole launch on them — whatever the cap leaves is picked up by
 * the next sweep.
 */
export async function listUnprocessedRawCaptures(
  now: EpochMs,
  limit: number,
): Promise<RawCapture[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<RawNotificationRow>(
    `SELECT * FROM raw_notifications
     WHERE expires_at > ?
       AND NOT EXISTS (
         SELECT 1 FROM transactions WHERE transactions.raw_notification_id = raw_notifications.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM review_queue_items
         WHERE review_queue_items.raw_notification_id = raw_notifications.id
       )
     ORDER BY captured_at ASC
     LIMIT ?`,
    [now, limit],
  );
  return rows.map(rowToRawCapture);
}

/**
 * True when NOTHING points at this capture — no Transaction, no Review Queue
 * card, resolved or not. `listUnprocessedRawCaptures`'s two `NOT EXISTS`
 * clauses, asked about one id.
 *
 * WHAT IT IS FOR. A caller that is about to remove the last row referencing a
 * capture has to know whether doing so strands it, because a stranded capture
 * is one the next `startIngest` sweep re-runs through the stages — and for a
 * capture whose Transaction was deleted DELIBERATELY, re-running it puts back
 * the row the user removed. `mergeDuplicate` is that caller.
 *
 * NO `expires_at` BOUND, unlike the list above. The list is bounded because it
 * is ACTED on and an expired capture's text is text the user was told is gone;
 * this one is only asked whether a reference exists, and a caller writing a
 * marker for a capture that is about to expire anyway costs one row that
 * `purgeExpiredRawCaptures` will clear with the rest.
 */
export async function isRawCaptureUnreferenced(id: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ referenced: number }>(
    `SELECT
       EXISTS (SELECT 1 FROM transactions WHERE raw_notification_id = ?)
       OR EXISTS (SELECT 1 FROM review_queue_items WHERE raw_notification_id = ?)
       AS referenced`,
    [id, id],
  );
  return (row?.referenced ?? 0) === 0;
}

/**
 * The id of an already-stored capture that is THE SAME NOTIFICATION as this
 * one, redelivered — or `null` when this is genuinely new.
 *
 * WHY THIS EXISTS ALONGSIDE `hasRawCapture`, WHICH LOOKS LIKE THE SAME
 * QUESTION. It is not. `capture.id` is a UUID minted per DELIVERY in
 * `PeraPlanoNotificationListenerService.extractCapture`, so it answers "have I
 * been handed this exact delivery before" — the right guard for the
 * at-least-once native drain handing back a batch it already gave us, and the
 * wrong one for everything else. Android calls `onNotificationPosted` AGAIN
 * every time an app edits a notification it already posted, and each of those
 * redeliveries arrives with a fresh UUID. The id check cannot see them, so one
 * withdrawal notification its bank app edited twice became three stored
 * captures, three pipeline runs and three identical Review Queue cards
 * (owner's device report, 2026-09-01).
 *
 * THE SLOT KEY IS THE WHOLE ANSWER, AND TEXT ALONE IS NOT.
 * `notificationKey` is `StatusBarNotification.getKey()` — `package|id|tag|user`
 * — which the platform holds constant across an edit and differs between two
 * separately-posted notifications. Matching on the text alone was the first
 * attempt at this and it is WRONG: `pipeline.test.ts`'s "two distinct captures
 * with identical amount, channel and timing still reach the DedupeGate" pins
 * the project's decision that two genuine ₱100.00 purchases producing
 * byte-identical text inside the twin window must be ESCALATED to the user as
 * a `possible-duplicate` card, never suppressed. Suppressing there eats a real
 * transaction, which is worse than the duplicate card it would fix. Requiring
 * the key means two separately-posted notifications are never touched by this
 * function at all, whatever their text says.
 *
 * A NULL KEY SUPPRESSES NOTHING, and that is the safe direction. Rows stored
 * before migration 018, and records still in the native buffer written by a
 * build that predates it, carry none — "cannot tell" must behave exactly like
 * today rather than guess.
 *
 * THE TEXT IS STILL COMPARED, because a slot is reused for genuinely new
 * content: a tile that goes "Processing" then "Sent ₱1,000" is one slot and
 * two different facts, and only the second is the transaction. Identical text
 * in the same slot is the redelivery; changed text in the same slot is a new
 * capture that the DedupeGate then judges on its merits.
 *
 * `posted_at` is deliberately NOT compared, only the window it must fall in:
 * the platform stamps a repost with a fresh `postTime`, so including it would
 * differ on exactly the redeliveries this exists to catch.
 *
 * NULL-SAFE by `IS` rather than `=`: three of the four text fields are
 * routinely NULL, and `NULL = NULL` is NULL in SQL, so `=` would never match
 * the captures carrying the least text.
 */
export async function findReplayCapture(
  capture: RawCapture,
  windowMs: number,
): Promise<string | null> {
  const notificationKey = capture.notificationKey ?? null;
  if (notificationKey === null) return null;

  const db = await getDatabase();
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM raw_notifications
     WHERE package_name = ?
       AND notification_key = ?
       AND title IS ? AND text IS ? AND sub_text IS ? AND big_text IS ?
       AND posted_at >= ? AND posted_at <= ?
       AND id <> ?
     ORDER BY posted_at DESC
     LIMIT 1`,
    [
      capture.packageName,
      notificationKey,
      capture.title,
      capture.text,
      capture.subText,
      capture.bigText,
      capture.postedAt - windowMs,
      capture.postedAt + windowMs,
      capture.id,
    ],
  );
  return row?.id ?? null;
}

/**
 * Deletes every capture at or past its expiry and returns how many went.
 * Called at bootstrap (plan Task 11 rule 1).
 *
 * THE TWO UPDATES ARE NOT OPTIONAL. Both `transactions.raw_notification_id` and
 * `review_queue_items.raw_notification_id` are foreign keys onto this table,
 * `PRAGMA foreign_keys = ON` is set in `database.ts`, and neither declares an
 * ON DELETE action. A bare DELETE therefore throws the first time a purge meets
 * a Transaction that still points at its capture — which is to say, on day 31
 * of every install that has ever committed anything. Clearing the references
 * first is also exactly what spec §9.3 rule 1 describes: the Transaction keeps
 * all parsed fields and simply loses the pointer to text that no longer exists.
 *
 * `updated_at` IS DELIBERATELY NOT TOUCHED. Losing an expired pointer is a
 * retention event, not a user edit; bumping it would move every purged row to
 * the top of "recently changed" and would misreport the row as modified to any
 * future sync.
 *
 * Inclusive at the boundary (`<= now`), matching `review_queue_repo.purgeExpired`
 * so the two hygiene passes agree about what "expired" means.
 */
export async function purgeExpiredRawCaptures(now: number): Promise<number> {
  const db = await getDatabase();
  let removed = 0;

  await db.withTransactionAsync(async () => {
    const expiring = "SELECT id FROM raw_notifications WHERE expires_at <= ?";

    await db.runAsync(
      `UPDATE transactions SET raw_notification_id = NULL
       WHERE raw_notification_id IN (${expiring})`,
      [now],
    );
    await db.runAsync(
      `UPDATE review_queue_items SET raw_notification_id = NULL
       WHERE raw_notification_id IN (${expiring})`,
      [now],
    );

    const result = await db.runAsync("DELETE FROM raw_notifications WHERE expires_at <= ?", [now]);
    removed = result.changes;
  });

  return removed;
}
