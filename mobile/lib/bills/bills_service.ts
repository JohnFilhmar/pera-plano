// lib/bills/bills_service.ts — bills against the ledger (m2c Task 4;
// docs/04-features/07-bills.md rules 8-19 and 21-29).
//
// REMINDERS LIVE IN bill_reminders.ts, NOT HERE. `scheduleReminder` reaches
// `expo-notifications` and the `NotificationListener` native module, and this
// module is what a screen calls to draw a list. The m2c plan puts
// `scheduleBillReminders` in this file; m2 Task 8 proved that a screen
// importing the notification stack cannot render under Jest at all, and m2b
// Task 7 split loans the same way before the failure rather than after.
//
// ---------------------------------------------------------------------------
// BILLS AUTO-MATCH; LOANS DO NOT. That difference is deliberate
// ---------------------------------------------------------------------------
// The m2c plan's rule 1 says "nothing is recorded without confirmation — the
// same discipline as loans". The bills spec says otherwise, and says it
// precisely (rule 13): matches 1 and 2 require one-tap confirmation, and "from
// match 3 onward (consecutive confirmations, no rejections) matching is silent
// with undo. Any rejection resets the ladder to confirmation mode."
//
// The two specs differ because the failures differ. A wrong LOAN match corrupts
// the balance AND pulls a transaction out of income detection (loans rule 17),
// so a mistake quietly rewrites the user's income; neither failure announces
// itself. A wrong BILL match marks one cycle paid, is undoable from the bill
// detail, and the alternative is asking the same question about the same
// Meralco bill every month forever.
//
// Two guards keep the earned silence honest: rule 8's ">30% deviation always
// asks, even after the ladder has been earned", and rule 13's reset on any
// rejection.
import {
  ALWAYS_CONFIRM_DEVIATION_PCT,
  LADDER_THRESHOLD,
  OVERDUE_WINDOW_DAYS,
  WINDOW_CLOSES_DAYS_AFTER,
  WINDOW_OPENS_DAYS_BEFORE,
} from "@/constants/bills";
import {
  createBill,
  getBill,
  listBillPayments,
  listBills,
  listCycles,
  recordBillPayment,
  updateBill,
} from "@/lib/db/repos/bills_repo";
import { listLoans, listPayments } from "@/lib/db/repos/loans_repo";
import { getTransaction, listTransactions } from "@/lib/db/repos/transactions_repo";
import { addDaysIso, toDateIso } from "@/lib/dates";
import type {
  Bill,
  BillCycle,
  BillPayment,
  Centavos,
  DueRule,
  IsoDate,
  MatchedBillPayment,
  Transaction,
} from "@/types/domain";

import { estimateAmount, type AmountEstimate, type PaymentAmount } from "./amount_estimator";
import { daysUntil, occurrencesBetween } from "./due_rules";
import { toleranceFor } from "./rule_summary";

const DAY_MS = 86_400_000;

// THE MATCHER'S OWN NUMBERS NOW LIVE IN `constants/bills.ts` (GAP-085), with
// the same names and values. The bill detail's "auto-match rule summary" row
// has to state the tolerance and window this file matches under, and a screen
// cannot import them from here — this module imports the repositories, so the
// import would pull `getDatabase` into the UI layer. Re-exported below only
// where something outside already named them.

/**
 * How far back to enumerate cycles that were never resolved.
 *
 * Rule 23 keeps an overdue cycle open indefinitely, but enumerating from the
 * beginning of time would manufacture a wall of overdue rows for any bill whose
 * rule predates the user's attention. Four monthly cycles is enough to surface
 * a genuinely neglected bill without turning the list into an archive.
 */
const OVERDUE_LOOKBACK_DAYS = 120;

export { ALWAYS_CONFIRM_DEVIATION_PCT, LADDER_THRESHOLD };

/** Below this a transaction is not worth mentioning at all. */
const CANDIDATE_FLOOR = 0.5;

export type BillCycleState =
  | "upcoming"
  | "due_today"
  | "overdue"
  | "paid"
  | "skipped"
  | "resolved_external";

export type BillStatus = {
  bill: Bill;
  /** The ADJUSTED due date — see lib/bills/due_rules.ts. */
  dueDate: IsoDate;
  estimate: AmountEstimate;
  state: BillCycleState;
  /** Negative once past. */
  daysUntil: number;
  cycle: BillCycle | null;
  /**
   * Joined to its ledger transaction, so a caller drawing payment history has
   * the amount that was actually paid. `estimate` above is one figure for the
   * WHOLE BILL, copied onto every cycle — it answers "what does this cost", not
   * "what did I pay in January", and the two differ by exactly the amount the
   * bill moved between cycles.
   */
  payment: MatchedBillPayment | null;
};

export type BillPaymentCandidate = {
  transactionId: string;
  amount: Centavos;
  occurredAt: number;
  merchant: string | null;
  /** 0..1. At or above `CANDIDATE_FLOOR` to be offered. */
  score: number;
  /**
   * WHY it was offered, in the user's words — the same discipline as loans'
   * `PaymentCandidate.reasons`. A bare score asks the user to trust a number
   * they cannot check, on a decision that marks a bill paid.
   */
  reasons: string[];
};

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function maxIso(a: IsoDate, b: IsoDate): IsoDate {
  return a > b ? a : b;
}

function stateOf(cycle: BillCycle | null, dueDate: IsoDate, today: IsoDate): BillCycleState {
  if (cycle !== null && cycle.state !== "open") return cycle.state;
  // Rule 21: overdue at the START OF THE DAY AFTER the due date, so a bill due
  // today is never overdue — the user has the whole day.
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "due_today";
  return "upcoming";
}

/**
 * Every cycle worth showing, oldest first.
 *
 * OVERDUE CYCLES DO NOT ROLL FORWARD (plan rule 4, spec rule 25): an unresolved
 * occurrence stays listed alongside the next one, and both are tracked and
 * resolved independently. Rolling one into the next would report an unpaid
 * month as settled and stop rule 24 subtracting money the user still owes.
 *
 * Enumeration starts at the bill's own `createdAt`, bounded by
 * `OVERDUE_LOOKBACK_DAYS`. A bill cannot have had occurrences before the user
 * told the app it existed — someone adding Meralco today should not be greeted
 * by an overdue January they were never tracking.
 *
 * A `createdAt` in the FUTURE means the clock moved, not that the bill is not
 * yet real: a device whose date was set back (or forward and then corrected)
 * would otherwise make every bill vanish from the list entirely. The lookback
 * alone applies in that case.
 */
export async function listBillStatuses(now: number, horizonDays: number): Promise<BillStatus[]> {
  const today = toDateIso(new Date(now));
  const bills = await listBills();
  const statuses: BillStatus[] = [];

  const lookbackFloor = addDaysIso(today, -OVERDUE_LOOKBACK_DAYS);

  for (const bill of bills) {
    const created = toDateIso(new Date(bill.createdAt));
    const from = created > today ? lookbackFloor : maxIso(created, lookbackFloor);
    const to = addDaysIso(today, horizonDays);
    // ONE join, two readers: the estimator wants the amounts, and a status's
    // `payment` carries the whole matched row so the bill detail can show what
    // each cycle actually cost instead of repeating this estimate on every row.
    const matched = await matchedPayments(bill.id);
    const estimate = estimateAmount(bill, matched);

    const cycles = new Map((await listCycles(bill.id)).map((cycle) => [cycle.dueDate, cycle]));
    const payments = new Map(matched.map((payment) => [payment.cycleDueDate, payment]));

    // A resolved cycle outside the enumerated range still belongs in the list —
    // it is history the user paid, and `from` is a floor on GENERATION, not on
    // what has actually happened.
    const dates = new Set([...occurrencesBetween(bill.dueRule, from, to), ...cycles.keys()]);

    for (const dueDate of [...dates].sort()) {
      const cycle = cycles.get(dueDate) ?? null;
      statuses.push({
        bill,
        dueDate,
        estimate,
        state: stateOf(cycle, dueDate, today),
        daysUntil: daysUntil(dueDate, today),
        cycle,
        payment: payments.get(dueDate) ?? null,
      });
    }
  }

  return statuses.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

/**
 * Every matched payment for a bill, each carrying its ledger transaction's
 * amount and date — the figures `bill_payments` deliberately does not store.
 *
 * A payment whose transaction has gone is DROPPED rather than reported at zero.
 * The estimator has always skipped it, and a history row reading ₱0.00 would be
 * a lie about money rather than the absence of a fact.
 */
async function matchedPayments(billId: string): Promise<MatchedBillPayment[]> {
  const payments = await listBillPayments(billId);
  const matched: MatchedBillPayment[] = [];
  for (const payment of payments) {
    const transaction = await getTransaction(payment.transactionId);
    if (transaction !== null) {
      matched.push({
        ...payment,
        amount: transaction.amount,
        occurredAt: transaction.occurredAt,
      });
    }
  }
  return matched;
}

/** The joined payment history the estimator needs — amounts live on the ledger. */
async function paymentAmounts(billId: string): Promise<PaymentAmount[]> {
  return (await matchedPayments(billId)).map((payment) => ({
    cycleDueDate: payment.cycleDueDate,
    amount: payment.amount,
  }));
}

/**
 * What Safe-to-Spend subtracts: the estimates of every UNRESOLVED cycle whose
 * due date falls in the range.
 *
 * Excludes paid cycles — plan rule 6, and counting one makes the spendable
 * figure "wrong twice over": the money already left the wallet and is still
 * being reserved. Skipped cycles are excluded because the spec's skip flow
 * removes them from Safe-to-Spend outright, and externally-resolved ones
 * because that money was paid, just not from a tracked wallet.
 *
 * Rule 24 — "overdue amounts continue to be subtracted until resolved" — is
 * served by the CALLER choosing a `fromDate` that reaches back far enough. An
 * overdue cycle inside the range is counted here like any other unresolved one.
 */
export async function totalDueInPeriod(
  fromDate: IsoDate,
  toDate: IsoDate,
  now: number,
): Promise<Centavos> {
  const horizon = Math.max(0, daysUntil(toDate, toDateIso(new Date(now))));
  const statuses = await listBillStatuses(now, horizon);

  return statuses
    .filter((status) => status.dueDate >= fromDate && status.dueDate <= toDate)
    .filter((status) => status.state === "upcoming" || status.state === "due_today" || status.state === "overdue")
    .reduce((total, status) => total + status.estimate.amount, 0);
}

// ---------------------------------------------------------------------------
// Candidates — spec rules 14-19
// ---------------------------------------------------------------------------
// RULE 14's TOLERANCE NOW LIVES IN `rule_summary.ts` (GAP-085) and is imported
// above. The bill detail has to print the band it is matching under, and a
// screen cannot reach into this module for it — so the one implementation moved
// to the side of the wall both callers can stand on.

function normalize(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function scoreCandidate(
  bill: Bill,
  estimate: AmountEstimate,
  transaction: Transaction,
  dueDate: IsoDate,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const delta = Math.abs(transaction.amount - estimate.amount);
  const tolerance = toleranceFor(bill, estimate);
  if (delta === 0) {
    score += 0.5;
    reasons.push("Matches the amount exactly");
  } else if (delta <= tolerance) {
    score += 0.35;
    reasons.push("Close to the usual amount");
  }

  const merchant = normalize(transaction.merchant ?? "");
  const pattern = normalize(bill.autoMatchRule?.merchantPattern ?? bill.name);
  if (pattern.length > 0 && merchant.includes(pattern)) {
    score += 0.35;
    reasons.push(`Paid to ${bill.name}`);
  }

  const gap = Math.abs(daysUntil(toDateIso(new Date(transaction.occurredAt)), dueDate));
  if (gap <= 3) {
    score += 0.2;
    reasons.push("Around the due date");
  } else if (gap <= WINDOW_CLOSES_DAYS_AFTER) {
    score += 0.1;
  }

  if (transaction.categoryId === bill.categoryId) {
    score += 0.1;
    reasons.push("Already in this bill's category");
  }

  return { score: Math.min(1, score), reasons };
}

/**
 * Transactions that might have paid this cycle, best first.
 *
 * Rule 16 filters direction and transfer links; rule 17 excludes anything
 * already settling another bill cycle OR a loan payment, because a suggestion
 * the user cannot accept is worse than none. Rejected keywords are excluded
 * because re-offering what the user just refused is how an assistant teaches
 * people to stop reading its suggestions.
 */
export async function findBillPaymentCandidates(
  billId: string,
  dueDate: IsoDate,
  now: number,
  limit = 5,
): Promise<BillPaymentCandidate[]> {
  const bill = await getBill(billId);
  if (bill === null || bill.archivedAt !== null) return [];

  const estimate = estimateAmount(bill, await paymentAmounts(bill.id));

  // Rule 26 widens the close for a cycle already overdue.
  const today = toDateIso(new Date(now));
  const closesAfter = dueDate < today ? OVERDUE_WINDOW_DAYS : WINDOW_CLOSES_DAYS_AFTER;
  const from = Date.parse(`${addDaysIso(dueDate, -WINDOW_OPENS_DAYS_BEFORE)}T00:00:00`);
  const to = Date.parse(`${addDaysIso(dueDate, closesAfter)}T00:00:00`) + DAY_MS;

  const transactions = await listTransactions({
    from,
    to: Math.min(to, now + DAY_MS),
    direction: "out",
    excludeTransferLinked: true,
    // Alongside the transfer exclusion, and for the same reason
    // (017_transaction_adjustments): a balance correction is not a bill
    // payment, and one that happened to land near a due date and inside the
    // amount tolerance would mark the bill paid on the strength of a
    // reconciliation.
    excludeAdjustments: true,
  });

  const claimed = await claimedTransactionIds();
  const excluded = (bill.autoMatchRule?.excludedKeywords ?? []).map(normalize);
  const tolerance = toleranceFor(bill, estimate);

  return transactions
    .filter((transaction) => !claimed.has(transaction.id))
    .filter((transaction) => Math.abs(transaction.amount - estimate.amount) <= tolerance)
    .filter((transaction) => {
      const merchant = normalize(transaction.merchant ?? "");
      return !excluded.some((keyword) => keyword.length > 0 && merchant.includes(keyword));
    })
    .map((transaction) => ({
      transactionId: transaction.id,
      amount: transaction.amount,
      occurredAt: transaction.occurredAt,
      merchant: transaction.merchant ?? null,
      ...scoreCandidate(bill, estimate, transaction, dueDate),
    }))
    .filter((candidate) => candidate.score >= CANDIDATE_FLOOR)
    .sort((a, b) => b.score - a.score || b.occurredAt - a.occurredAt)
    .slice(0, limit);
}

/** Every transaction already settling a bill cycle or a loan payment. */
async function claimedTransactionIds(): Promise<Set<string>> {
  const bills = await listBills({ includeArchived: true });
  const billPayments = await Promise.all(bills.map((bill) => listBillPayments(bill.id)));
  const loans = await listLoans();
  const loanPayments = await Promise.all(loans.map((loan) => listPayments(loan.id)));

  return new Set(
    [...billPayments, ...loanPayments].flat().map((payment) => payment.transactionId),
  );
}

// ---------------------------------------------------------------------------
// The ladder — spec rules 8 and 13
// ---------------------------------------------------------------------------
/**
 * Whether this bill has earned the right to mark a cycle paid without asking.
 *
 * Takes the AMOUNT rather than a candidate, because rule 8's deviation check is
 * about the figure and nothing else — and a caller holding only a proposed
 * amount should not have to fabricate a candidate to ask the question.
 */
export function shouldAutoMatch(
  bill: Bill | null,
  amount: Centavos,
  estimate: AmountEstimate,
): boolean {
  // No rule means the user never opted into matching for this bill.
  if (bill === null || bill.autoMatchRule === null) return false;
  if ((bill.autoMatchRule.confirmedStreak ?? 0) < LADDER_THRESHOLD) return false;

  // Rule 8: ">30% deviation ... always asks for confirmation (even after the
  // auto-match ladder in rule 13 has been earned)". Aircon season doubles a
  // Meralco bill, and that is exactly the month the user wants to be asked.
  if (estimate.amount <= 0) return false;
  const deviation = (Math.abs(amount - estimate.amount) / estimate.amount) * 100;
  return deviation <= ALWAYS_CONFIRM_DEVIATION_PCT;
}

async function patchAutoMatchRule(
  bill: Bill,
  patch: { confirmedStreak?: number; excludedKeywords?: string[] },
): Promise<void> {
  if (bill.autoMatchRule === null) return;
  await updateBill(bill.id, { autoMatchRule: { ...bill.autoMatchRule, ...patch } });
}

/**
 * Records the match the user confirmed (or that the earned ladder made) and
 * advances the streak.
 *
 * Rule 20: this "edits only the bill's own autoMatchRule; it does not create a
 * general UserRule" — those belong to Review Queue corrections.
 */
export async function confirmBillPaymentMatch(
  billId: string,
  dueDate: IsoDate,
  transactionId: string,
): Promise<BillPayment> {
  const bill = await getBill(billId);
  if (bill === null) throw new Error(`bill not found: ${billId}`);

  const payment = await recordBillPayment({ billId, dueDate, transactionId });
  await patchAutoMatchRule(bill, {
    confirmedStreak: (bill.autoMatchRule?.confirmedStreak ?? 0) + 1,
  });
  return payment;
}

/**
 * The auto-match flow's "No" branch: rejects the suggestion, excludes the
 * offending keyword, and resets the ladder (rule 13). Records NOTHING — the
 * cycle stays unpaid, which is the point.
 */
export async function rejectBillPaymentMatch(
  billId: string,
  transactionId: string,
): Promise<void> {
  const bill = await getBill(billId);
  if (bill === null || bill.autoMatchRule === null) return;

  const transaction = await getTransaction(transactionId);
  const keyword = normalize(transaction?.merchant ?? "");
  const existing = bill.autoMatchRule.excludedKeywords ?? [];

  await patchAutoMatchRule(bill, {
    confirmedStreak: 0,
    excludedKeywords: keyword.length > 0 ? [...new Set([...existing, keyword])] : existing,
  });
}

// ---------------------------------------------------------------------------
// Promotion — plan rule 5, spec rules 28-29
// ---------------------------------------------------------------------------
/**
 * Turns a detected recurring charge into a tracked Bill.
 *
 * THE ENTRY POINT M3's DETECTOR CALLS. This plan builds and tests it; M3-part2
 * Task 6's `promotePatternToBill(patternId)` reads the pattern, calls this, and
 * then does rules 28-29's other half — setting `acknowledged` and writing the
 * pattern -> bill link, which needs `recurring_patterns_repo.ts`, a file that
 * task creates and this one deliberately does not.
 *
 * THE CADENCE CONVERSION IS LOSSY AND THAT IS FINE. The pinned `DueRule` union
 * cannot express "every 10 days" — the plan's `every_n_days` variant does not
 * exist in the domain — so an odd cadence takes the nearest expressible rule.
 * The spec puts a PREFILLED FORM in front of the user before anything is saved
 * ("the create-bill form opens prefilled"), so a near miss is a starting point
 * they correct, not a wrong bill they are stuck with.
 */
export async function promoteRecurringPatternToBill(
  input: {
    merchant: string;
    amount: Centavos;
    periodDays: number;
    categoryId: string;
    /** A real posting date — the rule's day-of-month and weekday come from it. */
    firstSeenAt: number;
  },
  // Accepted so the signature matches the plan's and every other service
  // entry point; the created bill's timestamps come from the repository.
  _now: number,
): Promise<Bill> {
  const seen = new Date(input.firstSeenAt);

  return createBillFromPattern(input, dueRuleForCadence(input.periodDays, seen));
}

function dueRuleForCadence(periodDays: number, seen: Date): DueRule {
  const day = seen.getDate();
  const anchorDate = toDateIso(seen);

  // Roughly fortnightly vs. roughly kinsenas. A true kinsenas rhythm averages
  // ~15.2 days AND lands near the 15th or the end of the month; 14 days that
  // lands mid-month is a fortnightly charge, which is a different thing.
  const nearKinsenasDay = Math.abs(day - 15) <= 2 || day >= 28;
  if (periodDays >= 13 && periodDays <= 17 && nearKinsenasDay) {
    return { kind: "semi-monthly" };
  }

  if (periodDays <= 10) {
    return { kind: "every-n-weeks", n: 1, weekday: seen.getDay(), anchorDate };
  }
  if (periodDays < 21) {
    return {
      kind: "every-n-weeks",
      n: Math.max(2, Math.round(periodDays / 7)),
      weekday: seen.getDay(),
      anchorDate,
    };
  }
  if (periodDays <= 45) {
    return { kind: "day-of-month", day };
  }

  // Quarterly, semi-annual, annual. Capped at 12 because the union has no
  // multi-year cadence and a two-yearly charge is not a thing this app tracks.
  return {
    kind: "every-n-months",
    n: Math.min(12, Math.max(2, Math.round(periodDays / 30))),
    day,
    anchorMonth: seen.getMonth() + 1,
  };
}

async function createBillFromPattern(
  input: { merchant: string; amount: Centavos; categoryId: string },
  dueRule: DueRule,
): Promise<Bill> {
  return createBill({
    name: input.merchant,
    // ESTIMATED, not fixed: a detected charge is an observation, not a
    // declaration, and a subscription that changes price should follow it.
    amount: input.amount,
    amountMode: "estimated",
    dueRule,
    categoryId: input.categoryId,
    autoMatchRule: { merchantPattern: input.merchant, dateWindowDays: WINDOW_OPENS_DAYS_BEFORE },
  });
}
