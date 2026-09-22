// lib/goals/__tests__/goal_milestone_subscriber.test.ts — GAP-055, goals rule 12:
// "Milestone notifications fire when progress first crosses 25%, 50%, 75%, and
// 100%. Each milestone fires at most once per goal lifetime, so balance dips and
// recoveries cannot re-trigger them."
//
// Against the real migrations through freshDb(). Only the transport is mocked:
// alerts_service imports expo-notifications and the native listener, and the
// question here is what the pass decides to post, not how Android draws it.
jest.mock("@/lib/alerts/alerts_service", () => ({
  postAlert: jest.fn().mockResolvedValue("os-id"),
}));

import { postAlert } from "@/lib/alerts/alerts_service";
import { CHANNEL_GOALS } from "@/lib/alerts/channels";
import { closeDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import * as goalsRepo from "@/lib/db/repos/goals_repo";
import { archiveGoal, createGoal, updateGoal } from "@/lib/db/repos/goals_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { archiveWallet, createWallet } from "@/lib/db/repos/wallets_repo";
import { emitAppEvent } from "@/lib/events/app_events";
import { freshDb } from "@/test_support/db";

import { runGoalMilestonePass, startGoalMilestoneSubscriber } from "../goal_milestone_subscriber";

const mockPost = postAlert as jest.MockedFunction<typeof postAlert>;

/** ₱50,000.00, the spec's own example target. */
const TARGET = 5_000_000;

let walletId: string;

beforeEach(async () => {
  await freshDb();
  await seedDefaultCategories();
  jest.clearAllMocks();
  walletId = (await createWallet({ name: "GSave" })).id;
});

afterEach(async () => {
  await closeDatabase();
});

/** Moves the savings wallet's balance by `amount` centavos, in or out. */
async function move(amount: number, options: { isAdjustment?: boolean } = {}): Promise<void> {
  await insertTransaction({
    walletId,
    categoryId: UNCATEGORIZED_ID,
    amount: Math.abs(amount),
    direction: amount >= 0 ? "in" : "out",
    occurredAt: Date.now(),
    source: "manual",
    confidence: 1,
    isAdjustment: options.isAdjustment,
  });
}

async function emergencyFund(): Promise<string> {
  return (await createGoal({ name: "Emergency Fund", targetAmount: TARGET, linkedWalletId: walletId })).id;
}

/** The milestone each posted alert announced, in order. */
function announced(): unknown[] {
  return mockPost.mock.calls.map(([input]) => input.data?.milestone);
}

/** Resolves once `condition` holds; a fixed sleep is how a slow CI box turns a test flaky. */
async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("the condition never came true");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("crossing half the target posts one Goal update on the goals channel, routed to that goal", async () => {
  const goalId = await emergencyFund();
  await move(2_500_000);

  await runGoalMilestonePass();

  expect(mockPost).toHaveBeenCalledTimes(1);
  const [input] = mockPost.mock.calls[0];
  expect(input.channel).toBe(CHANNEL_GOALS);
  expect(input.data).toEqual({ kind: "goalMilestone", goalId, milestone: 50 });
  // docs/06 §6.1's illustrative text, in the app's integer-peso format.
  expect(input.copy.unlocked.body).toBe("Halfway there! ₱25,000 of ₱50,000 saved for Emergency Fund.");
  // docs/12 §7a: a name the user configured, and no figure.
  expect(input.copy.locked.body).toBe("Emergency Fund is halfway there.");
});

test("A DIP AND A RE-CROSS POST NOTHING MORE", async () => {
  // The entry's acceptance criterion, word for word: crossing 50 percent twice
  // posts one notification.
  await emergencyFund();
  await move(2_600_000); // 52%
  await runGoalMilestonePass();
  await move(-200_000); // 48%
  await runGoalMilestonePass();
  await move(300_000); // 54%
  await runGoalMilestonePass();

  expect(announced()).toEqual([50]);
});

test("each milestone is announced once, in order, as the balance climbs", async () => {
  await emergencyFund();
  for (const step of [1_300_000, 1_300_000, 1_300_000, 1_300_000]) {
    await move(step); // 26%, 52%, 78%, 104%
    await runGoalMilestonePass();
  }
  await runGoalMilestonePass();

  expect(announced()).toEqual([25, 50, 75, 100]);
});

test("one change that crosses several milestones announces only the highest, and the lower ones never follow", async () => {
  // The rule limits already follow, docs/06 §6.2 rule 2.
  await emergencyFund();
  await move(4_000_000); // 80%: past 25, 50 and 75 at once
  await runGoalMilestonePass();
  await move(-2_000_000); // 40%
  await runGoalMilestonePass();
  await move(1_000_000); // 60%
  await runGoalMilestonePass();

  expect(announced()).toEqual([75]);
});

test("raising the target never re-announces a milestone the goal already passed (rule 20)", async () => {
  const goalId = await emergencyFund();
  await move(2_600_000); // 52%
  await runGoalMilestonePass();

  await updateGoal(goalId, { targetAmount: 10_000_000 }); // now 26%
  await move(2_500_000); // 51% of the new target
  await runGoalMilestonePass();

  expect(announced()).toEqual([50]);
});

test("progress the wallet already held when the goal was created is not announced (rule 4)", async () => {
  await move(3_000_000); // ₱30,000 saved before the goal exists: 60%
  await emergencyFund();
  await runGoalMilestonePass();
  expect(mockPost).not.toHaveBeenCalled();

  await move(900_000); // 78%
  await runGoalMilestonePass();
  expect(announced()).toEqual([75]);
});

test("a reconciliation that crosses a milestone announces it, like any other change to the balance", async () => {
  // The entry said "do not fire on manual balance corrections". The spec says
  // otherwise twice: rule 21 forbids only a RE-fire after a reconciliation, and
  // its acceptance criteria require goals on manual wallets to "behave
  // identically to tracked ones given the same balance history".
  await emergencyFund();
  await move(2_600_000, { isAdjustment: true });

  await runGoalMilestonePass();

  expect(announced()).toEqual([50]);
});

test("a deleted goal, and a goal whose wallet is archived, announce nothing", async () => {
  const deleted = await emergencyFund();
  await move(2_600_000);
  await archiveGoal(deleted);

  const vault = await createWallet({ name: "SeaBank" });
  await createGoal({ name: "Phone", targetAmount: 1_000_000, linkedWalletId: vault.id });
  await insertTransaction({
    walletId: vault.id,
    categoryId: UNCATEGORIZED_ID,
    amount: 600_000,
    direction: "in",
    occurredAt: Date.now(),
    source: "manual",
    confidence: 1,
  });
  // Rule 18: archiving the wallet pauses its goal.
  await archiveWallet(vault.id);

  await runGoalMilestonePass();

  expect(mockPost).not.toHaveBeenCalled();
});

test("the subscriber checks at launch, then once after a burst of commits", async () => {
  const listed = jest.spyOn(goalsRepo, "listGoalMilestoneStates");
  await emergencyFund();
  await move(1_300_000); // 26% before the subscriber exists: the launch pass catches it

  const stop = startGoalMilestoneSubscriber({ debounceMs: 20 });
  await until(() => mockPost.mock.calls.length === 1);

  await move(1_300_000); // 52%
  for (let index = 0; index < 10; index++) {
    await emitAppEvent("ledger:committed", { transactionId: `tx-${index}` });
  }
  await until(() => mockPost.mock.calls.length === 2);
  // Long enough for a straggling second pass to have run, if the debounce leaked one.
  await pause(150);
  stop();

  expect(listed).toHaveBeenCalledTimes(2);
  expect(announced()).toEqual([25, 50]);
  listed.mockRestore();
});

test("teardown cancels a pass still waiting to fire", async () => {
  const listed = jest.spyOn(goalsRepo, "listGoalMilestoneStates");
  const stop = startGoalMilestoneSubscriber({ debounceMs: 50 });
  await until(() => listed.mock.calls.length === 1);

  await emitAppEvent("ledger:committed", { transactionId: "tx-1" });
  stop();
  await pause(200);

  expect(listed).toHaveBeenCalledTimes(1);
  listed.mockRestore();
});
