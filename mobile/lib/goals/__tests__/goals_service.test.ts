// lib/goals/__tests__/goals_service.test.ts — m2b Task 3.
//
// Against the REAL migrations through freshDb(). The load-bearing claim of this
// whole task is rule 1 — "the app does not move money, it records that the user
// did" — so several tests below assert that NOTHING was written, which is the
// one thing a mocked repository could never prove.
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { createGoal } from "@/lib/db/repos/goals_repo";
import { insertTransaction, listTransactions, sumSpend } from "@/lib/db/repos/transactions_repo";
import * as transferLinksRepo from "@/lib/db/repos/transfer_links_repo";
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import type { AppEventMap } from "@/lib/events/app_events";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import { listContributionDecisions } from "@/lib/db/repos/contribution_decisions_repo";

import {
  applyAllocations,
  listGoalStatuses,
  proposePaydayAllocations,
  skipAllocations,
} from "../goals_service";

const NOW = new Date(2026, 7, 15, 12, 0).getTime();

let payroll: Wallet;
let gsave: Wallet;
let seabank: Wallet;

/** A payday of `amount` landing in the payroll wallet. */
function paydayOf(amount: number): AppEventMap["income:payday"] {
  return {
    transactionIds: ["tx-payday"],
    walletId: payroll.id,
    amount,
    occurredAt: NOW,
  };
}

beforeEach(async () => {
  await freshDb();
  __setTierForTests(null);
  await seedDefaultCategories();
  payroll = await createWallet({ name: "BPI Payroll" });
  gsave = await createWallet({ name: "GSave" });
  seabank = await createWallet({ name: "SeaBank" });
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------
test("listGoalStatuses returns progress for every goal", async () => {
  const first = await createGoal({ name: "Emergency", targetAmount: 5000000, linkedWalletId: gsave.id });
  const second = await createGoal({ name: "Travel", targetAmount: 2000000, linkedWalletId: seabank.id });
  await fund(gsave.id, 2500000);

  const statuses = await listGoalStatuses(NOW);

  expect(statuses.map((status) => status.goal.id)).toEqual([first.id, second.id]);
  expect(statuses[0].progress.saved).toBe(2500000);
  expect(statuses[0].progress.fraction).toBe(0.5);
  expect(statuses[1].progress.saved).toBe(0);
});

// ---------------------------------------------------------------------------
// Proposals — rules 2, 3, 5
// ---------------------------------------------------------------------------
test("a goal with NO contribution rule proposes nothing", async () => {
  await createGoal({ name: "Emergency", targetAmount: 5000000, linkedWalletId: gsave.id });

  expect(await proposePaydayAllocations(paydayOf(1850000), NOW)).toEqual([]);
});

test("a fixed rule proposes its exact amount", async () => {
  const goal = await createGoal({
    name: "Emergency",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });

  const proposals = await proposePaydayAllocations(paydayOf(1850000), NOW);

  expect(proposals).toEqual([
    {
      goalId: goal.id,
      goalName: "Emergency",
      amount: 200000,
      requested: 200000,
      fromWalletId: payroll.id,
      toWalletId: gsave.id,
      // The local day the pay landed: the key a skip or a recording is filed under.
      paydayDate: "2026-08-15",
    },
  ]);
});

test("a percent rule proposes that percentage OF THE PAYDAY AMOUNT", async () => {
  // Spec rule 13: "Percent rules compute from the sum of income Transactions
  // detected on that payday date" — the actual credit, not `averageAmount`.
  await createGoal({
    name: "Travel",
    targetAmount: 2000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "percent", percent: 10 },
  });

  const proposals = await proposePaydayAllocations(paydayOf(1850000), NOW);

  expect(proposals[0].amount).toBe(185000); // 10% of ₱18,500.00
});

test("a percent rule rounds to the nearest centavo", async () => {
  // `percent` is a PLAIN percentage here (10 means 10%), unlike `Limit.value`,
  // which types/domain.ts documents as percent × 100. The absence of that note
  // on ContributionRule is the difference, and it is worth not "fixing".
  await createGoal({
    name: "Travel",
    targetAmount: 2000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "percent", percent: 10 },
  });

  const proposals = await proposePaydayAllocations(paydayOf(1000001), NOW);

  expect(proposals[0].amount).toBe(100000); // ₱10,000.01 × 10% → ₱1,000.00
});

test("a REACHED goal proposes nothing", async () => {
  // Pouring more money into a met target is not what the user asked for, and
  // the spec's Reached card offers Complete / Raise target / Keep as-is —
  // none of which is "keep allocating".
  await createGoal({
    name: "Done",
    targetAmount: 100000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });
  await fund(gsave.id, 100000);

  expect(await proposePaydayAllocations(paydayOf(1850000), NOW)).toEqual([]);
});

test("a proposal never exceeds what the goal still needs", async () => {
  // A ₱2,000 rule against a goal ₱500 short would move ₱1,500 past the target.
  await createGoal({
    name: "Almost",
    targetAmount: 100000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });
  await fund(gsave.id, 50000);

  const proposals = await proposePaydayAllocations(paydayOf(1850000), NOW);

  expect(proposals[0].amount).toBe(50000);
  expect(proposals[0].requested).toBe(200000);
});

test("TOTAL PROPOSALS ARE CAPPED AT THE PAYDAY AMOUNT, nearest deadline first", async () => {
  // Rule 3: "a user cannot allocate ₱25,000 out of a ₱20,000 payday". The cap
  // runs in goal-priority order so the most urgent deadline is funded first,
  // and the one that gets trimmed says so.
  const urgent = await createGoal({
    name: "Urgent",
    targetAmount: 5000000,
    targetDate: "2026-09-01",
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 700000 },
  });
  const later = await createGoal({
    name: "Later",
    targetAmount: 5000000,
    targetDate: "2026-12-01",
    linkedWalletId: seabank.id,
    contributionRule: { kind: "fixed", amount: 600000 },
  });

  const proposals = await proposePaydayAllocations(paydayOf(1000000), NOW);

  expect(proposals.map((p) => [p.goalId, p.amount, p.requested])).toEqual([
    [urgent.id, 700000, 700000],
    [later.id, 300000, 600000], // trimmed, and the shortfall is visible
  ]);
});

test("a goal with NO deadline is funded after the ones that have dates", async () => {
  const dated = await createGoal({
    name: "Dated",
    targetAmount: 5000000,
    targetDate: "2026-09-01",
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 800000 },
  });
  const undated = await createGoal({
    name: "Undated",
    targetAmount: 5000000,
    linkedWalletId: seabank.id,
    contributionRule: { kind: "fixed", amount: 800000 },
  });

  const proposals = await proposePaydayAllocations(paydayOf(1000000), NOW);

  expect(proposals.map((p) => p.goalId)).toEqual([dated.id, undated.id]);
  expect(proposals[1].amount).toBe(200000);
});

test("a goal left with nothing is dropped, not proposed at zero", async () => {
  await createGoal({
    name: "First",
    targetAmount: 5000000,
    targetDate: "2026-09-01",
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 1000000 },
  });
  await createGoal({
    name: "Second",
    targetAmount: 5000000,
    targetDate: "2026-12-01",
    linkedWalletId: seabank.id,
    contributionRule: { kind: "fixed", amount: 500000 },
  });

  const proposals = await proposePaydayAllocations(paydayOf(1000000), NOW);

  // A "move ₱0.00" row is a prompt with nothing to accept.
  expect(proposals).toHaveLength(1);
});

test("PROPOSALS ARE NOT GENERATED ON THE FREE TIER", async () => {
  // Rule 5, and docs/05 §3.2: "payday auto-allocation stops entirely (it is a
  // Plus capability): contributionRule settings are RETAINED but no prompts
  // fire". The rule survives; only the prompt is gated.
  __setTierForTests("free");
  const goal = await createGoal({
    name: "Emergency",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });

  expect(await proposePaydayAllocations(paydayOf(1850000), NOW)).toEqual([]);
  // Gate principle 1: the cap blocks an action, it never deletes what the user
  // configured — so an upgrade restores exactly the rule they had.
  expect((await listGoalStatuses(NOW)).find((s) => s.goal.id === goal.id)?.goal.contributionRule)
    .toEqual({ kind: "fixed", amount: 200000 });
});

test("NOTHING IS WRITTEN UNTIL applyAllocations IS CALLED", async () => {
  // Rule 1, the whole task in one assertion: "PeraPlano proposes the moves and
  // the user confirms. The app does not move money — it records that the user
  // did." A proposal that pre-wrote anything would put transactions in the
  // ledger the user never made.
  await createGoal({
    name: "Emergency",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });

  await proposePaydayAllocations(paydayOf(1850000), NOW);

  expect(await listTransactions({})).toEqual([]);
  expect((await getWallet(gsave.id))?.balance).toBe(0);
  expect((await getWallet(payroll.id))?.balance).toBe(0);
});

// ---------------------------------------------------------------------------
// Applying — rules 4 and 6
// ---------------------------------------------------------------------------
test("APPLYING WRITES BOTH LEGS AND LINKS THEM", async () => {
  // Rule 4. Two transactions and a TransferLink, so the movement is excluded
  // from spend and income totals like any other internal transfer.
  const goal = await createGoal({
    name: "Emergency",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });
  const proposals = await proposePaydayAllocations(paydayOf(1850000), NOW);

  const linkIds = await applyAllocations(proposals, NOW);

  expect(linkIds).toHaveLength(1);
  const link = await transferLinksRepo.getTransferLink(linkIds[0]);
  expect(link).not.toBeNull();

  const rows = await listTransactions({});
  expect(rows).toHaveLength(2);
  const out = rows.find((row) => row.direction === "out");
  const inLeg = rows.find((row) => row.direction === "in");
  expect(out?.walletId).toBe(payroll.id);
  expect(inLeg?.walletId).toBe(gsave.id);
  expect(out?.amount).toBe(200000);
  expect(inLeg?.amount).toBe(200000);
  // Both legs carry the link, which is what excludes them from totals.
  expect(out?.transferLinkId).toBe(linkIds[0]);
  expect(inLeg?.transferLinkId).toBe(linkIds[0]);
  void goal;
});

test("the wallets move by the allocated amount", async () => {
  await createGoal({
    name: "Emergency",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });
  await fund(payroll.id, 1850000);
  const proposals = await proposePaydayAllocations(paydayOf(1850000), NOW);

  await applyAllocations(proposals, NOW);

  expect((await getWallet(payroll.id))?.balance).toBe(1650000);
  expect((await getWallet(gsave.id))?.balance).toBe(200000);
});

test("APPLIED ALLOCATIONS ARE EXCLUDED FROM sumSpend", async () => {
  // The transfer invariant, regression-tested end to end. Without it, moving
  // ₱2,000 into savings would read as ₱2,000 spent and eat the user's limit.
  await createGoal({
    name: "Emergency",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });
  const proposals = await proposePaydayAllocations(paydayOf(1850000), NOW);

  await applyAllocations(proposals, NOW);

  const spend = await sumSpend({ from: NOW - 86_400_000, to: NOW + 86_400_000 });
  expect(spend).toBe(0);
});

test("APPLYING IS ATOMIC — a failure on the link leaves no legs behind", async () => {
  // Rule 6: "both legs and the link, or nothing." A half-applied allocation
  // would show money leaving the payroll wallet and never arriving.
  await createGoal({
    name: "Emergency",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });
  const proposals = await proposePaydayAllocations(paydayOf(1850000), NOW);
  const spy = jest
    .spyOn(transferLinksRepo, "linkTransfer")
    .mockRejectedValue(new Error("link failed"));

  await expect(applyAllocations(proposals, NOW)).rejects.toThrow("link failed");

  expect(await listTransactions({})).toEqual([]);
  expect((await getWallet(payroll.id))?.balance).toBe(0);
  expect((await getWallet(gsave.id))?.balance).toBe(0);
  spy.mockRestore();
});

test("applying an empty list writes nothing and returns nothing", async () => {
  expect(await applyAllocations([], NOW)).toEqual([]);
  expect(await listTransactions({})).toEqual([]);
});

test("only the proposals handed in are applied", async () => {
  // The sheet lets the user uncheck rows (Task 4 rule 6), so `applyAllocations`
  // must commit its argument rather than re-deriving the proposals.
  await createGoal({
    name: "First",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });
  await createGoal({
    name: "Second",
    targetAmount: 5000000,
    linkedWalletId: seabank.id,
    contributionRule: { kind: "fixed", amount: 300000 },
  });
  const proposals = await proposePaydayAllocations(paydayOf(1850000), NOW);
  expect(proposals).toHaveLength(2);

  const linkIds = await applyAllocations([proposals[0]], NOW);

  expect(linkIds).toHaveLength(1);
  expect(await listTransactions({})).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fund(walletId: string, amount: number): Promise<void> {
  await insertTransaction({
    walletId,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "in",
    occurredAt: NOW - 86_400_000,
    source: "manual",
    confidence: 1,
  });
}

// ---------------------------------------------------------------------------
// Decisions (GAP-056, goals rule 14). Recording a proposal completes that
// payday's contribution; skipping one releases it from Safe-to-Spend.
// ---------------------------------------------------------------------------
test("applying a proposal records that payday's contribution as made", async () => {
  const goal = await createGoal({
    name: "Emergency",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });
  const proposals = await proposePaydayAllocations(paydayOf(1850000), NOW);

  await applyAllocations(proposals, NOW);

  expect(await listContributionDecisions("2026-08-15", "2026-08-15")).toEqual([
    { goalId: goal.id, paydayDate: "2026-08-15", decision: "recorded" },
  ]);
});

test("skipAllocations records a skip for each proposal it is given", async () => {
  const emergency = await createGoal({
    name: "Emergency",
    targetAmount: 5000000,
    linkedWalletId: gsave.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });
  const travel = await createGoal({
    name: "Travel",
    targetAmount: 2000000,
    linkedWalletId: seabank.id,
    contributionRule: { kind: "fixed", amount: 100000 },
  });
  const proposals = await proposePaydayAllocations(paydayOf(1850000), NOW);

  await skipAllocations(proposals, NOW);

  const decisions = await listContributionDecisions("2026-08-15", "2026-08-15");
  expect(decisions.map((row) => [row.goalId, row.decision]).sort()).toEqual(
    [
      [emergency.id, "skipped"],
      [travel.id, "skipped"],
    ].sort(),
  );
  // And a skip writes nothing to the ledger: the app never moves money.
  expect(await listTransactions({})).toEqual([]);
});
