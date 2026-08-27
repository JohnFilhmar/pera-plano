// constants/review_kinds.ts — the queue's kinds as an ORDERED LIST, plus the
// one-or-two-word name each one wears on a filter chip.
//
// WHY A LIST AT ALL. `ReviewKind` is a union, and a union cannot be iterated:
// every place that needs "one control per kind" (the filter chips) or "a count
// per kind" (`countOpenByKind`) was otherwise going to hand-roll its own array,
// which is how a kind added later ends up filtered-by nowhere and counted
// nowhere while every file still typechecks. `EXHAUSTIVE` below turns that
// silent gap into a compile error.
//
// THE ORDER IS THE CHIP ORDER, and `unknown-provider` is deliberately last:
// docs/04-features/08-review-queue.md §UX states puts unrecognized sources in a
// section BELOW the actionable list, because a capture from an app PeraPlano
// cannot read is the one kind where the honest answer is often "not money" —
// it should never be the first thing offered to someone opening the queue to
// triage real transactions.
//
// THE LABELS ARE NOT THE CARDS' SENTENCES. `REASON_FALLBACKS` in
// review_card.tsx explains an individual item in a full sentence; these name a
// GROUP on a chip that has to stay readable at a glance in a horizontal row.
// They are phrased as the question the group is waiting on ("Maybe duplicate",
// "Loan payment?") rather than as pipeline vocabulary ("possible-duplicate",
// "loan-match"), which names a stage the user has no model of.
import type { ReviewKind } from "@/types/domain";

export const REVIEW_KINDS = [
  "low-confidence",
  "possible-duplicate",
  "ambiguous-transfer",
  "one-sided-transfer",
  "loan-match",
  "wallet-kind-unclear",
  "unknown-provider",
] as const satisfies readonly ReviewKind[];

/**
 * Compile-time proof that the list above covers the union.
 *
 * `satisfies` on the array only proves every ENTRY is a real kind — it says
 * nothing about a kind that was never listed, which is exactly the direction
 * this file exists to guard. Adding an eighth `ReviewKind` without adding it
 * here makes `Exclude<...>` non-empty and fails this line.
 */
type Exhaustive = Exclude<ReviewKind, (typeof REVIEW_KINDS)[number]> extends never ? true : never;
const EXHAUSTIVE: Exhaustive = true;
void EXHAUSTIVE;

/** The chip label for each kind — see the file header on why these are not the card sentences. */
export const REVIEW_KIND_LABELS: Record<ReviewKind, string> = {
  "low-confidence": "Needs a check",
  "possible-duplicate": "Maybe duplicate",
  "ambiguous-transfer": "Maybe a transfer",
  "one-sided-transfer": "Missing other half",
  "loan-match": "Loan payment?",
  "wallet-kind-unclear": "Wallet type",
  "unknown-provider": "Unknown app",
};
