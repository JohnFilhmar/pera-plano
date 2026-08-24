// lib/db/repos/review_queue_repo.ts — the only SQL surface for the Review
// Queue aggregate (interface contract §3). Same house shape as
// wallets_repo.ts (Task 10): thin functions over getDatabase(), rowToX
// mappers from lib/db/mappers.ts, domain types from types/domain.ts, no
// entitlement checks here (those live at the UI/service layer — see
// lib/entitlements.ts).
//
// `ReviewKind` and `ReviewResolution` here are the SHIPPED types/domain.ts
// shapes — hyphenated kind values matching the review_queue_items CHECK
// constraint, and a plain "confirmed" | "dismissed" resolution. The Task 13
// plan text sketched a different, richer vocabulary (underscored kinds, a
// "possible_transfer" kind that has no CHECK-constraint counterpart, and a
// tagged-union resolution carrying transactionId/transferLinkId/etc.); that
// sketch was drafted from the ingest pipeline's vocabulary without
// reconciling it against what Tasks 7-8 actually shipped, and the
// coordinator ruled to implement against the shipped types as-is (see
// task-13-report.md, "Escalation"). The table has no column to record which
// resolution outcome closed an item — only `resolved_at` — because that
// evidence lives in whatever row the caller's own action produces (the
// Transaction, the TransferLink, the UserRule); this repo's `resolve` only
// marks the item closed.
import { getDatabase } from "@/lib/db/database";
import { reviewQueueItemToRow, rowToReviewQueueItem, type ReviewQueueItemRow } from "@/lib/db/mappers";
import { newId } from "@/lib/ids";
import type { NewReviewItem, ReviewQueueItem, ReviewResolution } from "@/types/domain";

/**
 * Review Queue hygiene rule (docs/04-features/08-review-queue.md rules
 * 22-25): untriaged items expire 30 days after arrival, discarded without
 * committing.
 */
const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Enqueues a stage output for user triage. `payload_json` stores
 * `item.payload` verbatim — this repo serializes/deserializes it but never
 * interprets its shape (rule 1: it may be a parsed event, a candidate pair,
 * or a raw capture ref; the ingest pipeline owns what's inside).
 * `expiresAt` defaults to `createdAt + 30 days` when the caller doesn't
 * supply one (rule 4).
 */
export async function enqueue(item: NewReviewItem): Promise<ReviewQueueItem> {
  const db = await getDatabase();
  const now = Date.now();
  const queueItem: ReviewQueueItem = {
    id: newId(),
    kind: item.kind,
    payload: item.payload,
    rawNotificationId: item.rawNotificationId ?? null,
    createdAt: now,
    expiresAt: item.expiresAt ?? now + DEFAULT_EXPIRY_MS,
    resolvedAt: null,
  };
  const row = reviewQueueItemToRow(queueItem);

  await db.runAsync(
    `INSERT INTO review_queue_items (id, kind, payload_json, raw_notification_id, created_at, expires_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.kind,
      row.payload_json,
      row.raw_notification_id,
      row.created_at,
      row.expires_at,
      row.resolved_at,
    ],
  );
  return queueItem;
}

/**
 * Open items: unresolved AND unexpired, oldest first (rule 2) — the FIFO
 * order triage depends on so nothing rots at the bottom of the queue. An
 * item exactly at its `expires_at` boundary is treated as no longer open
 * (`expires_at > now`, not `>=`), matching `purgeExpired`'s inclusive
 * deletion boundary below.
 */
export async function listOpen(): Promise<ReviewQueueItem[]> {
  const db = await getDatabase();
  const now = Date.now();
  const rows = await db.getAllAsync<ReviewQueueItemRow>(
    `SELECT * FROM review_queue_items
     WHERE resolved_at IS NULL AND expires_at > ?
     ORDER BY created_at ASC`,
    [now],
  );
  return rows.map(rowToReviewQueueItem);
}

/** Count of open items — same predicate as `listOpen`, drives the tab badge without materializing every row. */
export async function countOpen(): Promise<number> {
  const db = await getDatabase();
  const now = Date.now();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM review_queue_items
     WHERE resolved_at IS NULL AND expires_at > ?`,
    [now],
  );
  return row?.count ?? 0;
}

/**
 * Marks an item resolved (rule 3). `resolution` is accepted for the pinned
 * contract §3 signature but not persisted — see the file-header note on why
 * there is no column for it.
 *
 * Idempotent by construction: resolving an id that is missing or already
 * resolved is a silent no-op — never an error, never a second write — so a
 * double-tap in the triage UI can't overwrite the original `resolved_at`.
 */
export async function resolve(id: string, resolution: ReviewResolution): Promise<void> {
  void resolution;
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ resolved_at: number | null }>(
    "SELECT resolved_at FROM review_queue_items WHERE id = ?",
    [id],
  );
  if (!existing || existing.resolved_at !== null) {
    return;
  }
  await db.runAsync("UPDATE review_queue_items SET resolved_at = ? WHERE id = ?", [Date.now(), id]);
}

/**
 * Deletes unresolved rows past their `expires_at` and returns the count
 * removed (rule 5). The `resolved_at IS NULL` guard is what keeps this a
 * hygiene purge instead of erasing a user's triage history — a resolved item
 * past its expiry is retained, never deleted by this function.
 */
export async function purgeExpired(now: number): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    "DELETE FROM review_queue_items WHERE resolved_at IS NULL AND expires_at <= ?",
    [now],
  );
  return result.changes;
}
