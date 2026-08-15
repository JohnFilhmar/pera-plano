// lib/recurring/pattern_detector.ts — subscription detection (M3 Part 2 Task 5;
// docs/02-domain-model.md §3.10, docs/04-features/10-reports.md rules 17-19).
//
// "₱X/month locked in" — the money that leaves every month whether or not the
// user thinks about it. Pure: transactions in, patterns out, no database and no
// clock beyond the `now` it is handed.
//
// ---------------------------------------------------------------------------
// THREE THRESHOLDS, ONE OF WHICH THE SPEC ACTUALLY SETS
// ---------------------------------------------------------------------------
// The plan defers all three to "the spec's" value. Only the first exists:
//
//   MINIMUM EVIDENCE — domain §3.10 lifecycle: "Created by: the detection job,
//   after AT LEAST 3 INSTANCES at a consistent interval and amount." Two
//   charges are a coincidence.
//
//   AMOUNT TOLERANCE — no number anywhere; §3.10 says only "matched within a
//   tolerance band". Chosen below, with the reasoning stated.
//
//   INTERVAL TOLERANCE — likewise. The one hard requirement is the plan's own
//   rule 4: 28-to-31-day gaps must read as ONE monthly cadence rather than
//   four different ones.
import type { Centavos, Transaction } from "@/types/domain";

const DAY_MS = 86_400_000;

/** Domain §3.10: three instances before anything is proposed. */
export const MIN_OCCURRENCES = 3;

/**
 * How far an amount may drift and still be the same subscription.
 *
 * Generous on purpose. Netflix raising ₱549 to ₱599 is a 9% rise and obviously
 * still Netflix; a load promo that varies by a few pesos is the same promo.
 * The cost of being too tight is a subscription the user never gets told about,
 * which is the entire point of the feature; the cost of being too loose is a
 * suggestion they dismiss in one tap.
 */
const AMOUNT_TOLERANCE_PCT = 15;

/**
 * How far a gap may drift from the cluster's mean, in days.
 *
 * PROPORTIONAL, because a 3-day slip means something different on a weekly
 * charge than on an annual one. 20% of the mean puts monthly at ±6 days, which
 * comfortably absorbs the plan's 28-to-31 requirement AND the wider 28-to-31
 * swing across a February. Floored at 2 so a weekly cadence is not held to
 * ±1.4 days, and capped at 10 so an annual charge cannot swallow a quarterly
 * one.
 */
function intervalToleranceDays(meanDays: number): number {
  return Math.min(10, Math.max(2, meanDays * 0.2));
}

/** Occurrences at which confidence stops rising — twice the minimum evidence. */
const CONFIDENCE_SATURATION = 6;

export type DetectedPattern = {
  merchant: string;
  /** The typical charge — the cluster's median, not its mean (see below). */
  amount: Centavos;
  periodDays: number;
  occurrences: number;
  /** 0..1. Rises with instances, falls with amount and interval variance. */
  confidence: number;
  firstSeenAt: number;
  lastSeenAt: number;
  /** What the Subscriptions screen means by "next charge in 6 days". */
  nextExpectedAt: number;
  transactionIds: string[];
};

/**
 * Recurring charges in a ledger, most expensive per month first.
 *
 * ORDERED BY MONTHLY COST (plan rule 8) rather than by confidence or recency:
 * the list exists to answer "what is this costing me", so the ₱1,200 gym
 * membership belongs above the ₱59 game subscription even when the app is
 * surer about the latter.
 */
export function detectPatterns(transactions: Transaction[], now: number): DetectedPattern[] {
  const candidates = transactions.filter(
    (transaction) =>
      transaction.direction === "out" &&
      // Rule 5: moving money to your own savings every payday is not a
      // subscription. A transfer leg is an internal movement, and counting it
      // would tell the user their own saving habit is a bill.
      transaction.transferLinkId === null &&
      transaction.merchant !== null &&
      transaction.merchant.trim().length > 0,
  );

  const byMerchant = new Map<string, Transaction[]>();
  for (const transaction of candidates) {
    const key = normalizeMerchant(transaction.merchant);
    const group = byMerchant.get(key);
    if (group === undefined) byMerchant.set(key, [transaction]);
    else group.push(transaction);
  }

  const patterns: DetectedPattern[] = [];
  for (const group of byMerchant.values()) {
    for (const cluster of clusterByAmount(group)) {
      const pattern = describe(cluster, now);
      if (pattern !== null) patterns.push(pattern);
    }
  }

  return patterns.sort(
    (a, b) =>
      monthlyCost(b) - monthlyCost(a) ||
      // A stable second key so equal-cost patterns do not shuffle between
      // renders — a list that reorders itself is a list nobody trusts.
      a.merchant.localeCompare(b.merchant),
  );
}

/** Uppercased and stripped to alphanumerics, so "NETFLIX.COM" meets "Netflix". */
export function normalizeMerchant(merchant: string | null): string {
  return (merchant ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

/**
 * Splits one merchant's transactions into groups of similar amount.
 *
 * A merchant CAN have two subscriptions — a ₱149 mobile plan and a ₱1,200
 * annual top-up from the same telco — and averaging them together would report
 * one charge that matches neither. Sorted by amount then split wherever the
 * next amount is outside the running cluster's tolerance.
 */
function clusterByAmount(group: Transaction[]): Transaction[][] {
  const sorted = [...group].sort((a, b) => a.amount - b.amount);
  const clusters: Transaction[][] = [];
  let current: Transaction[] = [];

  for (const transaction of sorted) {
    if (current.length === 0) {
      current = [transaction];
      continue;
    }
    const reference = current[0].amount;
    const tolerance = (reference * AMOUNT_TOLERANCE_PCT) / 100;
    if (transaction.amount - reference <= tolerance) current.push(transaction);
    else {
      clusters.push(current);
      current = [transaction];
    }
  }
  if (current.length > 0) clusters.push(current);

  return clusters;
}

function describe(cluster: Transaction[], now: number): DetectedPattern | null {
  if (cluster.length < MIN_OCCURRENCES) return null;

  const byTime = [...cluster].sort((a, b) => a.occurredAt - b.occurredAt);
  const gaps: number[] = [];
  for (let i = 1; i < byTime.length; i += 1) {
    gaps.push((byTime[i].occurredAt - byTime[i - 1].occurredAt) / DAY_MS);
  }

  // Two charges on the same day are one charge seen twice, not a cadence.
  const meanGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  if (meanGap < 1) return null;

  const tolerance = intervalToleranceDays(meanGap);
  const worstDeviation = Math.max(...gaps.map((gap) => Math.abs(gap - meanGap)));
  // Rule 4's requirement, expressed as a rejection: gaps that disagree by more
  // than the tolerance are not one cadence, they are unrelated purchases from a
  // shop the user happens to visit often.
  if (worstDeviation > tolerance) return null;

  const amounts = byTime.map((transaction) => transaction.amount);
  return {
    merchant: mostCommonMerchant(byTime),
    // The MEDIAN, not the mean: one price rise mid-history drags a mean to a
    // figure that was never charged, where the median lands on a real one.
    amount: median(amounts),
    periodDays: Math.round(meanGap),
    occurrences: byTime.length,
    confidence: confidenceFor(gaps, meanGap, amounts),
    firstSeenAt: byTime[0].occurredAt,
    lastSeenAt: byTime[byTime.length - 1].occurredAt,
    // Projected from the LAST occurrence, not from `now`: a charge three days
    // overdue should read as three days overdue, not be quietly rescheduled.
    nextExpectedAt: byTime[byTime.length - 1].occurredAt + Math.round(meanGap) * DAY_MS,
    transactionIds: byTime.map((transaction) => transaction.id),
  };
}

/**
 * Rises with occurrence count, falls with amount and interval variance
 * (plan rule 6).
 *
 * Three instances is evidence, not proof — it starts at half and saturates at
 * six, so a year-old subscription outranks one seen three times. Both variance
 * penalties are relative, because ±₱50 means one thing on ₱149 and another on
 * ₱12,000.
 */
function confidenceFor(gaps: number[], meanGap: number, amounts: Centavos[]): number {
  const evidence = Math.min(1, gaps.length + 1 >= CONFIDENCE_SATURATION
    ? 1
    : (gaps.length + 1) / CONFIDENCE_SATURATION);

  const intervalSpread = (Math.max(...gaps) - Math.min(...gaps)) / meanGap;
  const meanAmount = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  const amountSpread =
    meanAmount > 0 ? (Math.max(...amounts) - Math.min(...amounts)) / meanAmount : 0;

  const penalty = Math.min(1, intervalSpread + amountSpread);
  return Math.max(0, Math.round(evidence * (1 - penalty) * 100) / 100);
}

/**
 * The label the user actually saw most often. Normalisation is for MATCHING;
 * showing "NETFLIX COM" back to someone whose statement said "Netflix.com"
 * would look like the app mangled it.
 */
function mostCommonMerchant(cluster: Transaction[]): string {
  const counts = new Map<string, number>();
  for (const transaction of cluster) {
    const label = transaction.merchant ?? "";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function median(values: Centavos[]): Centavos {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

/** For ordering only. Reports rule 17 owns the figure the UI displays. */
function monthlyCost(pattern: DetectedPattern): number {
  return (pattern.amount * 30.44) / pattern.periodDays;
}
