// lib/income/candidates.ts — which ledger rows even count as income, and which
// of them form the user's main pay stream (m2 Task 9; income rules 1-4).
//
// PURE, AND NO CLOCK. Both functions take everything they need as arguments
// (m2 Global Constraint 6), so a trailing-120-day window, a leap February and a
// December bonus are all ordinary inputs rather than dates someone has to wait
// for. Cadence detection itself is m2-part2 Task 10 and reads what this
// produces.
//
// THE COST OF GETTING THIS WRONG IS ASYMMETRIC, which is why both filters below
// err toward exclusion. A phantom payday raises `averageAmount`, which raises
// every percent-of-income limit, which stops the app warning the user at the
// point they asked to be warned — silently, and in the direction of
// overspending. A missed real payday only delays detection.
import type { Centavos, Transaction } from "@/types/domain";

export type CandidateEvent = {
  transactionId: string;
  walletId: string;
  amount: Centavos;
  occurredAt: number;
  merchant: string | null;
  /**
   * Carried alongside `merchant`, and NOT in the m2 plan's version of this
   * type. Rule 4 groups on "normalized `merchant`/**counterparty** where
   * present" — a *padala* names a person, not a merchant, so with merchant
   * alone every padala from every relative collapses into one empty-named
   * group and the "largest stream" becomes an artefact of that collapse.
   */
  counterparty: string | null;
};

/** ₱500.00 — income rule 1's noise floor, INCLUSIVE. */
const NOISE_FLOOR: Centavos = 50_000;

/** Rule 2's refund window: the 7 days BEFORE the credit. */
const REFUND_WINDOW_MS = 7 * 86_400_000;

/**
 * Case- and space-insensitive name matching. Provider notifications are
 * consistent about neither, and `"SHOPEE"` vs `" shopee "` deciding whether a
 * refund counts as income is not a distinction anyone intended.
 */
function normalizeName(name: string | null): string {
  return (name ?? "").trim().toUpperCase();
}

/**
 * Candidate income events, per income rules 1-3.
 *
 * `transactions` must include BOTH directions: rule 2's refund test needs the
 * outflows to compare against, so passing only credits silently disables it.
 * Every row here is by definition committed — a Review Queue item is not a
 * `Transaction` yet — which is rule 1's "committed" clause.
 */
export function selectCandidates(
  transactions: Transaction[],
  loanPaymentTxIds: Set<string>,
): CandidateEvent[] {
  const outflows = transactions.filter((transaction) => transaction.direction === "out");

  /**
   * Rule 2. Anchored on a PRIOR outflow: an outflow that happens after the
   * credit cannot be what the credit refunds, and dropping the ordering check
   * would silence a genuine payday merely because a purchase of the same size
   * at the same merchant followed it.
   *
   * A credit with no merchant never matches. Two unnamed rows of the same size
   * are not evidence of anything, and pairing them would drop real income from
   * providers that name nobody.
   */
  function isRefund(credit: Transaction): boolean {
    const merchant = normalizeName(credit.merchant);
    if (merchant === "") return false;

    return outflows.some((outflow) => {
      if (normalizeName(outflow.merchant) !== merchant) return false;
      if (outflow.amount !== credit.amount) return false;
      const elapsed = credit.occurredAt - outflow.occurredAt;
      return elapsed > 0 && elapsed <= REFUND_WINDOW_MS;
    });
  }

  return transactions
    .filter(
      (transaction) =>
        transaction.direction === "in" &&
        // Internal movements are never income (domain invariant 2). Without
        // this, moving money between your own wallets manufactures income.
        transaction.transferLinkId === null &&
        // Nor is a balance correction (017_transaction_adjustments). A user who
        // tells the app "this wallet already held ₱5,000" has not been paid
        // ₱5,000, and treating it as a pay packet would teach the cadence
        // detector a payday that never happens and inflate every
        // percent-of-income limit built on it.
        !transaction.isAdjustment &&
        // A borrower repaying you is your own money coming back (loans r17).
        !loanPaymentTxIds.has(transaction.id) &&
        transaction.amount >= NOISE_FLOOR &&
        !isRefund(transaction),
    )
    .map((transaction) => ({
      transactionId: transaction.id,
      walletId: transaction.walletId,
      amount: transaction.amount,
      occurredAt: transaction.occurredAt,
      merchant: transaction.merchant ?? null,
      counterparty: transaction.counterparty ?? null,
    }));
}

/** Middle value; the mean of the middle two for an even count. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Wallet plus whoever paid — rule 4's key, before the amount band. */
function streamKey(event: CandidateEvent): string {
  const payer = normalizeName(event.merchant) || normalizeName(event.counterparty);
  return `${event.walletId}|${payer}`;
}

type Group = { key: string; amounts: number[]; events: CandidateEvent[] };

/**
 * The primary income stream — income rule 4: candidates grouped by
 * `(walletId, normalized merchant/counterparty, amount within ±30% of the
 * group's RUNNING median)`, largest group wins. MVP models exactly one
 * IncomeProfile, and this is the stream it represents.
 *
 * RUNNING median, not the group's first amount, so a raise that arrives over
 * several pay periods stays one stream instead of splitting into a "before" and
 * an "after".
 *
 * Events are processed and returned in CHRONOLOGICAL order. Cadence detection
 * reads the gaps between consecutive events (rule 6), so an unordered stream
 * would produce negative gaps and confirm nothing.
 *
 * A ONE-EVENT GROUP IS STILL RETURNED, despite rule 4's word "recurring".
 * Whether a stream is established is rule 6's job, with its own evidence
 * thresholds; suppressing a singleton here would hide the FIRST payday of a
 * genuinely new stream, which is exactly one event until the second arrives.
 *
 * Ties go to the group whose first event is earliest — `Array.sort` is stable
 * and the groups are built in chronological order. An arbitrary winner would
 * make the user's income figure depend on iteration order.
 */
export function primaryStream(events: CandidateEvent[]): CandidateEvent[] {
  const groups: Group[] = [];
  const chronological = [...events].sort((a, b) => a.occurredAt - b.occurredAt);

  for (const event of chronological) {
    const key = streamKey(event);

    // The CLOSEST in-band group, not merely the first. Two bands under one key
    // can both accept a value that sits between them, and the nearer one is the
    // one it belongs to.
    let best: Group | undefined;
    let bestDistance = Infinity;
    for (const group of groups) {
      if (group.key !== key) continue;
      const middle = median(group.amounts);
      const distance = Math.abs(event.amount - middle);
      if (distance <= middle * 0.3 && distance < bestDistance) {
        best = group;
        bestDistance = distance;
      }
    }

    if (best) {
      best.amounts.push(event.amount);
      best.events.push(event);
    } else {
      groups.push({ key, amounts: [event.amount], events: [event] });
    }
  }

  if (groups.length === 0) return [];
  return [...groups].sort((a, b) => b.events.length - a.events.length)[0].events;
}
