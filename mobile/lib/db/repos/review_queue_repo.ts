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
import { REVIEW_KINDS } from "@/constants/review_kinds";
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

/**
 * How many items one page of the Review Queue holds.
 *
 * 25 IS THE SPEC'S OWN NUMBER, not a round guess: §UX states calls 1–25 the
 * "Normal" queue and >25 a "Backlog" that earns its own banner. A page is
 * therefore exactly one normal queue — anyone whose queue fits the healthy case
 * never sees a second page at all, and the first person who does has, by the
 * spec's own definition, a backlog worth telling them about.
 */
export const REVIEW_PAGE_SIZE = 25;

/**
 * Where the next page starts. KEYSET, NOT AN OFFSET, and that is the whole
 * point of the shape.
 *
 * Every action on this screen RESOLVES an item, which removes it from the very
 * predicate the pagination runs over. Under `LIMIT ? OFFSET ?` the second page
 * would then start 25 rows into a list that is now 24 long, and the item that
 * slid across the boundary is skipped — silently, with no error and nothing on
 * screen to suggest a row was never shown. That is the failure mode this
 * queue's FIFO rule exists to prevent (an item nobody ever reaches), reinvented
 * by the pagination itself.
 *
 * A cursor of "the last row I actually saw" cannot skip: rows before it are
 * already rendered or gone, and rows after it are untouched by either.
 *
 * `id` rides along because `created_at` is NOT unique — `startIngest` drains up
 * to 500 buffered captures in one pass and several land in the same
 * millisecond. A cursor on the timestamp alone would either re-show or skip
 * every tied row at a page boundary, depending on which comparison it used.
 */
export type ReviewCursor = { createdAt: number; id: string };

export type OpenPageArgs = {
  /**
   * Restrict to these kinds. `undefined` OR AN EMPTY ARRAY both mean "every
   * kind" — an empty selection is the UI's "All", never "show nothing", and
   * the one reading that cannot produce a blank screen from a full queue.
   */
  kinds?: readonly ReviewQueueItem["kind"][];
  /** The last row of the previous page, or `null`/absent for the first. */
  after?: ReviewCursor | null;
  /** Rows per page; clamped to at least 1. */
  limit?: number;
};

export type ReviewPage = {
  items: ReviewQueueItem[];
  /** `null` when this page is the last one — the caller never has to count to find out. */
  nextCursor: ReviewCursor | null;
};

/**
 * One page of open items, same predicate and same oldest-first order as
 * `listOpen` (which stays exactly as it was — contract §3 pins its signature).
 *
 * `nextCursor` is resolved by reading LIMIT + 1 rows and discarding the extra,
 * rather than by a second `COUNT(*)`: it answers "is there more?" from the same
 * index scan that produced the page, and it cannot disagree with the page it
 * shipped with the way two separate reads a moment apart can.
 */
export async function listOpenPage({
  kinds,
  after = null,
  limit = REVIEW_PAGE_SIZE,
}: OpenPageArgs = {}): Promise<ReviewPage> {
  const db = await getDatabase();
  const now = Date.now();
  const size = Math.max(1, Math.trunc(limit));

  const where = ["resolved_at IS NULL", "expires_at > ?"];
  const params: (string | number)[] = [now];

  if (kinds !== undefined && kinds.length > 0) {
    where.push(`kind IN (${kinds.map(() => "?").join(", ")})`);
    params.push(...kinds);
  }
  if (after !== null) {
    // Spelled out rather than as SQLite's row-value form `(created_at, id) >
    // (?, ?)`: the two are equivalent, and this one does not depend on the
    // SQLite version bundled with whatever expo-sqlite the app ships.
    where.push("(created_at > ? OR (created_at = ? AND id > ?))");
    params.push(after.createdAt, after.createdAt, after.id);
  }
  params.push(size + 1);

  const rows = await db.getAllAsync<ReviewQueueItemRow>(
    `SELECT * FROM review_queue_items
     WHERE ${where.join(" AND ")}
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    params,
  );

  // `id ASC` is the tiebreak the cursor above assumes. Without it SQLite is
  // free to return same-millisecond rows in any order it likes, and a cursor
  // built from "the last row" of an unstable page points into the middle of a
  // group whose remainder is then skipped.
  const items = rows.slice(0, size).map(rowToReviewQueueItem);
  const last = items[items.length - 1];
  const nextCursor =
    rows.length > size && last !== undefined ? { createdAt: last.createdAt, id: last.id } : null;
  return { items, nextCursor };
}

/**
 * Open items per kind — what the filter chips count, in ONE grouped read
 * rather than seven `countOpen`-shaped queries.
 *
 * EVERY KIND IS PRESENT, ZEROES INCLUDED. A caller that had to distinguish
 * "absent key" from "zero" would get it wrong at the exact moment it matters:
 * the last item of a kind being triaged away while its chip is the selected
 * filter. `REVIEW_KINDS` is the list, so a kind added to the union later is a
 * compile error there rather than a chip that never appears here.
 */
export async function countOpenByKind(): Promise<Record<ReviewQueueItem["kind"], number>> {
  const db = await getDatabase();
  const now = Date.now();
  const rows = await db.getAllAsync<{ kind: ReviewQueueItem["kind"]; count: number }>(
    `SELECT kind, COUNT(*) AS count FROM review_queue_items
     WHERE resolved_at IS NULL AND expires_at > ?
     GROUP BY kind`,
    [now],
  );

  const counts = Object.fromEntries(REVIEW_KINDS.map((kind) => [kind, 0])) as Record<
    ReviewQueueItem["kind"],
    number
  >;
  for (const row of rows) {
    // Guarded rather than assigned blind: `kind` is a CHECK-constrained column,
    // but a row written by an older build carrying a kind this one has since
    // dropped would otherwise add a key no chip knows how to label.
    if (row.kind in counts) counts[row.kind] = row.count;
  }
  return counts;
}

/**
 * A single item BY ID, resolved or not — the one lookup `listOpen`'s predicate
 * deliberately can't serve. Task 11's `confirmOneSidedTransfer` needs to prove
 * an item it just resolved actually carries a `resolvedAt`, and a resolved row
 * is invisible to `listOpen` by design.
 */
export async function getReviewItem(id: string): Promise<ReviewQueueItem | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ReviewQueueItemRow>(
    "SELECT * FROM review_queue_items WHERE id = ?",
    [id],
  );
  return row ? rowToReviewQueueItem(row) : null;
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
