// lib/transfers/transfer_service.ts — the only place in the app that creates
// both legs of a transfer.
//
// WHY A SERVICE AND NOT A FORM HANDLER. Three callers need this write: the
// manual entry form, the Review Queue's one-sided confirm, and (later) goal
// contributions. Each one writes two or three ledger rows plus a link, and a
// partial success is a committed leg with no counterpart — an internal movement
// sitting in the user's spend total, which resolve_actions.ts:404 names the
// single most trust-destroying row this app can show. One writer, one set of
// invariants, one place the tests point at.
//
// THE FEE IS A ROW, NOT A FIELD. TransferLink.feeAmount is read by nothing —
// not reports, not Safe-to-Spend, not Limits (transactions_repo.ts:243 says so
// outright), so a fee recorded there is money that provably left the wallet and
// appears in no total. Recorded as an ordinary expense in Fees & Charges it
// counts everywhere, with no aggregate changed, and the user can tap it.
//
// THE LEGS ARE EQUAL because equal legs are an exact-amount pair under
// docs/03-ingest-pipeline.md §7 rule 3.1 — the same shape an auto-detected
// transfer has. A hand-typed transfer therefore never has to be run past the
// detector's fee-tolerance arithmetic.
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { getWallet } from "@/lib/db/repos/wallets_repo";
import { withUnitOfWork } from "@/lib/db/unit_of_work";

import type { Centavos, EpochMs } from "@/types/domain";

/** The seeded Fees & Charges category (categories_repo.ts). */
export const FEES_CATEGORY_ID = "cat_fees_charges";

export type TransferValidationReason =
  | "same_wallet"
  | "unknown_wallet"
  /** The captured leg named by `existingLegId` is not in the ledger. */
  | "unknown_leg"
  | "archived_wallet"
  | "amount_not_positive"
  | "fee_negative"
  | "fee_exceeds_amount"
  | "future_dated";

/**
 * Thrown BEFORE any row is written. Carries a machine-readable `reason` so the
 * form can say which field is wrong without parsing a message.
 */
export class TransferValidationError extends Error {
  readonly reason: TransferValidationReason;

  constructor(reason: TransferValidationReason) {
    super(`transfer rejected: ${reason}`);
    this.name = "TransferValidationError";
    this.reason = reason;
  }
}

export type TransferDraft = {
  fromWalletId: string;
  toWalletId: string;
  /** What LEAVES the source wallet, fee included. */
  amount: Centavos;
  /** 0 when there is none. Subtracted from `amount` to give both legs. */
  feeAmount: Centavos;
  occurredAt: EpochMs;
  note: string | null;
};

export type TransferResult = {
  outLegId: string;
  inLegId: string;
  feeTransactionId: string | null;
  transferLinkId: string;
};

/**
 * Every rule the ledger cannot express and the schema would only catch halfway
 * through a multi-row write.
 *
 * `occurredAt <= now` is spec rule 24: a future-dated entry is money that has
 * not moved counted in this period's spend. `feeAmount < amount` is not
 * pedantry — an equal fee leaves a zero-amount leg, which the schema's
 * `CHECK (amount > 0)` rejects after two rows already exist.
 */
async function validate(draft: TransferDraft, now: EpochMs): Promise<void> {
  if (draft.fromWalletId === draft.toWalletId) {
    throw new TransferValidationError("same_wallet");
  }
  if (draft.amount <= 0) throw new TransferValidationError("amount_not_positive");
  if (draft.feeAmount < 0) throw new TransferValidationError("fee_negative");
  if (draft.feeAmount >= draft.amount) throw new TransferValidationError("fee_exceeds_amount");
  if (draft.occurredAt > now) throw new TransferValidationError("future_dated");

  const [from, to] = await Promise.all([
    getWallet(draft.fromWalletId),
    getWallet(draft.toWalletId),
  ]);
  if (from === null || to === null) throw new TransferValidationError("unknown_wallet");
  if (from.isArchived || to.isArchived) throw new TransferValidationError("archived_wallet");
}

/**
 * Records a movement between two of the user's own wallets.
 *
 * `now` is a parameter rather than a clock read so the future-date rule is
 * reproducible in a test, matching lib/transactions/manual_entry.ts's stance.
 */
export async function recordTransfer(
  draft: TransferDraft,
  now: EpochMs,
): Promise<TransferResult> {
  await validate(draft, now);

  const legAmount = draft.amount - draft.feeAmount;

  return withUnitOfWork(async () => {
    const outLeg = await insertTransaction({
      walletId: draft.fromWalletId,
      categoryId: UNCATEGORIZED_ID,
      amount: legAmount,
      direction: "out",
      occurredAt: draft.occurredAt,
      source: "manual",
      confidence: 1,
      note: draft.note,
    });

    const inLeg = await insertTransaction({
      walletId: draft.toWalletId,
      categoryId: UNCATEGORIZED_ID,
      amount: legAmount,
      direction: "in",
      occurredAt: draft.occurredAt,
      source: "manual",
      confidence: 1,
      note: draft.note,
    });

    // Unlinked, deliberately: the fee is a real cost and must keep counting.
    const fee =
      draft.feeAmount > 0
        ? await insertTransaction({
            walletId: draft.fromWalletId,
            categoryId: FEES_CATEGORY_ID,
            amount: draft.feeAmount,
            direction: "out",
            occurredAt: draft.occurredAt,
            source: "manual",
            confidence: 1,
            note: "Transfer fee",
          })
        : null;

    // 0, and that is the field's own definition (types/domain.ts:163):
    // outLeg.amount − inLeg.amount, and the legs are equal.
    const link = await linkTransfer(outLeg.id, inLeg.id, 0, {
      detectedBy: "manual",
      confidence: 1,
    });

    return {
      outLegId: outLeg.id,
      inLegId: inLeg.id,
      feeTransactionId: fee?.id ?? null,
      transferLinkId: link.id,
    };
  });
}
