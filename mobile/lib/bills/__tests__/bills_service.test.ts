// lib/bills/__tests__/bills_service.test.ts — m2c Task 4.
//
// Bills against the ledger: what is due, what might have paid it, and the
// confirmation ladder that decides whether the app asks or acts.
//
// Reminders are NOT here — `lib/bills/bill_reminders.ts` owns them, because
// `scheduleReminder` reaches expo-notifications and this module is what a
// screen calls to draw a list. This file mocks nothing.
import {
  archiveBill,
  createBill,
  getBill,
  listBillPayments,
  recordBillPayment,
  skipCycle,
} from "@/lib/db/repos/bills_repo";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { createLoan, recordPayment } from "@/lib/db/repos/loans_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import {
  confirmBillPaymentMatch,
  findBillPaymentCandidates,
  listBillStatuses,
  promoteRecurringPatternToBill,
  rejectBillPaymentMatch,
  shouldAutoMatch,
  totalDueInPeriod,
} from "@/lib/bills/bills_service";
import { freshDb } from "@/test_support/db";
import type { Bill, Wallet } from "@/types/domain";

const BILLS_CATEGORY = "cat_bills_utilities";

/** 2026-02-20 is a Friday, so no weekday adjustment perturbs the fixtures. */
const NOW = Date.parse("2026-02-20T10:00:00");
const DAY = 86_400_000;

let cash: Wallet;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  cash = await createWallet({ name: "GCash" });
});

afterEach(async () => {
  await closeDatabase();
});

async function meralco(overrides: Partial<Parameters<typeof createBill>[0]> = {}): Promise<Bill> {
  return createBill({
    name: "Meralco",
    amount: 235000,
    amountMode: "estimated",
    dueRule: { kind: "day-of-month", day: 20 },
    categoryId: BILLS_CATEGORY,
    autoMatchRule: { merchantPattern: "MERALCO", dateWindowDays: 7 },
    ...overrides,
  });
}

async function outflow(amount: number, occurredAt: number, merchant = "MERALCO PAYMENT") {
  return insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "out",
    occurredAt,
    merchant,
    source: "notification",
    confidence: 0.9,
  });
}

// ---------------------------------------------------------------------------
// Status — plan rules 4 and 6, spec states table
// ---------------------------------------------------------------------------
test("STATUSES REPORT UPCOMING, DUE TODAY, OVERDUE AND PAID", async () => {
  const bill = await meralco();
  // The 2026-01-20 cycle was paid; 2026-02-20 is today; 2026-03-20 is ahead.
  const tx = await outflow(241236, NOW - 31 * DAY);
  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: tx.id });

  const statuses = await listBillStatuses(NOW, 45);
  const byDate = new Map(statuses.map((status) => [status.dueDate, status]));

  expect(byDate.get("2026-01-20")?.state).toBe("paid");
  expect(byDate.get("2026-02-20")?.state).toBe("due_today");
  expect(byDate.get("2026-03-20")?.state).toBe("upcoming");
  expect(byDate.get("2026-02-20")?.daysUntil).toBe(0);
  expect(byDate.get("2026-03-20")?.daysUntil).toBe(28);
});

// GAP-065. `payment` used to be the bare `bill_payments` row, which carries no
// amount and no date — so the only figure a caller had for a paid cycle was
// `estimate`, one number computed for the WHOLE BILL and copied onto every
// cycle of it. The bill detail printed that number as the payment, and a bill
// whose amount moves (which is the only kind worth estimating) reported the
// same peso for every month it had ever been paid.
//
// A FIXED bill here on purpose: its estimate is pinned to what the user typed
// and cannot drift into agreeing with the payment by accident, so the two
// figures below are guaranteed to be different things.
test("A PAID STATUS CARRIES THE TRANSACTION'S OWN AMOUNT AND DATE", async () => {
  const bill = await meralco({ amountMode: "fixed" });
  const paidAt = NOW - 31 * DAY;
  const tx = await outflow(241236, paidAt);
  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: tx.id });

  const statuses = await listBillStatuses(NOW, 45);
  const paid = statuses.find((status) => status.dueDate === "2026-01-20");

  expect(paid?.payment?.amount).toBe(241236);
  expect(paid?.payment?.occurredAt).toBe(paidAt);
  // ...and the bill-level estimate is still the ₱2,350.00 the user set, which
  // is what makes the two above worth carrying separately.
  expect(paid?.estimate.amount).toBe(235000);
});

test("AN OVERDUE UNPAID CYCLE STAYS LISTED AND DOES NOT ROLL FORWARD", async () => {
  // Plan rule 4 and spec rule 25: an unresolved occurrence past its due date
  // "stays in the list until paid or explicitly skipped", ALONGSIDE the next
  // one. Rolling it forward would report the January bill as settled while it
  // was not, and rule 24 would stop subtracting money the user still owes.
  const bill = await createBill({
    name: "Maynilad",
    amount: 90000,
    amountMode: "fixed",
    dueRule: { kind: "day-of-month", day: 5 },
    categoryId: BILLS_CATEGORY,
  });
  // Created before both cycles so both are enumerable.
  await new Promise((resolve) => setTimeout(resolve, 0));

  const statuses = (await listBillStatuses(NOW, 30)).filter((s) => s.bill.id === bill.id);
  const overdue = statuses.filter((s) => s.state === "overdue").map((s) => s.dueDate);

  expect(overdue).toContain("2026-02-05");
  expect(statuses.map((s) => s.dueDate)).toContain("2026-03-05");
});

test("a skipped cycle is resolved, not overdue", async () => {
  const bill = await createBill({
    name: "Maynilad",
    amount: 90000,
    amountMode: "fixed",
    dueRule: { kind: "day-of-month", day: 5 },
    categoryId: BILLS_CATEGORY,
  });
  await skipCycle({ billId: bill.id, dueDate: "2026-02-05" });

  const statuses = await listBillStatuses(NOW, 30);
  const february = statuses.find((s) => s.dueDate === "2026-02-05");

  expect(february?.state).toBe("skipped");
});

test("an archived bill produces no cycles at all", async () => {
  // Spec rule 27: archiving "stops future cycles, reminders, and matching".
  const bill = await meralco();
  await archiveBill(bill.id);

  expect(await listBillStatuses(NOW, 60)).toEqual([]);
});

test("the status carries the CURRENT estimate, not the seed", async () => {
  // Spec rule 9: Safe-to-Spend uses "the current estimate as of computation
  // time", and rule 7 renders it with a `~`.
  const bill = await meralco();
  for (const [dueDate, amount] of [
    ["2025-11-20", 200000],
    ["2025-12-20", 250000],
    ["2026-01-20", 300000],
  ] as const) {
    const tx = await outflow(amount, Date.parse(`${dueDate}T10:00:00`));
    await recordBillPayment({ billId: bill.id, dueDate, transactionId: tx.id });
  }

  const today = (await listBillStatuses(NOW, 10)).find((s) => s.dueDate === "2026-02-20");

  expect(today?.estimate.amount).toBe(250000); // mean of 200000, 250000, 300000
  expect(today?.estimate.basis).toBe("history");
});

// ---------------------------------------------------------------------------
// Candidates — spec rules 14-19
// ---------------------------------------------------------------------------
test("AN EXACT-AMOUNT OUTBOUND TRANSACTION IN THE WINDOW IS A CANDIDATE, WITH REASONS", async () => {
  const bill = await meralco();
  await outflow(235000, NOW - 2 * DAY);

  const [candidate] = await findBillPaymentCandidates(bill.id, "2026-02-20", NOW);

  expect(candidate.amount).toBe(235000);
  expect(candidate.reasons.join(" ")).toMatch(/amount/i);
  expect(candidate.score).toBeGreaterThan(0.5);
});

test("AN INBOUND TRANSACTION IS NEVER A CANDIDATE", async () => {
  // Spec rule 16. Money arriving cannot pay a bill, and the most likely inbound
  // transaction of the month is the user's salary.
  const bill = await meralco();
  await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 235000,
    direction: "in",
    occurredAt: NOW - DAY,
    merchant: "MERALCO REFUND",
    source: "notification",
    confidence: 0.9,
  });

  expect(await findBillPaymentCandidates(bill.id, "2026-02-20", NOW)).toEqual([]);
});

test("A TRANSFER-LINKED TRANSACTION IS NEVER A CANDIDATE", async () => {
  // Spec rule 16's second half: "an internal movement cannot pay a bill".
  // Moving ₱2,350 into your own savings is not a Meralco payment.
  const bill = await meralco();
  const savings = await createWallet({ name: "GSave" });
  const out = await outflow(235000, NOW - DAY, "TRANSFER TO GSAVE");
  const income = await insertTransaction({
    walletId: savings.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 235000,
    direction: "in",
    occurredAt: NOW - DAY,
    merchant: "FROM GCASH",
    source: "notification",
    confidence: 0.9,
  });
  await linkTransfer(out.id, income.id, 0);

  expect(await findBillPaymentCandidates(bill.id, "2026-02-20", NOW)).toEqual([]);
});

test("A TRANSACTION ALREADY LINKED TO A LOAN PAYMENT IS NEVER A CANDIDATE", async () => {
  // Invariant I12 across aggregates: one transaction settles one obligation.
  // Offering a claimed transaction produces a suggestion the user cannot accept.
  const bill = await meralco();
  const loan = await createLoan({ direction: "i-owe", counterparty: "GLoan", principal: 5000000 });
  const tx = await outflow(235000, NOW - DAY);
  await recordPayment({ loanId: loan.id, transactionId: tx.id });

  expect(await findBillPaymentCandidates(bill.id, "2026-02-20", NOW)).toEqual([]);
});

test("a transaction already settling another bill's cycle is never a candidate", async () => {
  const meralcoBill = await meralco();
  const other = await createBill({
    name: "Maynilad",
    amount: 235000,
    amountMode: "estimated",
    dueRule: { kind: "day-of-month", day: 20 },
    categoryId: BILLS_CATEGORY,
  });
  const tx = await outflow(235000, NOW - DAY);
  await recordBillPayment({ billId: other.id, dueDate: "2026-02-20", transactionId: tx.id });

  expect(await findBillPaymentCandidates(meralcoBill.id, "2026-02-20", NOW)).toEqual([]);
});

test("A REJECTED KEYWORD IS NEVER OFFERED FOR THAT BILL AGAIN", async () => {
  // The auto-match flow's "No" branch: "rejects; the offending keyword is
  // excluded from the rule". Re-offering what the user just refused is how an
  // assistant teaches people to stop reading its suggestions.
  const bill = await meralco();
  const tx = await outflow(235000, NOW - 2 * DAY, "MERALCO KIOSK");

  await rejectBillPaymentMatch(bill.id, tx.id);

  expect(await findBillPaymentCandidates(bill.id, "2026-02-20", NOW)).toEqual([]);
});

test("AN AMOUNT FAR OUTSIDE THE TOLERANCE IS NOT OFFERED", async () => {
  // Spec rule 14: an estimated bill matches within ±30% of the estimate. A
  // ₱120 jeepney top-up is not a ₱2,350 electricity bill however it is spelled.
  const bill = await meralco();
  await outflow(12000, NOW - DAY, "MERALCO");

  expect(await findBillPaymentCandidates(bill.id, "2026-02-20", NOW)).toEqual([]);
});

test("A FIXED BILL USES THE PESO-OR-PERCENT FLOOR, NOT THE 30% BAND", async () => {
  // Spec rule 14: fixed bills match "within ±₱30.00 or ±3% of the amount,
  // whichever is greater" — the allowance that absorbs an e-wallet's ₱7.00
  // bills-payment convenience fee.
  const bill = await createBill({
    name: "Rent",
    amount: 800000,
    amountMode: "fixed",
    dueRule: { kind: "day-of-month", day: 20 },
    categoryId: BILLS_CATEGORY,
    autoMatchRule: { merchantPattern: "LANDLORD", dateWindowDays: 7 },
  });
  await outflow(800700, NOW - DAY, "LANDLORD TRANSFER"); // ₱8,007.00 — the fee
  await outflow(900000, NOW - DAY, "LANDLORD BONUS"); // 12.5% over — not this bill

  const candidates = await findBillPaymentCandidates(bill.id, "2026-02-20", NOW);

  expect(candidates.map((c) => c.amount)).toEqual([800700]);
});

test("THE WINDOW OPENS 7 DAYS BEFORE AND CLOSES 15 DAYS AFTER", async () => {
  // Spec rule 15. A payment eight days early is not for this cycle.
  const bill = await meralco();
  await outflow(235000, NOW - 9 * DAY, "MERALCO EARLY");

  expect(await findBillPaymentCandidates(bill.id, "2026-02-20", NOW)).toEqual([]);

  await outflow(235000, NOW - 5 * DAY, "MERALCO ONTIME");
  expect((await findBillPaymentCandidates(bill.id, "2026-02-20", NOW)).length).toBe(1);
});

test("AN OVERDUE CYCLE KEEPS MATCHING FOR 30 DAYS PAST DUE", async () => {
  // Spec rule 26 supersedes rule 15's close: "late payment of an overdue bill
  // is the expected resolution path". Closing the window at 15 days would make
  // the app unable to recognise the very payment it has been nagging for.
  const bill = await meralco();
  const late = Date.parse("2026-03-15T10:00:00"); // 23 days after the 20 Feb cycle
  await outflow(235000, late - DAY, "MERALCO LATE");

  const candidates = await findBillPaymentCandidates(bill.id, "2026-02-20", late);

  expect(candidates.length).toBe(1);
});

// ---------------------------------------------------------------------------
// Confirming, and the ladder — spec rules 8 and 13
// ---------------------------------------------------------------------------
test("confirming a match records the payment for that due date", async () => {
  const bill = await meralco();
  const tx = await outflow(235000, NOW - DAY);

  const payment = await confirmBillPaymentMatch(bill.id, "2026-02-20", tx.id);

  expect(payment.cycleDueDate).toBe("2026-02-20");
  expect((await listBillPayments(bill.id)).length).toBe(1);
});

test("confirming twice for the same due date updates rather than duplicates", async () => {
  const bill = await meralco();
  const wrong = await outflow(235000, NOW - 2 * DAY, "MERALCO A");
  const right = await outflow(241236, NOW - DAY, "MERALCO B");

  await confirmBillPaymentMatch(bill.id, "2026-02-20", wrong.id);
  await confirmBillPaymentMatch(bill.id, "2026-02-20", right.id);

  const payments = await listBillPayments(bill.id);
  expect(payments.length).toBe(1);
  expect(payments[0].transactionId).toBe(right.id);
});

test("THE LADDER: THE FIRST TWO MATCHES ASK, THE THIRD ACTS", async () => {
  // Spec rule 13. The m2c plan says the opposite — "nothing is recorded without
  // confirmation, the same discipline as loans" — but the loans spec is
  // stricter than the bills spec on purpose: a wrong loan match corrupts a
  // balance AND the user's detected income, while a bill match the app has
  // earned the right to make is undoable and saves a tap a month forever.
  const bill = await meralco();
  const estimate = { amount: 235000, basis: "history" as const, sampleSize: 3, spread: 0 };

  expect(shouldAutoMatch(await getBill(bill.id), 235000, estimate)).toBe(false);

  for (const [index, dueDate] of ["2025-12-20", "2026-01-20"].entries()) {
    const tx = await outflow(235000, NOW - (60 - index * 30) * DAY);
    await confirmBillPaymentMatch(bill.id, dueDate, tx.id);
  }
  // Two confirmations in: still asking.
  expect(shouldAutoMatch(await getBill(bill.id), 235000, estimate)).toBe(false);

  const third = await outflow(235000, NOW - DAY);
  await confirmBillPaymentMatch(bill.id, "2026-02-20", third.id);

  expect(shouldAutoMatch(await getBill(bill.id), 235000, estimate)).toBe(true);
});

test("ANY REJECTION RESETS THE LADDER", async () => {
  // Rule 13: "Any rejection resets the ladder to confirmation mode." The user
  // has just demonstrated the rule is wrong about something.
  const bill = await meralco();
  const estimate = { amount: 235000, basis: "history" as const, sampleSize: 3, spread: 0 };
  for (const [index, dueDate] of ["2025-11-20", "2025-12-20", "2026-01-20"].entries()) {
    const tx = await outflow(235000, NOW - (90 - index * 30) * DAY);
    await confirmBillPaymentMatch(bill.id, dueDate, tx.id);
  }
  expect(shouldAutoMatch(await getBill(bill.id), 235000, estimate)).toBe(true);

  const wrong = await outflow(235000, NOW - DAY, "MERALCO KIOSK");
  await rejectBillPaymentMatch(bill.id, wrong.id);

  expect(shouldAutoMatch(await getBill(bill.id), 235000, estimate)).toBe(false);
});

test("A >30% DEVIATION ALWAYS ASKS, EVEN WITH THE LADDER EARNED", async () => {
  // Spec rule 8, which says "even after the auto-match ladder has been earned"
  // in as many words. Aircon season doubles a Meralco bill, and that is exactly
  // the month the user wants to be told rather than informed later.
  const bill = await meralco();
  const estimate = { amount: 235000, basis: "history" as const, sampleSize: 3, spread: 0 };
  for (const [index, dueDate] of ["2025-11-20", "2025-12-20", "2026-01-20"].entries()) {
    const tx = await outflow(235000, NOW - (90 - index * 30) * DAY);
    await confirmBillPaymentMatch(bill.id, dueDate, tx.id);
  }

  expect(shouldAutoMatch(await getBill(bill.id), 235000, estimate)).toBe(true);
  expect(shouldAutoMatch(await getBill(bill.id), 400000, estimate)).toBe(false);
});

test("a bill with no auto-match rule never auto-matches", async () => {
  const bill = await createBill({
    name: "Tuition",
    amount: 1500000,
    amountMode: "fixed",
    dueRule: { kind: "day-of-month", day: 20 },
    categoryId: BILLS_CATEGORY,
  });
  const estimate = { amount: 1500000, basis: "fixed" as const, sampleSize: 0, spread: 0 };

  expect(shouldAutoMatch(await getBill(bill.id), 1500000, estimate)).toBe(false);
});

// ---------------------------------------------------------------------------
// Safe-to-Spend input — plan rule 6
// ---------------------------------------------------------------------------
test("TOTAL DUE SUMS UNPAID CYCLES ONLY", async () => {
  const bill = await meralco();

  const before = await totalDueInPeriod("2026-02-01", "2026-03-31", NOW);
  expect(before).toBe(235000 * 2); // the 20 Feb and 20 Mar cycles

  const tx = await outflow(235000, NOW - DAY);
  await confirmBillPaymentMatch(bill.id, "2026-02-20", tx.id);

  expect(await totalDueInPeriod("2026-02-01", "2026-03-31", NOW)).toBe(235000);
});

test("TOTAL DUE EXCLUDES PAID CYCLES — THE SAFE-TO-SPEND REGRESSION", async () => {
  // Plan rule 6: counting a paid cycle makes "the user's spendable figure wrong
  // twice over" — the money left the wallet AND is still being reserved.
  const bill = await meralco();
  const tx = await outflow(235000, NOW - DAY);
  await confirmBillPaymentMatch(bill.id, "2026-02-20", tx.id);

  expect(await totalDueInPeriod("2026-02-01", "2026-02-28", NOW)).toBe(0);
});

test("total due excludes skipped and externally-resolved cycles", async () => {
  // Spec's skip flow: a skipped cycle is "removed from Safe-to-Spend". Money
  // paid outside every tracked wallet is not owed either.
  const bill = await meralco();
  await skipCycle({ billId: bill.id, dueDate: "2026-02-20" });

  expect(await totalDueInPeriod("2026-02-01", "2026-02-28", NOW)).toBe(0);
});

test("TOTAL DUE COUNTS AN OVERDUE CYCLE INSIDE THE RANGE", async () => {
  // Spec rule 24: "Overdue amounts continue to be subtracted from
  // Safe-to-Spend until resolved — money owed is money not spendable."
  const bill = await createBill({
    name: "Maynilad",
    amount: 90000,
    amountMode: "fixed",
    dueRule: { kind: "day-of-month", day: 5 },
    categoryId: BILLS_CATEGORY,
  });

  expect(await totalDueInPeriod("2026-02-01", "2026-02-28", NOW)).toBe(90000);
  expect(bill.amountMode).toBe("fixed");
});

// ---------------------------------------------------------------------------
// Promotion — plan rule 5, spec rules 28-29
// ---------------------------------------------------------------------------
const PROMOTION = {
  merchant: "NETFLIX",
  amount: 54900,
  categoryId: BILLS_CATEGORY,
  firstSeenAt: Date.parse("2026-01-08T10:00:00"), // a Thursday, the 8th
};

test("A ~30-DAY CADENCE BECOMES A DAY-OF-MONTH RULE ON THE OBSERVED DAY", async () => {
  const bill = await promoteRecurringPatternToBill({ ...PROMOTION, periodDays: 30 }, NOW);

  expect(bill.dueRule).toEqual({ kind: "day-of-month", day: 8 });
  expect(bill.name).toBe("NETFLIX");
});

test("A ~15-DAY CADENCE BECOMES SEMI-MONTHLY", async () => {
  const bill = await promoteRecurringPatternToBill(
    { ...PROMOTION, periodDays: 15, firstSeenAt: Date.parse("2026-01-15T10:00:00") },
    NOW,
  );

  expect(bill.dueRule).toEqual({ kind: "semi-monthly" });
});

test("AN ODD CADENCE BECOMES THE NEAREST WEEK-BASED RULE", async () => {
  // The pinned DueRule union cannot express "every 10 days" — the m2c plan's
  // `every_n_days` variant does not exist. The nearest expressible cadence is
  // used and the user corrects it in the prefilled form, which is what the
  // spec's promotion flow puts in front of them anyway.
  const bill = await promoteRecurringPatternToBill({ ...PROMOTION, periodDays: 7 }, NOW);
  expect(bill.dueRule).toEqual({
    kind: "every-n-weeks",
    n: 1,
    weekday: 4, // 2026-01-08 is a Thursday
    anchorDate: "2026-01-08",
  });

  const fortnightly = await promoteRecurringPatternToBill({ ...PROMOTION, periodDays: 14 }, NOW);
  expect(fortnightly.dueRule).toMatchObject({ kind: "every-n-weeks", n: 2 });
});

test("an annual cadence becomes every-n-months with n = 12", async () => {
  const bill = await promoteRecurringPatternToBill({ ...PROMOTION, periodDays: 365 }, NOW);

  expect(bill.dueRule).toEqual({ kind: "every-n-months", n: 12, day: 8, anchorMonth: 1 });
});

test("A PROMOTED BILL IS ESTIMATED, SEEDED, AND CARRIES THE SPEC'S DEFAULTS", async () => {
  // Spec promotion flow: "amount type Estimated seeded from the pattern's
  // amount, ... autoMatchRule seeded from the merchant string". Estimated
  // rather than fixed because a detected charge is an observation, not a
  // declaration — and a subscription that changes price should adjust itself.
  const bill = await promoteRecurringPatternToBill({ ...PROMOTION, periodDays: 30 }, NOW);

  expect(bill.amountMode).toBe("estimated");
  expect(bill.amount).toBe(54900);
  expect(bill.reminderOffsets).toEqual([-3, 0]);
  expect(bill.autoMatchRule?.merchantPattern).toBe("NETFLIX");
  expect(bill.categoryId).toBe(BILLS_CATEGORY);
});
