// lib/wallets/reconcile.ts — what a cash reconciliation writes (m1c Task 5
// rule 5; docs/04-features/02-wallets.md §cash Wallet reconciliation).
//
// Cash cannot send notifications, so a cash wallet's balance is only ever as
// good as what the user remembered to enter. Reconciliation is the repair: the
// app asks what is actually in their pocket and records the gap.
//
// THE GAP, NOT THE TOTAL. This is the whole file. The ledger already accounts
// for everything it knows about; the only new fact is the DIFFERENCE between
// what it believes and what is true. Writing the physical total instead would
// leave the wallet holding the sum of both figures — the single worst
// arithmetic error available in this flow, and the easy one to write.
//
// IT NEVER EDITS PAST TRANSACTIONS (spec rule 5 of the plan's Task 5, and the
// reason the return value is an adjustment rather than a patch). The ledger is
// a history. Rewriting yesterday to make today's number come out right is how a
// money app stops being something a user can check.
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import type { Centavos, TxDirection } from "@/types/domain";

/**
 * Spec §cash Wallet reconciliation rule 3, verbatim: `note` = "Cash
 * reconciliation". It is what the user sees in the ledger, and it has to say
 * plainly why a transaction they never made is sitting there.
 */
export const RECONCILE_NOTE = "Cash reconciliation";

/**
 * UNCATEGORIZED, NOT FEES & CHARGES — and this is a deliberate departure from
 * the plan, resolved the way Global Constraints says to resolve it ("Where this
 * plan and a spec disagree, the spec wins").
 *
 * The plan's Task 5 rule 5 says "categorized to Fees & Charges".
 * docs/04-features/02-wallets.md §cash Wallet reconciliation rule 3 says
 * "`categoryId` = Uncategorized", and its rule 14 adds that these deltas "can be
 * recategorized" like any transaction, with §flow rule 3's own example being a
 * recategorization "to Transport".
 *
 * The spec is also simply right. Missing cash is missing because it was SPENT —
 * jeepney fares, palengke, a round of drinks — not because a bank charged a
 * fee. Filing every gap under Fees & Charges would invent a fee category that
 * grows every week and quietly misstate where the user's money actually goes,
 * which is the one thing a spending tracker exists to get right. Uncategorized
 * is the app's honest "we do not know", and it is already the bucket the
 * Categorizer uses for exactly that.
 */
export const RECONCILE_CATEGORY_ID = UNCATEGORIZED_ID;

/** One adjustment transaction, waiting for a wallet and a clock. */
export type CashAdjustment = {
  direction: TxDirection;
  /** Always positive — the schema's `CHECK (amount > 0)` rejects anything else. */
  amount: Centavos;
};

/**
 * The single adjustment that reconciles `recorded` to `physical`, or `null`
 * when the two already agree.
 *
 * THE SIGN FOLLOWS THE GAP, and the direction is the spec's:
 *   physical < recorded → `out`. Money left without a notification, and missing
 *     cash almost always WAS spent — "honest totals over pretty totals"
 *     (spec rule 3). Recording it as income would turn a shortfall into a
 *     windfall and take every spend total with it.
 *   physical > recorded → `in`. Money arrived the app never saw.
 *
 * `null` FOR AGREEMENT, never a zero-amount row. `CHECK (amount > 0)` would
 * reject one anyway, but the point is what the ledger would read like: a weekly
 * habit of confirming your cash is right should leave no trace at all, not a
 * growing column of ₱0.00 entries saying nothing happened.
 *
 * No tolerance is applied. Drift tolerance
 * (`tunables.balanceDriftToleranceCentavos`) is about how far a PROVIDER's
 * reported figure may sit from the computed one before the app complains — a
 * parser-quality question. Here the user has typed a fact about their own
 * pocket, and rounding it away would leave the wallet disagreeing with the
 * number they just entered.
 */
export function cashAdjustment(
  recorded: Centavos,
  physical: Centavos,
): CashAdjustment | null {
  const difference = physical - recorded;
  if (difference === 0) return null;

  return difference > 0
    ? { direction: "in", amount: difference }
    : { direction: "out", amount: -difference };
}
