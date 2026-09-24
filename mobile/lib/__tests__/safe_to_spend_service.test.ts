// lib/__tests__/safe_to_spend_service.test.ts — M3 Part 2 Task 2.
//
// Assembly only. The arithmetic is Task 1's and is tested there; what can go
// wrong HERE is a term gathered from the wrong place, filtered by the wrong
// predicate, or quietly recomputed — the last of which would make Task 1's
// worked-example tests stop protecting the number users actually see.
import { closeDatabase } from "@/lib/db/database";
import {
  createBill,
  recordBillPayment,
  resolveCycleExternally,
  skipCycle,
} from "@/lib/db/repos/bills_repo";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { decideContribution } from "@/lib/db/repos/contribution_decisions_repo";
import { createGoal } from "@/lib/db/repos/goals_repo";
import { createLimit, updateLimit } from "@/lib/db/repos/limits_repo";
import { enqueue } from "@/lib/db/repos/review_queue_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { setManualIncome } from "@/lib/income/income_service";
import { computeSafeToSpend } from "@/lib/safe_to_spend";
import { buildSafeToSpendInput, getSafeToSpend } from "@/lib/safe_to_spend_service";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

/** 2026-08-12 is a Wednesday, matching the spec's worked example. */
const TODAY = "2026-08-12";
const NOW = new Date(2026, 7, 12, 10, 0).getTime();
const DAY_MS = 86_400_000;

let cash: Wallet;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  cash = await createWallet({ name: "GCash" });
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

async function spend(amount: number, occurredAt: number, categoryId = UNCATEGORIZED_ID) {
  return insertTransaction({
    walletId: cash.id,
    categoryId,
    amount,
    direction: "out",
    occurredAt,
    merchant: "SM SUPERMARKET",
    source: "notification",
    confidence: 0.9,
  });
}

/**
 * Pay that actually landed. Since rule 6a the contributions term is built from
 * real credits rather than from projected cadence anchors, so a contribution
 * test has to put money in the ledger — which is the whole point: a date on a
 * calendar is no longer evidence that anything moved.
 *
 * `merchant` is constant so every credit lands in one `primaryStream` group,
 * and the amount clears income rule 1's ₱500.00 noise floor.
 */
async function payday(amount: number, occurredAt: number) {
  return insertTransaction({
    walletId: cash.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "in",
    occurredAt,
    merchant: "ACME PAYROLL",
    source: "notification",
    confidence: 0.9,
  });
}

// ---------------------------------------------------------------------------
// Rule 6 — the empty app
// ---------------------------------------------------------------------------
test("AN EMPTY APP YIELDS no_limit AND DOES NOT THROW", async () => {
  // The state every user starts in, on the first screen they ever see. A throw
  // here is a blank home tab with no way forward.
  const result = await getSafeToSpend(TODAY, NOW);

  expect(result.state).toBe("no_limit");
  expect(result.drivingLimitId).toBeNull();
});

// ---------------------------------------------------------------------------
// Limits — rules 2, 4, 10
// ---------------------------------------------------------------------------
test("AN ACTIVE FIXED LIMIT BECOMES A CANDIDATE CARRYING ITS SPEND", async () => {
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await spend(620_000, NOW - 3 * DAY_MS);

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.limits).toHaveLength(1);
  expect(input.limits[0]).toMatchObject({
    id: limit.id,
    scope: "monthly",
    effectiveValue: 1_500_000,
    spendInPeriod: 620_000,
    filtered: false,
    filterLabel: null,
  });
});

test("SPEND COMES FROM THE LIMIT ENGINE, TRANSFERS ALREADY EXCLUDED", async () => {
  // Rule 8 and rule 1 together: the exclusion is the engine's, and reproducing
  // it here would be the duplication that makes the two drift.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  const savings = await createWallet({ name: "GSave" });
  const out = await spend(200_000, NOW - 2 * DAY_MS);
  const into = await insertTransaction({
    walletId: savings.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 200_000,
    direction: "in",
    occurredAt: NOW - 2 * DAY_MS,
    merchant: "FROM GCASH",
    source: "notification",
    confidence: 0.9,
  });
  await linkTransfer(out.id, into.id, 0);

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.limits[0].spendInPeriod).toBe(0);
});

test("A PAUSED LIMIT IS EXCLUDED — A SWITCH MUST ACTUALLY SWITCH", async () => {
  // Plan rule 2. A paused limit that still capped the headline would be a
  // control the user turned off and that kept working.
  const limit = await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await updateLimit(limit.id, { isActive: false });

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.limits).toEqual([]);
  expect(computeSafeToSpend(input).state).toBe("no_limit");
});

test("A PERCENT-OF-INCOME LIMIT WITH NO INCOME IS EXCLUDED", async () => {
  // Rule 10: it has no usable value, so it cannot drive the number, and the
  // prompt to fix it belongs on the limit itself. Including it with a value of
  // zero would show ₱0.00 spendable to a user who has set no real cap.
  await createLimit({ scope: "monthly", basis: "percent-of-income", value: 2000 }); // 20%

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.limits).toEqual([]);
});

test("THE SAME PERCENT LIMIT BECOMES A CANDIDATE ONCE INCOME IS DECLARED", async () => {
  // The other half of rule 10, and proof the assembly actually threads income
  // into `getLimitStatuses` rather than defaulting it away.
  await createLimit({ scope: "monthly", basis: "percent-of-income", value: 2000 }); // 20%
  await setManualIncome({ cadence: "monthly", averageAmount: 5_000_000, sourceWalletIds: [cash.id] }, NOW);

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.limits).toHaveLength(1);
  expect(input.limits[0].effectiveValue).toBe(1_000_000); // 20% of ₱50,000.00
});

test("A FILTERED LIMIT IS MARKED AND ITS FILTER NAMED", async () => {
  // Rule 3 needs both: the flag to keep it from driving the headline, and the
  // label for the caption when it is the only limit there is.
  await createLimit({
    scope: "monthly",
    basis: "fixed",
    value: 300_000,
    categoryFilter: ["cat_food_dining"],
  });

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.limits[0].filtered).toBe(true);
  expect(input.limits[0].filterLabel).toBe("Food & Dining");
});

// ---------------------------------------------------------------------------
// Bills — rule 5
// ---------------------------------------------------------------------------
async function meralco(day: number, amount = 230_000) {
  return createBill({
    name: "Meralco",
    amount,
    amountMode: "fixed",
    dueRule: { kind: "day-of-month", day },
    categoryId: "cat_bills_utilities",
  });
}

test("UPCOMING BILLS INSIDE THE PERIOD ARE INCLUDED WITH THEIR AMOUNTS", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await meralco(20);

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.unpaidBills).toContainEqual(
    expect.objectContaining({ name: "Meralco", amount: 230_000, dueDate: "2026-08-20" }),
  );
});

test("AN OVERDUE UNPAID BILL IS INCLUDED — IT STILL HAS TO BE PAID", async () => {
  // Rule 5(a). The bill due on the 5th is three days past and unresolved; it
  // keeps subtracting until the user does something about it.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await meralco(5, 90_000);

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.unpaidBills.map((bill) => bill.dueDate)).toContain("2026-08-05");
});

test("A PAID CYCLE IS EXCLUDED — ITS MONEY IS ALREADY IN COMMITTED SPEND", async () => {
  // Rule 5: counting it twice would make the user's spendable figure wrong in
  // both terms at once.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  const bill = await meralco(5, 90_000);
  const tx = await spend(90_000, NOW - 7 * DAY_MS, "cat_bills_utilities");
  await recordBillPayment({ billId: bill.id, dueDate: "2026-08-05", transactionId: tx.id });

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.unpaidBills.map((b) => b.dueDate)).not.toContain("2026-08-05");
});

test("a skipped cycle is excluded too", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  const bill = await meralco(20);
  await skipCycle({ billId: bill.id, dueDate: "2026-08-20" });

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.unpaidBills.map((b) => b.dueDate)).not.toContain("2026-08-20");
});

test("A CYCLE PAID OUTSIDE EVERY TRACKED WALLET LEAVES THE BILLS TERM", async () => {
  // GAP-085's acceptance criterion, against the term Safe-to-Spend actually
  // reads — `unresolvedBills` here, not `totalDueInPeriod`, which has no
  // production caller.
  //
  // THIS IS THE HALF THAT HAS TO CHANGE. Money paid at a Bayad Center is gone;
  // continuing to hold it back (rule 5's "unresolved ... keep subtracting")
  // understates Safe-to-Spend for a bill that is settled, which is the whole
  // reason a cash payer had to lie to the app and skip the cycle instead.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  const bill = await meralco(20);

  const before = await buildSafeToSpendInput(TODAY, NOW);
  expect(before.unpaidBills.map((b) => b.dueDate)).toContain("2026-08-20");

  await resolveCycleExternally({ billId: bill.id, dueDate: "2026-08-20" });

  const after = await buildSafeToSpendInput(TODAY, NOW);
  expect(after.unpaidBills.map((b) => b.dueDate)).not.toContain("2026-08-20");
  // And no transaction was invented for it, so it does not reappear as spend
  // inside the driving limit either — it simply is not owed any more.
  expect(after.limits.map((limit) => limit.spendInPeriod)).toEqual(
    before.limits.map((limit) => limit.spendInPeriod),
  );
});

// ---------------------------------------------------------------------------
// Contributions — rule 6
// ---------------------------------------------------------------------------
test("A GOAL WITH A FIXED RULE RESERVES ON EVERY PAY THAT ACTUALLY ARRIVED", async () => {
  // Two credits on two DATES are two paydays, so the rule reserves twice. The
  // companion below is the same rule over two credits on ONE date, where it
  // must reserve once; between them they pin the collapse to the date and stop
  // it becoming "one reservation per window".
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });
  // Two credits this month, both before today (the 12th).
  await payday(1_500_000, new Date(2026, 7, 3, 9, 0).getTime());
  await payday(1_500_000, new Date(2026, 7, 10, 9, 0).getTime());

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.plannedContributions).toEqual([
    { goalId: goal.id, amount: 100_000, date: "2026-08-03" },
    { goalId: goal.id, amount: 100_000, date: "2026-08-10" },
  ]);
});

test("A FIXED RULE RESERVES ONCE FOR A PAYDAY SPLIT ACROSS TWO CREDITS", async () => {
  // A fixed amount is a PER-PAYDAY figure, not a per-credit one: goals rule 10
  // makes it the reference pace P and rule 9 measures the required pace R in
  // "paydays remaining", and rule 14 creates one planned contribution per
  // "payday trigger". An employer who pays a base credit and an allowance on
  // one day has paid once, so a ₱2,000.00 rule holds ₱2,000.00 back, not
  // ₱4,000.00 for a transfer the user is asked to make once.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_300_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 200_000 },
  });
  // Built from local calendar parts, not millisecond offsets, and asserted
  // below: two credits that straddled local midnight would be two paydays and
  // would be testing something else. The suite pins TZ to Asia/Manila.
  const base = new Date(2026, 7, 10, 9, 0).getTime();
  const allowance = new Date(2026, 7, 10, 17, 0).getTime();
  expect(new Date(base).toDateString()).toBe(new Date(allowance).toDateString());
  // Both halves sit inside one `primaryStream` amount band, so the ledger hands
  // the forecast two credits rather than dropping one.
  await payday(700_000, base);
  await payday(600_000, allowance);

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.plannedContributions).toEqual([
    { goalId: goal.id, amount: 200_000, date: "2026-08-10" },
  ]);
  // And the term the user actually feels: one rule amount, not two.
  expect(computeSafeToSpend(input).contributionsTerm).toBe(200_000);
});

test("PAY THAT NEVER ARRIVED RESERVES NOTHING — rule 6a, the delayed-salary case", async () => {
  // The owner's 2026-09-01 report in miniature: a kinsenas cadence, a live
  // contribution rule, an anchor already passed, and no pay in the ledger. The
  // old projection reserved ₱1,000 anyway and pinned the number at ₱0.00.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.plannedContributions).toEqual([]);
});

test("A PAYDAY LATER THIS PERIOD IS NOT RESERVED BEFORE IT LANDS", async () => {
  // Bounded at today. Reserving against a payday still to come is the same
  // guess in a shorter form, and it is the guess that broke.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });
  await payday(1_500_000, new Date(2026, 7, 25, 9, 0).getTime()); // after TODAY

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.plannedContributions).toEqual([]);
});

test("LATE PAY MOVES THE RESERVATION TO THE DAY IT ACTUALLY LANDED", async () => {
  // Kinsenas would have anchored the 15th of July; the money came on the 20th.
  // The reservation follows the money, with no expiry rule needed.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });
  await payday(1_500_000, new Date(2026, 7, 9, 9, 0).getTime());

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.plannedContributions.map((c) => c.date)).toEqual(["2026-08-09"]);
});

test("A PERCENT RULE TAKES ITS SHARE OF THE PAY THAT LANDED, NOT OF THE AVERAGE", async () => {
  // Goals rule 13: the base is the income that arrived on that payday date.
  // The profile average and the payday DIFFER here on purpose — a thirteenth
  // month pay is the whole point of the rule, and against the ₱10,000.00
  // average this would reserve ₱1,000.00 for a ₱13,000.00 packet.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_000_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "percent", percent: 10 },
  });
  await payday(1_300_000, new Date(2026, 7, 10, 9, 0).getTime());

  const input = await buildSafeToSpendInput(TODAY, NOW);

  // 10% of the ₱13,000.00 that landed, not of the ₱10,000.00 average.
  expect(input.plannedContributions).toEqual([
    { goalId: goal.id, amount: 130_000, date: "2026-08-10" },
  ]);
});

test("A PERCENT RULE TAKES ONE SHARE OF A PAYDAY SPLIT ACROSS TWO CREDITS", async () => {
  // Rule 13 computes from "the sum of income Transactions detected on that
  // payday date". Employers split pay — a base credit plus an allowance — and
  // per-credit shares would either reserve a slice of each half or, worse,
  // reserve the whole share twice on one day.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_000_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "percent", percent: 10 },
  });
  await payday(700_000, new Date(2026, 7, 10, 9, 0).getTime());
  await payday(600_000, new Date(2026, 7, 10, 17, 0).getTime());

  const input = await buildSafeToSpendInput(TODAY, NOW);

  // One reservation of 10% of ₱13,000.00 — not two.
  expect(input.plannedContributions).toEqual([
    { goalId: goal.id, amount: 130_000, date: "2026-08-10" },
  ]);
});

test("SKIPPING A CONTRIBUTION RELEASES IT FROM THE TERM THE SAME DAY (GAP-056)", async () => {
  // The entry's acceptance criterion. Safe-to-spend rule 6: "skipped and
  // expired contributions leave the term".
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });
  await payday(1_500_000, new Date(2026, 7, 10, 9, 0).getTime());
  const before = computeSafeToSpend(await buildSafeToSpendInput(TODAY, NOW));
  expect(before.contributionsTerm).toBe(100_000);

  await decideContribution({ goalId: goal.id, paydayDate: "2026-08-10", decision: "skipped", now: NOW });

  const input = await buildSafeToSpendInput(TODAY, NOW);
  const after = computeSafeToSpend(input);
  expect(input.plannedContributions).toEqual([]);
  expect(after.contributionsTerm).toBe(0);
  // The whole-period figure the per-day number is spread from rises by the skipped amount.
  const available = (result: typeof before) =>
    result.headroom - result.billsTerm - result.contributionsTerm;
  expect(available(after) - available(before)).toBe(100_000);
});

test("A PARTIAL MOVE BEFORE A SKIP STAYS RESERVED; ONLY THE REST IS RELEASED (rule 15)", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });
  await payday(1_500_000, new Date(2026, 7, 10, 9, 0).getTime());
  await insertTransaction({
    walletId: savings.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 30_000,
    direction: "in",
    occurredAt: new Date(2026, 7, 11, 9, 0).getTime(),
    source: "manual",
    confidence: 1,
  });

  await decideContribution({ goalId: goal.id, paydayDate: "2026-08-10", decision: "skipped", now: NOW });

  const input = await buildSafeToSpendInput(TODAY, NOW);
  expect(input.plannedContributions).toEqual([
    { goalId: goal.id, amount: 30_000, date: "2026-08-10" },
  ]);
});

test("A CONTRIBUTION RECORDED AS MADE STAYS RESERVED FOR THE PERIOD (rule 6)", async () => {
  // The transfer never touched the limit's headroom (rule 6a), so releasing a
  // completed contribution would hand saved money back as spendable.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });
  await payday(1_500_000, new Date(2026, 7, 10, 9, 0).getTime());
  await decideContribution({ goalId: goal.id, paydayDate: "2026-08-10", decision: "recorded", now: NOW });

  const input = await buildSafeToSpendInput(TODAY, NOW);
  expect(input.plannedContributions).toEqual([
    { goalId: goal.id, amount: 100_000, date: "2026-08-10" },
  ]);
});

test("A GOAL WITH NO CONTRIBUTION RULE FORECASTS NOTHING", async () => {
  // Rule 6: "Manual, unscheduled Goal contributions are not forecast; they
  // simply appear as spend/transfers when they happen."
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  await createGoal({ name: "Emergency Fund", targetAmount: 5_000_000, linkedWalletId: savings.id });

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.plannedContributions).toEqual([]);
});

test("AN IRREGULAR EARNER RESERVES ON REAL PAY LIKE ANYONE ELSE", async () => {
  // Rule 6a retires the old "unpredictable cadence forecasts nothing" carve-out.
  // It existed because a gig worker has no anchor to project from — but nobody
  // projects now, so irregular pay is reserved on arrival exactly like salaried
  // pay. Strictly better for the people the carve-out used to exclude.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "irregular", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });
  await payday(1_500_000, new Date(2026, 7, 6, 9, 0).getTime());

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(input.plannedContributions.map((c) => c.date)).toEqual(["2026-08-06"]);
});

test("A CONTRIBUTION EARLIER IN THE PERIOD IS STILL RESERVED", async () => {
  // Rule 6 counts "from the start of the period", not from today. On the 20th
  // the 15th's allocation is money already moved, and dropping it would hand it
  // back to the user's spendable figure.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });

  await payday(1_500_000, new Date(2026, 7, 15, 9, 0).getTime());

  const input = await buildSafeToSpendInput("2026-08-20", new Date(2026, 7, 20, 10, 0).getTime());

  expect(input.plannedContributions.map((c) => c.date)).toContain("2026-08-15");
});

test("THE FREE TIER RESERVES NOTHING — PAYDAY AUTO-ALLOCATION IS PLUS", async () => {
  // docs/04-features/09-safe-to-spend.md: "The Goal-contributions term is
  // effectively ₱0 for free users (payday auto-allocate is Plus)". On free the
  // rule is RETAINED and only the prompt stops firing (docs/05 §3.2), so money
  // reserved here would be held against a transfer nobody is ever asked to
  // make — every period, for as long as the rule exists.
  __setTierForTests("free");
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 2_000_000, sourceWalletIds: [cash.id] }, NOW);
  const savings = await createWallet({ name: "GSave" });
  await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 250_000 },
  });
  await payday(2_000_000, new Date(2026, 7, 10, 9, 0).getTime());

  const free = await buildSafeToSpendInput(TODAY, NOW);

  expect(free.plannedContributions).toEqual([]);
  expect(computeSafeToSpend(free).contributionsTerm).toBe(0);

  // The other half of the gate, over the SAME ledger: upgrading brings the
  // reservation back, so this test cannot be satisfied by a term that is
  // switched off for everyone.
  __setTierForTests("plus");
  const plus = await buildSafeToSpendInput(TODAY, NOW);

  expect(plus.plannedContributions).toEqual([
    { goalId: expect.any(String), amount: 250_000, date: "2026-08-10" },
  ]);
});

// ---------------------------------------------------------------------------
// Review queue — rule 12
// ---------------------------------------------------------------------------
test("THE REVIEW QUEUE COUNT IS CARRIED, NEVER SUBTRACTED", async () => {
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await spend(50_000, NOW - DAY_MS);
  await enqueue({ kind: "low-confidence", payload: { amount: 12_000 } });

  const input = await buildSafeToSpendInput(TODAY, NOW);
  const result = computeSafeToSpend(input);

  expect(input.reviewQueueCount).toBe(1);
  expect(result.reviewQueueCount).toBe(1);
  // The number reflects the spend, not the queue: headroom is 1,500,000 −
  // 50,000 over the 20 days from the 12th.
  expect(result.headroom).toBe(1_450_000);
});

// ---------------------------------------------------------------------------
// Rule 1 — no duplicate arithmetic
// ---------------------------------------------------------------------------
test("getSafeToSpend IS EXACTLY computeSafeToSpend OVER THE ASSEMBLED INPUT", async () => {
  // The test that keeps this module honest. If assembly ever starts computing
  // anything of its own, these two diverge — and Task 1's worked-example tests
  // would still pass while the home screen showed a different number.
  await createLimit({ scope: "monthly", basis: "fixed", value: 1_500_000 });
  await setManualIncome({ cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [cash.id] }, NOW);
  await meralco(20);
  await spend(620_000, NOW - 3 * DAY_MS);
  const savings = await createWallet({ name: "GSave" });
  await createGoal({
    name: "Emergency Fund",
    targetAmount: 5_000_000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });

  const input = await buildSafeToSpendInput(TODAY, NOW);

  expect(await getSafeToSpend(TODAY, NOW)).toEqual(computeSafeToSpend(input));
});
