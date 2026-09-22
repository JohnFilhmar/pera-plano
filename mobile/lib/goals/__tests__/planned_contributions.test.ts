// lib/goals/__tests__/planned_contributions.test.ts: GAP-056, goals rules 14
// and 15: a planned contribution is pending until money moved into the goal's
// wallet within three days covers it, the user records it, or the user skips it.
//
// Against the real migrations through freshDb(). The pay is real ledger credits,
// because safe-to-spend rule 6b builds every contribution from pay that ARRIVED.
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { decideContribution } from "@/lib/db/repos/contribution_decisions_repo";
import { createGoal } from "@/lib/db/repos/goals_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { __setTierForTests } from "@/lib/entitlements";
import { setManualIncome } from "@/lib/income/income_service";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import { listPaydayContributions, listPendingContributions, reservedFor } from "../planned_contributions";

/** Wednesday 2026-08-12, 10:00 local. */
const NOW = new Date(2026, 7, 12, 10, 0).getTime();
const AUGUST = { from: "2026-08-01", to: "2026-08-12" } as const;

let payroll: Wallet;
let gsave: Wallet;
let goalId: string;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  payroll = await createWallet({ name: "BPI Payroll" });
  gsave = await createWallet({ name: "GSave" });
  await setManualIncome(
    { cadence: "kinsenas", averageAmount: 1_500_000, sourceWalletIds: [payroll.id] },
    NOW,
  );
  goalId = (
    await createGoal({
      name: "Emergency Fund",
      targetAmount: 5_000_000,
      linkedWalletId: gsave.id,
      contributionRule: { kind: "fixed", amount: 200_000 },
    })
  ).id;
});

afterEach(async () => {
  __setTierForTests(null);
  await closeDatabase();
});

/** Pay landing in the payroll wallet. */
async function pay(amount: number, at: number): Promise<void> {
  await insertTransaction({
    walletId: payroll.id,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "in",
    occurredAt: at,
    merchant: "ACME PAYROLL",
    source: "notification",
    confidence: 0.9,
  });
}

/**
 * A move from payroll into the goal's wallet, as a linked transfer: what a
 * contribution is. Linked, so income detection never mistakes it for pay.
 */
async function save(amount: number, at: number): Promise<void> {
  const leg = { categoryId: UNCATEGORIZED_ID, amount, occurredAt: at, source: "manual" as const, confidence: 1 };
  const out = await insertTransaction({ ...leg, walletId: payroll.id, direction: "out" });
  const inLeg = await insertTransaction({ ...leg, walletId: gsave.id, direction: "in" });
  await linkTransfer(out.id, inLeg.id, 0, { detectedBy: "manual" });
}

const aug = (day: number, hour = 9) => new Date(2026, 7, day, hour, 0).getTime();

test("a payday's contribution is pending, and fully reserved, until something moves", async () => {
  await pay(1_500_000, aug(10));

  const [contribution] = await listPaydayContributions(AUGUST);

  expect(contribution).toEqual({
    goalId,
    paydayDate: "2026-08-10",
    amount: 200_000,
    matched: 0,
    status: "pending",
  });
  expect(reservedFor(contribution)).toBe(200_000);
});

test("money moved into the goal's wallet within three days completes it (rule 14a)", async () => {
  await pay(1_500_000, aug(10));
  await save(200_000, aug(13, 20)); // the third day after the payday, late evening

  const [contribution] = await listPaydayContributions(AUGUST);

  expect(contribution.status).toBe("completed");
  expect(contribution.matched).toBe(200_000);
  // Completed stays reserved: the transfer never touched a limit's headroom
  // (safe-to-spend rule 6a), so releasing it would hand the money back.
  expect(reservedFor(contribution)).toBe(200_000);
});

test("a transfer on the fourth day is too late to count", async () => {
  await pay(1_500_000, aug(10));
  // A second payday stretches the ledger read past the 14th, so only the first
  // payday's own window keeps the transfer out of its match.
  await pay(1_500_000, aug(12));
  await save(200_000, aug(14));

  const first = (await listPaydayContributions(AUGUST)).find(
    (contribution) => contribution.paydayDate === "2026-08-10",
  );

  expect(first).toMatchObject({ status: "pending", matched: 0 });
});

test("a partial move leaves the rest outstanding (rule 14)", async () => {
  await pay(1_500_000, aug(10));
  await save(50_000, aug(11));

  const [contribution] = await listPaydayContributions(AUGUST);
  expect(contribution).toMatchObject({ status: "pending", matched: 50_000 });

  expect(await listPendingContributions(NOW)).toEqual([
    { goalId, paydayDate: "2026-08-10", amount: 200_000, outstanding: 150_000 },
  ]);
});

test("a skip releases only what never moved (rule 15)", async () => {
  await pay(1_500_000, aug(10));
  await save(50_000, aug(11));
  await decideContribution({ goalId, paydayDate: "2026-08-10", decision: "skipped", now: NOW });

  const [contribution] = await listPaydayContributions(AUGUST);

  expect(contribution.status).toBe("skipped");
  expect(reservedFor(contribution)).toBe(50_000);
  expect(await listPendingContributions(NOW)).toEqual([]);
});

test("recording it completes it even when nothing matched in time (rule 14b)", async () => {
  await pay(1_500_000, aug(10));
  await decideContribution({ goalId, paydayDate: "2026-08-10", decision: "recorded", now: NOW });

  const [contribution] = await listPaydayContributions(AUGUST);

  expect(contribution.status).toBe("completed");
  expect(reservedFor(contribution)).toBe(200_000);
  expect(await listPendingContributions(NOW)).toEqual([]);
});

test("only the latest payday's contribution is shown as pending", async () => {
  // The earlier payday's prompt ended when the next pay landed. Whether its
  // reservation should end too is the open question safe-to-spend rule 6b
  // raises; the prompt, at least, is about this payday.
  await pay(1_500_000, aug(3));
  await pay(1_500_000, aug(10));

  expect((await listPendingContributions(NOW)).map((pending) => pending.paydayDate)).toEqual([
    "2026-08-10",
  ]);
});

test("a payday more than 31 days old is no longer pending", async () => {
  await pay(1_500_000, new Date(2026, 6, 10, 9, 0).getTime());

  expect(await listPendingContributions(NOW)).toEqual([]);
});

test("the pay itself landing in a goal's wallet does not count as saving it", async () => {
  // A goal can sit on the wallet the salary lands in. That credit is the
  // payday, not a transfer into the goal.
  const onPayroll = await createGoal({
    name: "Buffer",
    targetAmount: 5_000_000,
    linkedWalletId: payroll.id,
    contributionRule: { kind: "fixed", amount: 100_000 },
  });
  await pay(1_500_000, aug(10));

  const mine = (await listPaydayContributions(AUGUST)).find((c) => c.goalId === onPayroll.id);

  expect(mine).toMatchObject({ matched: 0, status: "pending" });
});

test("the free tier plans nothing (payday auto-allocate is Plus)", async () => {
  __setTierForTests("free");
  await pay(1_500_000, aug(10));

  expect(await listPaydayContributions(AUGUST)).toEqual([]);
  expect(await listPendingContributions(NOW)).toEqual([]);
});
