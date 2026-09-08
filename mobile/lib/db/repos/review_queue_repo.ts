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
import type {
  Centavos,
  EpochMs,
  NewReviewItem,
  ReviewItemPayload,
  ReviewQueueItem,
  ReviewResolution,
  TxDirection,
} from "@/types/domain";

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
 * The OPEN item already raised for this capture, or `null`.
 *
 * ONE RAW NOTIFICATION MAY RAISE ONE OPEN CARD. The queue had no duplicate
 * defence of any kind before this (2026-09-01): `dedupe_gate.checkDuplicate`
 * compares a parsed event against COMMITTED TRANSACTIONS, so it is blind to an
 * identical event sitting one card away in this table, unconfirmed. Anything
 * that ran the stages over a stored capture twice therefore produced two
 * identical cards — and confirming both puts the same ₱1,000 in the ledger
 * twice, because the second confirm commits before the gate can compare it
 * against the first.
 *
 * THE CAPTURE, AND ONLY THE CAPTURE, IS THE IDENTITY HERE. An earlier revision
 * of this function also matched on the payload — same kind, amount, direction,
 * merchant and wallet inside a window — and that is exactly the suppression
 * `pipeline.test.ts` forbids on the commit path: two genuine ₱100.00 purchases
 * can agree on every one of those fields, and collapsing them deletes a real
 * transaction from the user's ledger. Two distinct captures are two distinct
 * questions; the DedupeGate escalates them to a `possible-duplicate` card and
 * lets the user judge, which is the right answer and not this function's job.
 */
export async function findOpenForRawNotification(
  rawNotificationId: string,
  now: number = Date.now(),
): Promise<ReviewQueueItem | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<ReviewQueueItemRow>(
    `SELECT * FROM review_queue_items
     WHERE resolved_at IS NULL AND expires_at > ? AND raw_notification_id = ?
     LIMIT 1`,
    [now, rawNotificationId],
  );
  return row ? rowToReviewQueueItem(row) : null;
}

/**
 * The movement an open card is already waiting on, as §6 rule 2 states it.
 *
 * `channel` is REQUIRED and is not part of the ingest entry's sketched
 * signature, which is the one place this deliberately says more than the gap
 * entry did. Rule 2 suppresses a second telling only when the two channels are
 * known and DIFFER — a push and its SMS relay are one movement; two same-channel
 * notifications are §6 rule 4's undecidable pair, which the queue exists to ask
 * about. Matching without the channel would collapse two genuine ₱100.00
 * purchases three minutes apart into one card and delete a real transaction,
 * the exact suppression `findOpenForRawNotification` above refuses for the same
 * reason.
 */
export type OpenTwin = {
  providerKey: string;
  amount: Centavos;
  direction: TxDirection;
  channel: "push" | "sms";
  occurredAt: EpochMs;
  /**
   * The incoming telling's reference number, when it carried one. Two
   * references that DISAGREE are the provider's own statement that these are
   * two transactions, and no coincidence of timing outranks it — the same
   * exclusion `matchesTwinWindow` makes by requiring `"unavailable"`.
   */
  referenceNo?: string | null;
  /** §6 rule 2's twin window — `dedupeTwinWindowMs`, passed in, never hardcoded here. */
  windowMs: number;
};

/**
 * The OPEN card already raised for THIS movement on the other channel, or
 * `null`.
 *
 * THE HOLE `checkDuplicate` CANNOT SEE. That gate compares an event against
 * COMMITTED TRANSACTIONS, so a capture that hard-routed — unmapped wallet, a
 * score under the floor — is invisible to it: the push sits in the queue, its
 * SMS relay arrives seconds later, finds nothing committed, and is queued too.
 * The user is asked the same question twice and answering both puts one payment
 * in the ledger twice, because neither confirm has anything to compare against
 * either. This is the queue-side half of the same rule.
 *
 * NEAREST IN TIME WINS, matching `dedupe_gate.nearestInTime`: a twin arrives
 * seconds later, not hours, so when several open cards satisfy the window the
 * closest is the likeliest counterpart.
 *
 * THE PAYLOAD IS READ IN JS, NOT IN SQL. `payload_json` is stored verbatim
 * (rule 1) and this repo does not interpret it in SQL — there is no column to
 * index and no json1 dependency to take on. The row set it scans is one open
 * queue, which the spec itself caps at a "Normal" 25 and calls a backlog beyond.
 *
 * A CARD RAISED BEFORE THIS FIELD SET EXISTED MATCHES NOTHING, by construction:
 * its payload has no `providerKey` and no `channel`, and both are required. It
 * ages out within its 30 days.
 */
export async function findOpenTwin(
  twin: OpenTwin,
  now: number = Date.now(),
): Promise<ReviewQueueItem | null> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ReviewQueueItemRow>(
    `SELECT * FROM review_queue_items
     WHERE resolved_at IS NULL AND expires_at > ? AND raw_notification_id IS NOT NULL
     ORDER BY created_at ASC`,
    [now],
  );

  let nearest: ReviewQueueItem | null = null;
  let smallestDelta = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const item = rowToReviewQueueItem(row);
    const occurredAt = item.payload.occurredAt;
    if (typeof occurredAt !== "number") continue;
    if (!describesSameMovement(item.payload, twin)) continue;

    const delta = Math.abs(occurredAt - twin.occurredAt);
    if (delta > twin.windowMs || delta >= smallestDelta) continue;

    nearest = item;
    smallestDelta = delta;
  }

  return nearest;
}

/**
 * `dedupe_gate.describesSameMovement` plus rule 2's channel test, asked of a
 * queued payload rather than of a committed row.
 *
 * The channel is checked for PRESENCE before it is compared, for the reason the
 * gate spells out at its own `providerKey: null` clause: an absent field is not
 * a wildcard. A payload whose channel was never recorded is no evidence that it
 * is the OTHER one, and `undefined !== "push"` would read it as exactly that.
 */
function describesSameMovement(payload: ReviewItemPayload, twin: OpenTwin): boolean {
  if (payload.providerKey !== twin.providerKey) return false;
  if (payload.amount !== twin.amount) return false;
  if (payload.direction !== twin.direction) return false;
  if (conflictingReferences(payload.referenceNo, twin.referenceNo)) return false;

  return payload.channel !== undefined && payload.channel !== twin.channel;
}

/**
 * True only when BOTH references are usable and they differ — `dedupe_gate`'s
 * `compareReferences` reduced to the one answer this needs.
 *
 * Blank is absent, and absent is not a mismatch: most notifications carry no
 * reference at all, and reading a missing one as disagreement would disable the
 * twin window for exactly the pairs it exists to catch. Case and surrounding
 * whitespace are folded because a push template and an SMS template are written
 * by different teams and one of them shouts; the interior is left alone, since
 * stripping separators is how two genuinely different codes start colliding.
 */
function conflictingReferences(left: unknown, right: string | null | undefined): boolean {
  const a = typeof left === "string" ? left.trim().toLowerCase() : "";
  const b = right?.trim().toLowerCase() ?? "";
  if (a === "" || b === "") return false;

  return a !== b;
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
 * Clears an item's `resolved_at`, putting the card back in front of the user —
 * the reverse of `resolve`, and the persistence half of spec rule 9's
 * ten-second undo.
 *
 * Returns whether a row was actually reopened, so a caller can tell "the undo
 * took" from "there was nothing to undo". A missing id and an already-open item
 * are both a silent `false`, mirroring `resolve`'s own idempotence: a second tap
 * on an offer that has already been taken is not an error worth telling anyone
 * about.
 *
 * WHAT THIS FUNCTION DELIBERATELY DOES NOT DECIDE IS WHETHER REOPENING IS SAFE.
 * Two kinds of resolved row here must never come back. A marker written by
 * `markCaptureMerged` (resolved inside the same unit of work that creates it,
 * and never shown to anyone) would become a card about a movement the user
 * already merged away. And any card whose triage COMMITTED a Transaction would
 * invite a second confirmation of a row the ledger already holds — the
 * double-post `findOpenForRawNotification` above exists to prevent, reintroduced
 * by the undo. Neither test belongs in a repository: one is a question about
 * age, the other about a different aggregate. `undoResolution` in
 * lib/review/resolve_actions.ts is the ONLY caller, and it asks both first.
 *
 * `expires_at` IS NOT TOUCHED. The hygiene clock (rules 21-25) runs from
 * arrival, not from triage, and restarting it here would let a card outlive the
 * raw text that justifies it (domain invariant 3, spec rule 21). A reopened item
 * therefore keeps exactly the lifetime it had before it was triaged — which is
 * also why `undoResolution` refuses an item that expired in the meantime rather
 * than handing `purgeExpired` a row the user just asked to see again.
 */
export async function reopen(id: string): Promise<boolean> {
  const db = await getDatabase();
  const result = await db.runAsync(
    "UPDATE review_queue_items SET resolved_at = NULL WHERE id = ? AND resolved_at IS NOT NULL",
    [id],
  );
  return result.changes > 0;
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
