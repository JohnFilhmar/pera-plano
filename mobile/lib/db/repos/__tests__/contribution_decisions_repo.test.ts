// lib/db/repos/__tests__/contribution_decisions_repo.test.ts: GAP-056.
//
// What the user decided about one payday's planned contribution. Against the
// real migrations through freshDb().
import { closeDatabase } from "@/lib/db/database";
import { createGoal } from "@/lib/db/repos/goals_repo";
import { createWallet } from "@/lib/db/repos/wallets_repo";
import { freshDb } from "@/test_support/db";

import { decideContribution, listContributionDecisions } from "../contribution_decisions_repo";

const NOW = new Date(2026, 7, 12, 10, 0).getTime();

let goalId: string;

beforeEach(async () => {
  await freshDb();
  const wallet = await createWallet({ name: "GSave" });
  goalId = (await createGoal({ name: "Fund", targetAmount: 500000, linkedWalletId: wallet.id })).id;
});

afterEach(async () => {
  await closeDatabase();
});

test("a skip is kept, and a second skip changes nothing", async () => {
  await decideContribution({ goalId, paydayDate: "2026-08-10", decision: "skipped", now: NOW });
  await decideContribution({ goalId, paydayDate: "2026-08-10", decision: "skipped", now: NOW + 1 });

  expect(await listContributionDecisions("2026-08-01", "2026-08-31")).toEqual([
    { goalId, paydayDate: "2026-08-10", decision: "skipped" },
  ]);
});

test("recording overrides an earlier skip: the money moved after all", async () => {
  await decideContribution({ goalId, paydayDate: "2026-08-10", decision: "skipped", now: NOW });
  await decideContribution({ goalId, paydayDate: "2026-08-10", decision: "recorded", now: NOW + 1 });

  expect(await listContributionDecisions("2026-08-01", "2026-08-31")).toEqual([
    { goalId, paydayDate: "2026-08-10", decision: "recorded" },
  ]);
});

test("a skip never overrides a recording", async () => {
  await decideContribution({ goalId, paydayDate: "2026-08-10", decision: "recorded", now: NOW });
  await decideContribution({ goalId, paydayDate: "2026-08-10", decision: "skipped", now: NOW + 1 });

  expect(await listContributionDecisions("2026-08-01", "2026-08-31")).toEqual([
    { goalId, paydayDate: "2026-08-10", decision: "recorded" },
  ]);
});

test("listContributionDecisions reads only the paydays inside its range", async () => {
  await decideContribution({ goalId, paydayDate: "2026-07-31", decision: "skipped", now: NOW });
  await decideContribution({ goalId, paydayDate: "2026-08-15", decision: "skipped", now: NOW });

  expect(
    (await listContributionDecisions("2026-08-01", "2026-08-31")).map((row) => row.paydayDate),
  ).toEqual(["2026-08-15"]);
});
