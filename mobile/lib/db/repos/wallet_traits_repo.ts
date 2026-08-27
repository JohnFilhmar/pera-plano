// lib/db/repos/wallet_traits_repo.ts — where the held/owed verdict is stored,
// and the running scores that justify it.
//
// THE VERDICT IS SEPARATE FROM THE EVIDENCE, DELIBERATELY. `wallets.owed_balance`
// is what every screen reads; `wallet_trait_evidence` is only WHY. Keeping the
// running scores out of the wallets table means a rewrite of the scoring rules
// (lib/wallets/classification.ts) never touches the row the whole app joins
// against, and a corrupt or reset score cannot take a wallet's balance with it.
//
// NOTHING HERE DECIDES ANYTHING. The rules live in the pure classifier; this
// file adds up numbers, writes them down, and refuses to overwrite a wallet
// whose owner has already answered the question.
import { getDatabase } from "@/lib/db/database";
import { EMPTY_EVIDENCE } from "@/lib/wallets/classification";

import type { EvidenceDelta, OwedVerdict, TraitEvidence } from "@/lib/wallets/classification";

type EvidenceRow = { owed_score: number; held_score: number; sample_count: number };

/** A wallet with no history reads as `EMPTY_EVIDENCE`, never as `null`. */
export async function getTraitEvidence(walletId: string): Promise<TraitEvidence> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<EvidenceRow>(
    "SELECT owed_score, held_score, sample_count FROM wallet_trait_evidence WHERE wallet_id = ?",
    [walletId],
  );
  if (!row) return EMPTY_EVIDENCE;
  return { owedScore: row.owed_score, heldScore: row.held_score, sampleCount: row.sample_count };
}

/**
 * Folds one capture's delta in and returns the new total.
 *
 * A DELTA THAT SCORED NOTHING IS NOT WRITTEN AND NOT COUNTED. Most
 * notifications carry no trait signal and no balance at all; counting them
 * would walk every wallet past the classifier's sample floor on silence, which
 * is the exact opposite of evidence.
 */
export async function recordTraitEvidence(
  walletId: string,
  delta: EvidenceDelta,
): Promise<TraitEvidence> {
  if (delta.owed === 0 && delta.held === 0) return getTraitEvidence(walletId);

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO wallet_trait_evidence (wallet_id, owed_score, held_score, sample_count, updated_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(wallet_id) DO UPDATE SET
       owed_score   = owed_score + excluded.owed_score,
       held_score   = held_score + excluded.held_score,
       sample_count = sample_count + 1,
       updated_at   = excluded.updated_at`,
    [walletId, delta.owed, delta.held, Date.now()],
  );
  return getTraitEvidence(walletId);
}

/**
 * Sets the verdict directly. `pinned: true` means the USER said so — through
 * the review-queue question or the wallet screen's correction — and from then
 * on inference reads this wallet without ever writing it again.
 */
export async function setWalletOwed(
  walletId: string,
  owed: boolean,
  opts: { pinned: boolean },
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE wallets SET owed_balance = ?, owed_pinned = ?, updated_at = ? WHERE id = ?",
    [owed ? 1 : 0, opts.pinned ? 1 : 0, Date.now(), walletId],
  );
}

/**
 * Applies an INFERRED verdict, returning whether the wallet actually moved so
 * the caller knows whether anything needs invalidating.
 *
 * THREE SILENT REFUSALS, and each one is a rule rather than an optimisation:
 *
 *   NOT CONFIDENT. `{ owed: false, confident: false }` is the assumed-held
 *   default, not a finding. Writing it would record an assumption as a decision.
 *
 *   PINNED. The user answered. Inference does not get a second opinion.
 *
 *   ALREADY THAT WAY. Nothing to do, and skipping the write keeps `updated_at`
 *   honest about when the wallet last actually changed.
 */
export async function applyOwedVerdict(walletId: string, verdict: OwedVerdict): Promise<boolean> {
  if (!verdict.confident) return false;

  const db = await getDatabase();
  const row = await db.getFirstAsync<{ owed_balance: number; owed_pinned: number }>(
    "SELECT owed_balance, owed_pinned FROM wallets WHERE id = ?",
    [walletId],
  );
  if (!row || row.owed_pinned === 1) return false;
  if ((row.owed_balance === 1) === verdict.owed) return false;

  await setWalletOwed(walletId, verdict.owed, { pinned: false });
  return true;
}

/**
 * Whether this wallet has ever been asked about.
 *
 * RESOLVED ITEMS COUNT. Dismissing the question is itself an answer — the user
 * declined to say, and re-raising the same card on the next capture would turn
 * a question into nagging. One per wallet, ever.
 *
 * A `LIKE` over `payload_json` rather than a joined column, because the review
 * queue stores payloads opaquely by design (see `ReviewItemPayload`) and this
 * is the only query that needs to look inside one. If the queue ever grows a
 * real payload index, this moves to it.
 */
export async function hasEverAskedWalletKind(walletId: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM review_queue_items
      WHERE kind = 'wallet-kind-unclear' AND payload_json LIKE ?`,
    [`%"walletId":"${walletId}"%`],
  );
  return (row?.n ?? 0) > 0;
}
