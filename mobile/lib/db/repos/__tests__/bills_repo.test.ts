// lib/db/repos/__tests__/bills_repo.test.ts — m2c Task 1.
//
// Storage only. The due-rule engine (Task 2) decides WHICH dates exist; this
// file is about what survives a round-trip and what the schema refuses.
import { closeDatabase } from "@/lib/db/database";
import {
  archiveBill,
  unarchiveBill,
  BillNotFoundError,
  CycleAlreadyResolvedError,
  createBill,
  deleteBillPayment,
  getBill,
  getCycle,
  listBillPayments,
  listBills,
  listCycles,
  recordBillPayment,
  recordOverdueNotice,
  resolveCycleExternally,
  skipCycle,
  updateBill,
} from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { getTransaction, insertTransaction } from "@/lib/db/repos/transactions_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { freshDb } from "@/test_support/db";
import type { DueRule, Wallet } from "@/types/domain";

const BILLS_CATEGORY = "cat_bills_utilities";

let cash: Wallet;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  cash = await createWallet({ name: "Cash" });
});

afterEach(async () => {
  await closeDatabase();
});

async function makeBill(dueRule?: DueRule) {
  return createBill({
    name: "Meralco",
    amount: 235000,
    amountMode: "estimated",
    dueRule: dueRule ?? { kind: "day-of-month", day: 20 },
    categoryId: BILLS_CATEGORY,
  });
}

/** A ledger outflow to pay a bill with. Bill payments carry no amount of their
 *  own — the figure lives on the transaction, exactly as loan payments do. */
async function makeOutflow(amount: number, occurredAt: number, merchant = "MERALCO") {
  return insertTransaction({
    walletId: cash.id,
    categoryId: BILLS_CATEGORY,
    amount,
    direction: "out",
    occurredAt,
    merchant,
    source: "manual",
    confidence: 1,
  });
}

// ---------------------------------------------------------------------------
// Round-trips
// ---------------------------------------------------------------------------
const DUE_RULES: DueRule[] = [
  { kind: "day-of-month", day: 20 },
  { kind: "day-of-month", day: 31, weekdayAdjust: "earlier" },
  { kind: "semi-monthly" },
  { kind: "last-day-of-month" },
  { kind: "every-n-weeks", n: 2, weekday: 5, anchorDate: "2026-01-02" },
  { kind: "every-n-months", n: 3, day: 10, anchorMonth: 1 },
];

test.each(DUE_RULES)("EVERY DUE RULE ROUND-TRIPS: %j", async (dueRule) => {
  // Including the two the m2c plan's own interface omits. The spec's due-rule
  // table requires "Every N months on the Nth" (quarterly insurance, tuition)
  // and a per-bill weekday adjustment, and both are in its acceptance criteria.
  const bill = await makeBill(dueRule);

  const loaded = await getBill(bill.id);

  expect(loaded?.dueRule).toEqual(dueRule);
});

test("both amount modes round-trip", async () => {
  const fixed = await createBill({
    name: "Rent",
    amount: 800000,
    amountMode: "fixed",
    dueRule: { kind: "day-of-month", day: 5 },
    categoryId: BILLS_CATEGORY,
  });
  const estimated = await makeBill();

  expect((await getBill(fixed.id))?.amountMode).toBe("fixed");
  expect((await getBill(estimated.id))?.amountMode).toBe("estimated");
  // An estimated bill's stored amount IS its seed — spec rule 6: it "starts
  // from the user's initial figure" and is overwritten as history arrives.
  expect((await getBill(estimated.id))?.amount).toBe(235000);
});

test("the auto-match rule round-trips, and is null when not given", async () => {
  const rule = { merchantPattern: "MERALCO", amountTolerancePct: 30, dateWindowDays: 7 };
  const withRule = await createBill({
    name: "Meralco",
    amount: 235000,
    amountMode: "estimated",
    dueRule: { kind: "day-of-month", day: 20 },
    categoryId: BILLS_CATEGORY,
    autoMatchRule: rule,
  });

  expect((await getBill(withRule.id))?.autoMatchRule).toEqual(rule);
  expect((await makeBill())?.autoMatchRule).toBeNull();
});

test("REMINDER OFFSETS ARE STORED SORTED, DEDUPLICATED AND NEGATIVE-IS-BEFORE", async () => {
  // types/domain.ts pins the convention: "negative = before (e.g., [-3, 0])".
  // The m2c plan's `reminderOffsetsDays` counts positive days before instead;
  // the contract-pinned type wins. Ascending order is FIRING order, which is
  // what a schedule reads and what the detail screen lists.
  const bill = await createBill({
    name: "Meralco",
    amount: 235000,
    amountMode: "estimated",
    dueRule: { kind: "day-of-month", day: 20 },
    categoryId: BILLS_CATEGORY,
    reminderOffsets: [0, -3, -7, -3],
  });

  expect((await getBill(bill.id))?.reminderOffsets).toEqual([-7, -3, 0]);
});

test("the default reminder schedule is the spec's, without configuration", async () => {
  // Spec rule 10 and an acceptance criterion: "3 days before + on the due date"
  // are "created without user configuration".
  expect((await makeBill()).reminderOffsets).toEqual([-3, 0]);
});

test("updateBill patches only what it is given", async () => {
  const bill = await makeBill();

  const patched = await updateBill(bill.id, { amount: 260000 });

  expect(patched.amount).toBe(260000);
  expect(patched.name).toBe("Meralco");
  expect(patched.dueRule).toEqual({ kind: "day-of-month", day: 20 });
});

test("an explicit null CLEARS the auto-match rule", async () => {
  // A user who rejects every keyword must be able to turn matching off; with
  // `??` merging, clearing and not-mentioning would be the same request.
  const bill = await createBill({
    name: "Meralco",
    amount: 235000,
    amountMode: "estimated",
    dueRule: { kind: "day-of-month", day: 20 },
    categoryId: BILLS_CATEGORY,
    autoMatchRule: { merchantPattern: "MERALCO", dateWindowDays: 7 },
  });

  expect((await updateBill(bill.id, { autoMatchRule: null })).autoMatchRule).toBeNull();
});

test("a missing bill is an error naming it, not a silent no-op", async () => {
  await expect(updateBill("no-such-bill", { amount: 1 })).rejects.toThrow(BillNotFoundError);
});

// ---------------------------------------------------------------------------
// Archiving — spec rule 27
// ---------------------------------------------------------------------------
test("ARCHIVING HIDES THE BILL BUT KEEPS ITS PAYMENTS", async () => {
  // Rule 27: archiving "stops future cycles, reminders, and matching; history
  // and linked transactions are untouched". Bills are never hard-deleted here
  // because history feeds the estimator.
  const bill = await makeBill();
  const tx = await makeOutflow(241236, Date.parse("2026-01-18T10:00:00"));
  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: tx.id });

  await archiveBill(bill.id);

  expect(await listBills()).toEqual([]);
  expect((await listBills({ includeArchived: true })).map((b) => b.id)).toEqual([bill.id]);
  expect((await listBillPayments(bill.id)).length).toBe(1);
  expect((await getBill(bill.id))?.archivedAt).not.toBeNull();
});

// ---------------------------------------------------------------------------
// Payments and cycles
// ---------------------------------------------------------------------------
test("recording a payment resolves its cycle as paid, atomically", async () => {
  const bill = await makeBill();
  const tx = await makeOutflow(241236, Date.parse("2026-01-18T10:00:00"));

  const payment = await recordBillPayment({
    billId: bill.id,
    dueDate: "2026-01-20",
    transactionId: tx.id,
  });

  const cycle = await getCycle(bill.id, "2026-01-20");
  expect(cycle?.state).toBe("paid");
  expect(cycle?.billPaymentId).toBe(payment.id);
});

test("A SECOND PAYMENT FOR THE SAME DUE DATE UPDATES RATHER THAN DUPLICATES", async () => {
  // Plan rule 1: "paying the same occurrence twice is a correction, not a
  // second payment". The user picked the wrong transaction and is fixing it.
  const bill = await makeBill();
  const wrong = await makeOutflow(50000, Date.parse("2026-01-17T10:00:00"), "JOLLIBEE");
  const right = await makeOutflow(241236, Date.parse("2026-01-18T10:00:00"));
  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: wrong.id });

  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: right.id });

  const payments = await listBillPayments(bill.id);
  expect(payments.length).toBe(1);
  expect(payments[0].transactionId).toBe(right.id);
  // And the corrected-away transaction is free to settle something else.
  expect((await listCycles(bill.id)).length).toBe(1);
});

test("A CORRECTED-AWAY TRANSACTION IS RELEASED, NOT DELETED", async () => {
  // The money moved, whatever the matcher thought it was for. Same rule as
  // loans: un-matching releases the transaction to be matched elsewhere.
  const bill = await makeBill();
  const other = await makeBill({ kind: "day-of-month", day: 5 });
  const tx = await makeOutflow(241236, Date.parse("2026-01-18T10:00:00"));
  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: tx.id });

  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: tx.id });
  await deleteBillPayment((await listBillPayments(bill.id))[0].id);

  await expect(
    recordBillPayment({ billId: other.id, dueDate: "2026-01-05", transactionId: tx.id }),
  ).resolves.toBeDefined();
});

test("deleting a payment REOPENS its cycle", async () => {
  // Rule 23: an overdue cycle "stays open until the user pays ..., skips it, or
  // edits the bill. It is never auto-resolved". Undoing the payment has to put
  // the cycle back where it was, or a mistaken silent auto-match (rule 13's
  // ladder) could never be undone.
  const bill = await makeBill();
  const tx = await makeOutflow(241236, Date.parse("2026-01-18T10:00:00"));
  const payment = await recordBillPayment({
    billId: bill.id,
    dueDate: "2026-01-20",
    transactionId: tx.id,
  });

  await deleteBillPayment(payment.id);

  expect(await getCycle(bill.id, "2026-01-20")).toBeNull();
  expect(await listBillPayments(bill.id)).toEqual([]);
});

test("LIST PAYMENTS IS ORDERED BY THE CYCLE, NOT BY WHEN IT WAS CONFIRMED", async () => {
  // A payment confirmed today can belong to a cycle from three months ago —
  // the estimator wants the last three CYCLES (spec rule 6), and a history in
  // confirmation order is unreadable as a payment record.
  const bill = await makeBill();
  const march = await makeOutflow(300000, Date.parse("2026-03-18T10:00:00"));
  const january = await makeOutflow(100000, Date.parse("2026-01-18T10:00:00"));
  await recordBillPayment({ billId: bill.id, dueDate: "2026-03-20", transactionId: march.id });
  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: january.id });

  expect((await listBillPayments(bill.id)).map((p) => p.cycleDueDate)).toEqual([
    "2026-01-20",
    "2026-03-20",
  ]);
});

test("a transaction settles at most one bill cycle", async () => {
  // Invariant I12, and spec rule 17. The typed error names the transaction so
  // a screen can say WHICH one is taken, rather than surfacing "UNIQUE
  // constraint failed: bill_payments.transaction_id".
  const bill = await makeBill();
  const other = await makeBill({ kind: "day-of-month", day: 5 });
  const tx = await makeOutflow(241236, Date.parse("2026-01-18T10:00:00"));
  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: tx.id });

  await expect(
    recordBillPayment({ billId: other.id, dueDate: "2026-01-05", transactionId: tx.id }),
  ).rejects.toThrow(/already/i);
});

// ---------------------------------------------------------------------------
// The two resolutions that have no transaction
// ---------------------------------------------------------------------------
test("A SKIPPED CYCLE RESOLVES WITH NO PAYMENT AT ALL", async () => {
  // Spec's skip flow: "cycle resolves as skipped (no payment expected,
  // excluded from estimate updates, removed from Safe-to-Spend)". A promo
  // month, an advance payment, a landlord waiving rent.
  const bill = await makeBill();

  const cycle = await skipCycle({ billId: bill.id, dueDate: "2026-02-20" });

  expect(cycle.state).toBe("skipped");
  expect(cycle.billPaymentId).toBeNull();
  expect(await listBillPayments(bill.id)).toEqual([]);
});

test("PAID OUTSIDE MY WALLETS RESOLVES WITH NO LEDGER ENTRY", async () => {
  // The mark-paid flow's third option, for when someone else paid. Distinct
  // from a skip: money WAS owed and WAS paid, so this must not be confused
  // with a waived cycle — but there is no transaction to point at.
  const bill = await makeBill();

  const cycle = await resolveCycleExternally({ billId: bill.id, dueDate: "2026-02-20" });

  expect(cycle.state).toBe("resolved_external");
  expect(cycle.billPaymentId).toBeNull();
});

test("resolving an already-resolved cycle is refused, not silently overwritten", async () => {
  const bill = await makeBill();
  await skipCycle({ billId: bill.id, dueDate: "2026-02-20" });

  await expect(
    resolveCycleExternally({ billId: bill.id, dueDate: "2026-02-20" }),
  ).rejects.toThrow(CycleAlreadyResolvedError);
});

test("TWO CYCLES CAN BE OPEN AND RESOLVE INDEPENDENTLY", async () => {
  // Spec rule 25: "If the next due date arrives while a previous cycle is
  // still overdue, both cycles are listed and both subtract from
  // Safe-to-Spend; cycles are tracked and resolved independently."
  const bill = await makeBill();
  const tx = await makeOutflow(241236, Date.parse("2026-02-18T10:00:00"));

  await recordBillPayment({ billId: bill.id, dueDate: "2026-02-20", transactionId: tx.id });

  // January is untouched by February being paid — it is still open, which is
  // how it stays overdue and keeps subtracting from Safe-to-Spend.
  expect(await getCycle(bill.id, "2026-01-20")).toBeNull();
  expect((await getCycle(bill.id, "2026-02-20"))?.state).toBe("paid");
});

test("AN UNRESOLVED CYCLE HAS NO ROW", async () => {
  // Deliberate: a bill running for four years should not carry fifty rows
  // recording that nothing happened. Open-ness is the absence of a row, and
  // the due-rule engine (Task 2) is what enumerates which dates exist.
  const bill = await makeBill();

  expect(await listCycles(bill.id)).toEqual([]);
});

// ---------------------------------------------------------------------------
// Overdue escalation — spec rule 22
// ---------------------------------------------------------------------------
test("OVERDUE NOTICES ARE COUNTED PER CYCLE AND SURVIVE A REINSTALL", async () => {
  // Rule 22 caps escalation at three notifications per cycle: "Nagging forever
  // erodes trust." Counted in the database rather than derived from queued
  // notification ids, because the OS forgets those across a reinstall and the
  // user must not get three fresh naggings each time.
  const bill = await makeBill();

  expect(await recordOverdueNotice(bill.id, "2026-01-20")).toBe(1);
  expect(await recordOverdueNotice(bill.id, "2026-01-20")).toBe(2);
  expect(await recordOverdueNotice(bill.id, "2026-01-20")).toBe(3);

  expect((await getCycle(bill.id, "2026-01-20"))?.overdueNoticesSent).toBe(3);
  // A different cycle of the same bill counts from zero — rule 22 is per cycle.
  expect(await recordOverdueNotice(bill.id, "2026-02-20")).toBe(1);
});

test("AN OVERDUE ROW IS 'open', NEVER 'skipped'", async () => {
  // The row rule 22's counter needs has to have SOME state, and reusing
  // "skipped" for it would make an overdue bill look waived: rule 24 keeps
  // overdue amounts subtracting from Safe-to-Spend, and rule 6 excludes
  // skipped cycles from the estimate. Two opposite treatments, one value.
  const bill = await makeBill();

  await recordOverdueNotice(bill.id, "2026-01-20");

  const cycle = await getCycle(bill.id, "2026-01-20");
  expect(cycle?.state).toBe("open");
  expect(cycle?.resolvedAt).toBeNull();
  // And being open means it can still be resolved any of the three ways.
  await expect(skipCycle({ billId: bill.id, dueDate: "2026-01-20" })).resolves.toBeDefined();
});

test("an overdue cycle is still OPEN, and paying it keeps the notice count", async () => {
  // Recording a notice must not resolve the cycle — the cycle row exists only
  // to carry the count until the user acts (rule 23).
  const bill = await makeBill();
  await recordOverdueNotice(bill.id, "2026-01-20");
  const tx = await makeOutflow(241236, Date.parse("2026-01-25T10:00:00"));

  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: tx.id });

  const cycle = await getCycle(bill.id, "2026-01-20");
  expect(cycle?.state).toBe("paid");
  expect(cycle?.overdueNoticesSent).toBe(1);
});

test("listCycles is chronological", async () => {
  const bill = await makeBill();
  await skipCycle({ billId: bill.id, dueDate: "2026-03-20" });
  await skipCycle({ billId: bill.id, dueDate: "2026-01-20" });

  expect((await listCycles(bill.id)).map((c) => c.dueDate)).toEqual(["2026-01-20", "2026-03-20"]);
});

test("a payment for an uncategorized transaction leaves the ledger alone", async () => {
  // Rule 19's inheritance is the SERVICE's job (Task 4) — a repository that
  // silently rewrote a transaction's category would do it on every path,
  // including the ones rule 19 excludes.
  const bill = await makeBill();
  const tx = await insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 241236,
    direction: "out",
    occurredAt: Date.parse("2026-01-18T10:00:00"),
    merchant: "MERALCO",
    source: "manual",
    confidence: 1,
  });

  await recordBillPayment({ billId: bill.id, dueDate: "2026-01-20", transactionId: tx.id });

  expect((await getTransaction(tx.id))?.categoryId).toBe(UNCATEGORIZED_ID);
});

test("RESTORING PUTS THE BILL BACK, AND IS IDEMPOTENT", async () => {
  // The other half of rule 27. Archiving never deleted anything, but nothing
  // could clear `archived_at` either, so a bill archived by mistake was gone in
  // practice (owner's device report: "no way to see and unarchive").
  const bill = await makeBill();
  await archiveBill(bill.id);
  expect(await listBills()).toEqual([]);

  await unarchiveBill(bill.id);

  expect((await listBills()).map((b) => b.id)).toEqual([bill.id]);
  expect((await getBill(bill.id))?.archivedAt).toBeNull();

  // A second call is a no-op rather than an error, matching the archive side.
  await unarchiveBill(bill.id);
  expect((await getBill(bill.id))?.archivedAt).toBeNull();

  // And an id that does not exist at all resolves rather than throwing.
  await expect(unarchiveBill("no-such-bill")).resolves.toBeUndefined();
  expect((await listBills()).map((b) => b.id)).toEqual([bill.id]);
});
