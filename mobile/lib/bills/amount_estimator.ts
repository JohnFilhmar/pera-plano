// lib/bills/amount_estimator.ts — what a Bill currently costs (m2c Task 3).
//
// Pure: a bill and its payment amounts in, a figure out. Safe-to-Spend
// subtracts this (spec rule 9), the list renders it with a `~` prefix (rule 7),
// and rule 8's ">30% deviation always asks for confirmation" is measured
// against it.
//
// ---------------------------------------------------------------------------
// THE MEAN OF THE LAST THREE, NOT A MEDIAN
// ---------------------------------------------------------------------------
// The m2c plan specifies the median, arguing that "a single summer electricity
// spike must not permanently raise every future estimate". docs/04-features/
// 07-bills.md rule 6 says the opposite in as many words — "the estimate becomes
// the ARITHMETIC MEAN of the LAST THREE matched payment amounts (fewer if
// history is shorter)" — and its Open Questions show the choice was deliberate:
//
//   "The mean of the last three payments is simple and explainable, but a
//    single spike month (aircon season Meralco) distorts it for two further
//    cycles. Median-of-five is more robust but needs longer history. DECIDE
//    AFTER REAL PAYMENT VARIANCE DATA EXISTS FROM BETA USERS."
//
// The plan ships that deferred answer as though it had been decided. The spike
// is not ignored here, it EXPIRES: two cycles on it has left the window of
// three. That bounded distortion is what the spec accepted, and switching
// statistics is a product decision waiting on beta data, not an implementation
// detail.
//
// THERE IS NO MINIMUM SAMPLE, for the same reason. The plan gates history
// behind one; "fewer if history is shorter" is the spec's whole answer, and
// withholding a real observed amount in favour of a figure the user guessed
// once would make the month after every bill's first payment knowingly wrong.
//
// SKIPPED CYCLES CANNOT REACH THIS FUNCTION, which is rule 6's other half
// ("skipped cycles and rejected matches never feed the estimate"). It takes
// PAYMENTS, and a skipped or externally-resolved cycle has none by
// construction — see migration 006.
import type { Bill, Centavos, IsoDate } from "@/types/domain";

/**
 * How many matched payments the estimate averages. Spec rule 6.
 *
 * Also the reason `spread` is a range rather than the plan's interquartile
 * range: an IQR of three points discards the two the sample is almost entirely
 * made of.
 */
export const ESTIMATE_WINDOW = 3;

/**
 * One matched payment, as this module needs it.
 *
 * NOT `BillPayment`, which the plan's signature names. A `BillPayment` carries
 * no amount on purpose — the figure lives on the linked ledger transaction, so
 * that the bill history and the ledger can never disagree about the same peso
 * (see lib/db/repos/bills_repo.ts). The service joins the two and passes the
 * result, which also keeps every case in the tests a plain fixture.
 */
export type PaymentAmount = {
  /** The cycle this paid — the timeline, since input order is not one. */
  cycleDueDate: IsoDate;
  amount: Centavos;
};

export type AmountEstimate = {
  amount: Centavos;
  /** Where the figure came from, so the UI knows whether to prefix a `~`. */
  basis: "fixed" | "seed" | "history";
  /** How many payments were averaged. `0` for both non-history bases. */
  sampleSize: number;
  /**
   * Largest minus smallest across the payments averaged — what lets the UI say
   * "usually ₱1,800-₱2,400" instead of a false-precision single figure. `0`
   * for a steady bill, a lone payment, or no history at all.
   */
  spread: Centavos;
};

export function estimateAmount(bill: Bill, payments: PaymentAmount[]): AmountEstimate {
  // Spec rule 5: a fixed bill "changes only when the user edits it". Rent that
  // quietly re-estimated itself from a month the user overpaid would be worse
  // than useless — an exact figure was set precisely because it is exact.
  if (bill.amountMode === "fixed") {
    return { amount: bill.amount, basis: "fixed", sampleSize: 0, spread: 0 };
  }

  // A zero or negative amount reads as "this bill is free" and would silently
  // remove a real obligation from Safe-to-Spend. Ledger transactions are
  // already positive by schema CHECK; this is the belt to that braces.
  const usable = payments.filter((payment) => payment.amount > 0);

  if (usable.length === 0) {
    return { amount: bill.amount, basis: "seed", sampleSize: 0, spread: 0 };
  }

  // By CYCLE, not by input order: a payment confirmed today can belong to a
  // cycle three months old, and trusting the array would let one late
  // confirmation redefine which three payments count.
  const recent = [...usable]
    .sort((a, b) => (a.cycleDueDate < b.cycleDueDate ? -1 : a.cycleDueDate > b.cycleDueDate ? 1 : 0))
    .slice(-ESTIMATE_WINDOW);

  const amounts = recent.map((payment) => payment.amount);
  const total = amounts.reduce((sum, amount) => sum + amount, 0);

  return {
    // Rounded to a whole centavo — a third of a peso surviving as a float would
    // spread through Safe-to-Spend as a fraction nobody can pay.
    amount: Math.round(total / amounts.length),
    basis: "history",
    sampleSize: amounts.length,
    spread: Math.max(...amounts) - Math.min(...amounts),
  };
}
