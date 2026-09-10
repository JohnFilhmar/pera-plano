// lib/db/repos/transfer_links_repo.ts — the only SQL surface for TransferLink
// (interface contract §3; docs/02-domain-model.md §3.3).
//
// A TransferLink is the record that two Transactions are one internal movement
// — a BPI→GCash cash-in, a padala to your own SeaBank account — so that the
// pair stops counting as a real expense and a real income while the wallet
// balances still move (domain invariant I2).
//
// WHAT MAKES THIS REPO DIFFERENT FROM THE OTHERS. Writing the link row alone
// changes nothing anybody reads. Every total in the app — `sumSpend`,
// Safe-to-Spend, Limits, reports — excludes a leg by testing
// `transactions.transfer_link_id IS NULL`, so the stamp on the two legs IS the
// exclusion. Link and stamp therefore happen in one SQL transaction, always:
// a link row whose legs were not stamped is invisible, and stamped legs with no
// link row are money that has silently left the ledger's totals.
//
// Same house shape as wallets_repo.ts: thin functions over getDatabase(),
// domain types from types/domain.ts, no entitlement checks (transfer linking is
// ungated on both tiers — domain §3.3 "Tier note").
import { getDatabase } from "@/lib/db/database";
import { newId } from "@/lib/ids";
import type { Centavos, TransferLink } from "@/types/domain";

type TransferLinkRow = {
  id: string;
  out_transaction_id: string;
  in_transaction_id: string;
  fee_amount: number;
  status: string;
  detected_by: string;
  confidence: number;
  created_at: number;
  updated_at: number;
};

function rowToTransferLink(row: TransferLinkRow): TransferLink {
  return {
    id: row.id,
    outTransactionId: row.out_transaction_id,
    inTransactionId: row.in_transaction_id,
    feeAmount: row.fee_amount,
    status: row.status as TransferLink["status"],
    detectedBy: row.detected_by as TransferLink["detectedBy"],
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Thrown when a leg handed to `linkTransfer` is already half of another link.
 *
 * DOMAIN §3.3 INVARIANT 3 — a Transaction belongs to at most one Transfer Link
 * — AND UNTIL NOW IT WAS ENFORCED IN ONE PLACE ONLY, `transfer_detector.ts`'s
 * candidate filter, which covers the auto path and nothing else. Every manual
 * route reached the `UPDATE ... WHERE id IN (?, ?)` below, which happily
 * re-stamped a leg that already carried a link id: the old `transfer_links` row
 * stayed `active` with one leg still pointing at it and the other pointing
 * somewhere new. That orphaned partner is not a bookkeeping smudge — every
 * total in the app excludes a leg by testing `transfer_link_id IS NULL`, so the
 * moment its twin is taken away it re-enters spend or income on its own, and
 * the user watches a transfer they already settled turn back into a purchase.
 *
 * LOUD RATHER THAN SILENT, because there is no safe quiet answer. Dissolving
 * the old link to make room would delete a pairing the user or the detector
 * already committed to, and skipping the write would return a link id that
 * describes a different pair. The callers that can actually reach this state
 * are the ones that know what to do about it (`lib/review/resolve_actions.ts`
 * treats it as a card that is already handled); a caller that has not thought
 * about it should fail rather than corrupt totals.
 */
export class AlreadyLinkedError extends Error {
  constructor(
    public readonly transactionId: string,
    public readonly transferLinkId: string,
  ) {
    super(`transaction ${transactionId} already belongs to transfer link ${transferLinkId}`);
    this.name = "AlreadyLinkedError";
  }
}

/**
 * How the pairing was arrived at. Absent means the user did it by hand, which
 * is both the schema's default (`001_core.sql:76`) and the honest reading of a
 * caller that said nothing about a detector.
 *
 * The plan's `linkTransfer(out, in, feeAmount)` signature predates a look at
 * the shipped DDL, which carries three more columns than it suggests. They are
 * added as one optional argument rather than by reshaping the pinned three:
 * `detectedBy` and `confidence` are what the Transaction detail sheet reads to
 * say "PeraPlano matched these automatically (95%)" versus "you linked these",
 * and domain §3.3 requires that distinction. `status` is not offered — a link
 * is created active and only `unlinkTransfer` may dissolve it.
 */
export type TransferLinkOrigin = {
  detectedBy?: TransferLink["detectedBy"];
  /** The detector's score for an auto link; 1.0 for a manual one (domain §3.3). */
  confidence?: number;
};

/**
 * Pairs an out-leg with an in-leg and takes both out of every total.
 *
 * `feeAmount` is `outLeg.amount − inLeg.amount`, computed by the CALLER because
 * only it holds both legs. Stored verbatim, including a NEGATIVE value: domain
 * §3.3 reads a negative fee as a credited bonus (a cash-in promo), and clamping
 * it to zero would erase money the user actually gained. Informational only in
 * MVP — nothing in the app adds it to a spend total, which is what makes it
 * safe to record at all.
 *
 * Not validated here: that the legs really are one `in` and one `out`, in
 * different wallets. Those are the TransferDetector's rule 1 conditions (spec
 * §7) and the Review Queue's confirmation step; re-deciding them in the
 * repository would put the rules in two places, and a manual link made from the
 * transaction detail screen is deliberately exempt from the detector's
 * thresholds (domain §3.3 invariant 4).
 *
 * THAT BOTH LEGS ARE UNLINKED *IS* VALIDATED HERE, and it is the exception to
 * the paragraph above for the reason that paragraph gives. Those other rules
 * are judgements a caller may legitimately overrule; invariant 3 is not, and
 * this UPDATE is the only statement in the app that can break it. Checked
 * inside the transaction, so nothing can slip a link onto either leg between
 * the read and the stamp. See `AlreadyLinkedError`.
 */
export async function linkTransfer(
  outTransactionId: string,
  inTransactionId: string,
  feeAmount: Centavos,
  origin: TransferLinkOrigin = {},
): Promise<TransferLink> {
  const db = await getDatabase();
  const now = Date.now();
  const link: TransferLink = {
    id: newId(),
    outTransactionId,
    inTransactionId,
    feeAmount,
    status: "active",
    detectedBy: origin.detectedBy ?? "manual",
    confidence: origin.confidence ?? 1,
    createdAt: now,
    updatedAt: now,
  };

  await db.withTransactionAsync(async () => {
    // A row per leg, or one row when a caller passed the same id twice — either
    // way, any `transfer_link_id` here means this pairing cannot be made. A leg
    // that is not in the ledger yields no row and is NOT rejected here: linking
    // a phantom writes a link nothing points at, which is a different fault
    // with its own owner (`resolve_actions.linkAsTransfer` refuses it before
    // getting this far), and failing it here would be a second rule in a second
    // place.
    const legs = await db.getAllAsync<{ id: string; transfer_link_id: string | null }>(
      "SELECT id, transfer_link_id FROM transactions WHERE id IN (?, ?)",
      [outTransactionId, inTransactionId],
    );
    for (const leg of legs) {
      if (leg.transfer_link_id !== null) {
        throw new AlreadyLinkedError(leg.id, leg.transfer_link_id);
      }
    }

    await db.runAsync(
      `INSERT INTO transfer_links
         (id, out_transaction_id, in_transaction_id, fee_amount, status, detected_by,
          confidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        link.id,
        link.outTransactionId,
        link.inTransactionId,
        link.feeAmount,
        link.status,
        link.detectedBy,
        link.confidence,
        link.createdAt,
        link.updatedAt,
      ],
    );
    // The stamp IS the exclusion — see the file header.
    await db.runAsync(
      "UPDATE transactions SET transfer_link_id = ?, updated_at = ? WHERE id IN (?, ?)",
      [link.id, now, outTransactionId, inTransactionId],
    );
  });

  return link;
}

/** One link by id, or `null`. */
export async function getTransferLink(id: string): Promise<TransferLink | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<TransferLinkRow>(
    "SELECT * FROM transfer_links WHERE id = ?",
    [id],
  );
  return row ? rowToTransferLink(row) : null;
}

/**
 * Breaks a pairing: both legs revert to countable and the link is marked
 * `dissolved`.
 *
 * DISSOLVED, NOT DELETED, even though domain §3.3 words the lifecycle as
 * "Deleted by: user unlink". Deleting the row would erase the record that the
 * app once proposed this pairing — the one piece of evidence a user needs when
 * the same two transactions get proposed again, and the only trace of an auto
 * link that turned out to be wrong. The `status` column exists precisely to
 * express this state (`001_core.sql:76`), and every read path already filters
 * on the legs' `transfer_link_id`, which this clears, so a dissolved row
 * affects no total.
 *
 * Idempotent: unlinking an unknown or already-dissolved id is a silent no-op,
 * never an error, so a double-tap in the transaction detail sheet cannot fail.
 */
export async function unlinkTransfer(id: string): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();

  await db.withTransactionAsync(async () => {
    await db.runAsync("UPDATE transactions SET transfer_link_id = NULL, updated_at = ? WHERE transfer_link_id = ?", [
      now,
      id,
    ]);
    await db.runAsync(
      "UPDATE transfer_links SET status = 'dissolved', updated_at = ? WHERE id = ? AND status = 'active'",
      [now, id],
    );
  });
}

/**
 * Every link row naming this Transaction as a leg — ACTIVE AND DISSOLVED
 * ALIKE, newest first.
 *
 * WHY THE DISSOLVED ONES ARE THE POINT. `unlinkTransfer` above dissolves rather
 * than deletes, so a leg that has been linked and unlinked twice leaves two
 * rows still holding `out_transaction_id`/`in_transaction_id` foreign keys onto
 * it. Those columns are `NOT NULL` with no ON DELETE action, so they block a
 * DELETE of the transaction exactly as an active link does — and a caller
 * reading only `transactions.transfer_link_id` (which unlinking clears) sees an
 * unlinked row and cannot explain why the delete failed. This is the query that
 * shows it the rows.
 */
export async function listLinksForTransaction(transactionId: string): Promise<TransferLink[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TransferLinkRow>(
    `SELECT * FROM transfer_links
      WHERE out_transaction_id = ? OR in_transaction_id = ?
      ORDER BY created_at DESC`,
    [transactionId, transactionId],
  );
  return rows.map(rowToTransferLink);
}

/**
 * Removes a link row that has ALREADY been dissolved. Idempotent.
 *
 * THE ONLY DELETE IN THIS FILE, AND THE `status` GUARD IS NOT DECORATION.
 * `unlinkTransfer`'s header explains why a broken pairing is kept as evidence;
 * this exists for the one case where that evidence has lost its subject — a leg
 * is leaving the ledger, and a `NOT NULL` foreign key onto a row that will not
 * exist cannot be kept whatever it would document.
 *
 * AN ACTIVE LINK IS A DIFFERENT SITUATION ENTIRELY: its legs are still stamped
 * with this id (`transactions.transfer_link_id` is itself a foreign key onto
 * this table), so deleting it would either fail on that key or silently take a
 * still-paired transaction out of the pairing that keeps it out of every total.
 * The caller unlinks first, deliberately, or it does not get to delete.
 */
export async function deleteDissolvedLink(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM transfer_links WHERE id = ? AND status = 'dissolved'", [id]);
}
