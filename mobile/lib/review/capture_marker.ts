// lib/review/capture_marker.ts — the one thing that has to happen whenever a
// Transaction built from a captured notification leaves the ledger.
//
// THE FAILURE THIS PREVENTS, STATED PLAINLY. `startIngest`'s recovery sweep
// (`listUnprocessedRawCaptures`) re-runs every stored capture that points at
// neither a Transaction nor a Review Queue card, because that is how a capture
// stranded by a crash mid-pipeline gets finished. A capture whose Transaction
// was deleted DELIBERATELY looks exactly like one stranded by a crash: nothing
// points at it any more. So the next launch parses it again and commits it
// again, under an id the user has never seen — the row they removed, back,
// with no action of theirs behind it.
//
// `raw_notifications_repo.listUnprocessedRawCaptures` carries this in its own
// header as a known property of the two-`NOT EXISTS` design, and the fix it
// names is this marker: a resolved Review Queue item on the capture, which
// satisfies the second `NOT EXISTS` for good.
//
// WHY A RESOLVED CARD AND NOT A COLUMN. `review_queue_items` is already the
// record of "this capture raised a question and the question is closed"; the
// only unusual thing is that the user answered it from the ledger rather than
// from a card. A `processed_at` column on `raw_notifications` would say
// something different (the stages RAN) and would need a migration.
//
// EXTRACTED FROM `resolve_actions.markCaptureMerged` (GAP-108) rather than
// copied beside it. Two ledger paths remove a committed row now — the duplicate
// merge and the transaction-detail delete — and the reasoning above is subtle
// enough that a second copy would drift from the first the moment either is
// touched.
import { enqueue, resolve } from "@/lib/db/repos/review_queue_repo";
import { isRawCaptureUnreferenced } from "@/lib/db/repos/raw_notifications_repo";
import type { ReviewItemPayload } from "@/types/domain";

/**
 * The kind every marker is written under.
 *
 * `possible-duplicate` is what `mergeDuplicate` has always used, and reusing it
 * is deliberate rather than lazy. `review_queue_items.kind` is a CHECK
 * constraint (001_core.sql, widened by 011/012/013), so an honest
 * `ledger-delete` kind would cost a table-rebuild migration plus a new arm in
 * every exhaustive switch over `ReviewKind` in the review UI — for a row that
 * is resolved in the same unit of work that creates it and is therefore never
 * listed, never counted, and never rendered to anybody. The payload below is
 * where the truthful description of what happened goes.
 */
const MARKER_KIND = "possible-duplicate" as const;

/**
 * Records that this capture's question is answered, so the ingest sweep stops
 * treating it as work it never finished.
 *
 * A NO-OP FOR A ROW WITH NO CAPTURE (`null`): a manual, imported or minted
 * transaction was never stored as notification text, so no sweep can find it.
 *
 * A NO-OP WHILE ANYTHING ELSE STILL POINTS AT THE CAPTURE. A real card raised
 * for it already says everything this marker would, and a second row claiming
 * the user was asked twice would be a lie about their triage history.
 * `isRawCaptureUnreferenced` is the sweep's own predicate asked about this one
 * id, so the decision to write is made by the exact question the sweep will ask
 * later.
 *
 * WHICH MEANS THE CALL ORDER IS PART OF THE CONTRACT: call this AFTER the
 * Transaction is deleted, never before. Asked first, the predicate still sees
 * the row about to be removed, answers "referenced", and the marker that would
 * have protected the capture is never written.
 *
 * ISSUES NO TRANSACTION OF ITS OWN. Every caller already runs inside a
 * `withUnitOfWork`, and a marker that survived a rolled-back delete would
 * suppress the sweep for a capture whose Transaction is still there.
 */
export async function markCaptureAnswered(
  rawNotificationId: string | null,
  payload: ReviewItemPayload,
): Promise<void> {
  if (rawNotificationId === null) return;
  if (!(await isRawCaptureUnreferenced(rawNotificationId))) return;

  const marker = await enqueue({ kind: MARKER_KIND, rawNotificationId, payload });
  await resolve(marker.id, "confirmed");
}
