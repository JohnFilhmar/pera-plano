// lib/db/repos/__tests__/goals_repo.test.ts — m2b Task 1.
//
// Against the REAL migrations through freshDb(). 001_core.sql already carries
// half of this task's rules as constraints — `linked_wallet_id TEXT NOT NULL
// UNIQUE REFERENCES wallets(id)` is domain invariant I10's second half — so the
// repo's job is to turn those into errors a caller can branch on rather than to
// re-enforce them in JavaScript.
import { closeDatabase } from "@/lib/db/database";
import type { SQLiteDatabase } from "@/lib/db/database";
import { seedDefaultCategories, UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { archiveWallet, createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import {
  countGoals,
  completeGoal,
  createGoal,
  archiveGoal,
  unarchiveGoal,
  GoalNotFoundError,
  getGoal,
  listGoalMilestoneStates,
  listGoals,
  raiseGoalMilestone,
  updateGoal,
  WalletAlreadyHasGoalError,
  LinkedWalletNotFoundError,
} from "../goals_repo";

let db: SQLiteDatabase;
let savings: Wallet;
let otherSavings: Wallet;
let spending: Wallet;

beforeEach(async () => {
  db = await freshDb();
  await seedDefaultCategories();
  savings = await createWallet({ name: "GSave" });
  otherSavings = await createWallet({ name: "SeaBank" });
  spending = await createWallet({ name: "GCash" });
});

afterEach(async () => {
  await closeDatabase();
});

// ---------------------------------------------------------------------------
// Create and read
// ---------------------------------------------------------------------------
test("creates and reads a goal, contribution rule and all", async () => {
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5000000, // ₱50,000.00
    targetDate: "2027-06-01",
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });

  expect(goal.id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(goal.name).toBe("Emergency Fund");
  expect(goal.targetAmount).toBe(5000000);
  expect(goal.targetDate).toBe("2027-06-01");
  expect(goal.linkedWalletId).toBe(savings.id);
  expect(goal.contributionRule).toEqual({ kind: "fixed", amount: 200000 });
  expect(await getGoal(goal.id)).toEqual(goal);
});

test("a goal with no deadline and no contribution rule is valid", async () => {
  // Rule 4: "a goal with no deadline is valid". And `contributionRule` is Plus
  // only (spec step 5), so most goals have none.
  const goal = await createGoal({
    name: "New laptop",
    targetAmount: 6000000,
    linkedWalletId: savings.id,
  });

  expect(goal.targetDate).toBeNull();
  // NULL, not `{ kind: "none" }`. The m2b plan adds a third variant to
  // ContributionRule; types/domain.ts has two and uses `null` for absence, and
  // two ways to say "no rule" is how one of them stops being handled.
  expect(goal.contributionRule).toBeNull();
});

test("a percent contribution rule round-trips", async () => {
  const goal = await createGoal({
    name: "Travel",
    targetAmount: 3000000,
    linkedWalletId: savings.id,
    contributionRule: { kind: "percent", percent: 10 },
  });

  expect((await getGoal(goal.id))?.contributionRule).toEqual({ kind: "percent", percent: 10 });
});

test("getGoal returns null for an id that does not exist", async () => {
  expect(await getGoal("no-such-goal")).toBeNull();
});

// ---------------------------------------------------------------------------
// Invariant I10 — a savings wallet, and only one goal on it
// ---------------------------------------------------------------------------
test("ANY WALLET CAN BACK A GOAL", async () => {
  // The savings-only rule is GONE. It required the user to have declared, during
  // onboarding, that a wallet was "savings" — a claim they had no way to make
  // accurately. With the type picker removed the app would have had to INFER
  // savings-ness and then refuse a goal on its own guess, which is the worst
  // version of the rule: a blocked user, no explanation they can act on.
  const goal = await createGoal({
    name: "Laptop",
    targetAmount: 100000,
    linkedWalletId: spending.id,
  });

  expect(goal.linkedWalletId).toBe(spending.id);
  expect(await countGoals()).toBe(1);
});

test("a wallet that does not exist is still rejected", async () => {
  // The one half of the old check that survives, and it earns its place: the
  // column is a foreign key, so without this the caller gets a raw SQLite
  // constraint failure instead of an error a screen can branch on.
  await expect(
    createGoal({ name: "Nope", targetAmount: 100000, linkedWalletId: "no-such-wallet" }),
  ).rejects.toThrow(LinkedWalletNotFoundError);
});

test("A WALLET BACKS AT MOST ONE GOAL", async () => {
  // I10's second half. Two goals sharing a wallet would each claim the same
  // pesos — both would show ₱50,000 saved from one ₱50,000 balance, and the
  // user would believe they had twice the money they have.
  await createGoal({ name: "First", targetAmount: 5000000, linkedWalletId: savings.id });

  await expect(
    createGoal({ name: "Second", targetAmount: 100000, linkedWalletId: savings.id }),
  ).rejects.toThrow(WalletAlreadyHasGoalError);

  expect(await countGoals()).toBe(1);
});

test("the second-goal rejection names the wallet, not a SQLite constraint", async () => {
  // The screen has to tell the user WHICH wallet is taken so they can pick
  // another. "UNIQUE constraint failed: goals.linked_wallet_id" cannot.
  await createGoal({ name: "First", targetAmount: 5000000, linkedWalletId: savings.id });

  await expect(
    createGoal({ name: "Second", targetAmount: 100000, linkedWalletId: savings.id }),
  ).rejects.toMatchObject({ walletId: savings.id });
});

test("a freed wallet can back a new goal", async () => {
  // Deleting the first goal releases the wallet — otherwise a user who
  // abandoned a goal could never reuse the account behind it.
  const first = await createGoal({ name: "First", targetAmount: 5000000, linkedWalletId: savings.id });
  await archiveGoal(first.id);

  const second = await createGoal({ name: "Second", targetAmount: 100000, linkedWalletId: savings.id });

  expect(second.linkedWalletId).toBe(savings.id);
});

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
test("lists goals oldest first, and REACHED GOALS ARE INCLUDED BY DEFAULT", async () => {
  // The m2b plan says `listGoals` "excludes achieved goals by default". The
  // spec's states table says a Reached goal shows a "Celebration state; card
  // offers Complete, Raise target, or Keep as-is" — actions that cannot be
  // offered on a hidden card, and there is no `completed` column for the user
  // to reach afterwards. Per this plan's own Global Constraints, the spec wins.
  const reached = await createGoal({
    name: "Done",
    targetAmount: 100000,
    linkedWalletId: savings.id,
  });
  const open = await createGoal({
    name: "Open",
    targetAmount: 5000000,
    linkedWalletId: otherSavings.id,
  });
  await fundWallet(savings.id, 100000); // balance == target

  const all = await listGoals();

  expect(all.map((goal) => goal.id)).toEqual([reached.id, open.id]);
});

test("reached goals can be filtered out on request", async () => {
  const reached = await createGoal({
    name: "Done",
    targetAmount: 100000,
    linkedWalletId: savings.id,
  });
  const open = await createGoal({
    name: "Open",
    targetAmount: 5000000,
    linkedWalletId: otherSavings.id,
  });
  await fundWallet(savings.id, 150000); // comfortably over target

  const unreached = await listGoals({ includeAchieved: false });

  expect(unreached.map((goal) => goal.id)).toEqual([open.id]);
  void reached;
});

test("reached is balance AT OR ABOVE target, not strictly above", async () => {
  // Spec rule 10: "Reached when balance ≥ targetAmount". Exactly hitting the
  // target is the moment worth celebrating; `>` would miss it.
  const goal = await createGoal({
    name: "Exact",
    targetAmount: 100000,
    linkedWalletId: savings.id,
  });
  await fundWallet(savings.id, 100000);

  expect(await listGoals({ includeAchieved: false })).toEqual([]);
  void goal;
});

test("listGoals is empty on a fresh database", async () => {
  expect(await listGoals()).toEqual([]);
  expect(await countGoals()).toBe(0);
});

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
test("updates fields and leaves the rest alone", async () => {
  const goal = await createGoal({
    name: "Emergency Fund",
    targetAmount: 5000000,
    targetDate: "2027-06-01",
    linkedWalletId: savings.id,
    contributionRule: { kind: "fixed", amount: 200000 },
  });

  const updated = await updateGoal(goal.id, { targetAmount: 6000000 });

  expect(updated.targetAmount).toBe(6000000);
  expect(updated.name).toBe("Emergency Fund");
  expect(updated.targetDate).toBe("2027-06-01");
  expect(updated.contributionRule).toEqual({ kind: "fixed", amount: 200000 });
  expect(updated.updatedAt).toBeGreaterThanOrEqual(goal.updatedAt);
});

test("an explicit null clears the deadline or the contribution rule", async () => {
  // "Move the date" and "turn the rule off" have to be expressible. With `??`
  // merging, clearing and not-mentioning would be the same request.
  const goal = await createGoal({
    name: "Travel",
    targetAmount: 3000000,
    targetDate: "2027-06-01",
    linkedWalletId: savings.id,
    contributionRule: { kind: "percent", percent: 10 },
  });

  const cleared = await updateGoal(goal.id, { targetDate: null, contributionRule: null });

  expect(cleared.targetDate).toBeNull();
  expect(cleared.contributionRule).toBeNull();
});

test("updateGoal can move a goal to any wallet, including a spending one", async () => {
  const goal = await createGoal({ name: "Travel", targetAmount: 3000000, linkedWalletId: savings.id });

  const moved = await updateGoal(goal.id, { linkedWalletId: spending.id });
  expect(moved.linkedWalletId).toBe(spending.id);
});

test("updateGoal still rejects a move to a wallet that does not exist", async () => {
  const goal = await createGoal({ name: "Travel", targetAmount: 3000000, linkedWalletId: savings.id });

  await expect(updateGoal(goal.id, { linkedWalletId: "no-such-wallet" })).rejects.toThrow(
    LinkedWalletNotFoundError,
  );
});

test("updateGoal throws GoalNotFoundError for an unknown id", async () => {
  await expect(updateGoal("no-such-goal", { name: "x" })).rejects.toThrow(GoalNotFoundError);
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------
test("DELETING A GOAL LEAVES THE WALLET AND ITS TRANSACTIONS UNTOUCHED", async () => {
  // Rule 3: "the money is real, the goal is only a lens over it". A delete that
  // took the wallet with it would turn abandoning a plan into losing savings.
  const goal = await createGoal({ name: "Travel", targetAmount: 3000000, linkedWalletId: savings.id });
  await fundWallet(savings.id, 1200000);

  await archiveGoal(goal.id);

  // SOFT since migration 016: gone from every list the app reads, still on
  // file, and still readable by id so the restore list can name it.
  expect(await listGoals()).toEqual([]);
  expect((await getGoal(goal.id))?.archivedAt).toEqual(expect.any(Number));
  expect((await getWallet(savings.id))?.balance).toBe(1200000);
  const rows = await db.getAllAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM transactions WHERE wallet_id = ?",
    [savings.id],
  );
  expect(rows[0].n).toBe(1);
});

test("deleting a goal that is already gone is not an error", async () => {
  await expect(archiveGoal("no-such-goal")).resolves.toBeUndefined();
});

test("RESTORING A DELETED GOAL BRINGS IT BACK WHOLE", async () => {
  // The half that did not exist before migration 016. Rebuilding a goal by hand
  // restarts the pace the app quotes, because that is measured from created_at
  // — so the created date surviving is the point of the test, not a detail.
  const goal = await createGoal({
    name: "Travel",
    targetAmount: 3000000,
    targetDate: "2027-01-01",
    linkedWalletId: savings.id,
  });
  await archiveGoal(goal.id);

  await unarchiveGoal(goal.id);

  const restored = await getGoal(goal.id);
  expect(restored?.archivedAt).toBeNull();
  expect(restored?.createdAt).toBe(goal.createdAt);
  expect(restored?.targetDate).toBe("2027-01-01");
  expect((await listGoals()).map((row) => row.id)).toEqual([goal.id]);

  // Idempotent and silent on both misses, matching every other unarchive.
  await unarchiveGoal(goal.id);
  await expect(unarchiveGoal("no-such-goal")).resolves.toBeUndefined();
  expect((await getGoal(goal.id))?.archivedAt).toBeNull();
});

test("a restore is REFUSED when the wallet has been claimed since, by name", async () => {
  // Deleting frees the account, so the user may have started a new goal on it.
  // Only one live goal may hold a wallet — and the caller needs an error a
  // screen can turn into a sentence, not a raw partial-index violation.
  const first = await createGoal({ name: "First", targetAmount: 5000000, linkedWalletId: savings.id });
  await archiveGoal(first.id);
  await createGoal({ name: "Second", targetAmount: 100000, linkedWalletId: savings.id });

  await expect(unarchiveGoal(first.id)).rejects.toMatchObject({ walletId: savings.id });

  // And the refusal changed nothing: the deleted goal is still deleted.
  expect((await getGoal(first.id))?.archivedAt).toEqual(expect.any(Number));
});

test("a deleted goal does not count against the free cap", async () => {
  // `countGoals` feeds `canCreateGoal`. Counting goals the user has thrown away
  // would trip a gate they cannot get back under, since nothing is removed.
  const goal = await createGoal({ name: "Travel", targetAmount: 3000000, linkedWalletId: savings.id });
  expect(await countGoals()).toBe(1);

  await archiveGoal(goal.id);

  expect(await countGoals()).toBe(0);
});

test("the deleted list is opt-in and holds exactly what was deleted", async () => {
  const kept = await createGoal({ name: "Kept", targetAmount: 5000000, linkedWalletId: savings.id });
  const gone = await createGoal({
    name: "Gone",
    targetAmount: 100000,
    linkedWalletId: otherSavings.id,
  });
  await archiveGoal(gone.id);

  expect((await listGoals()).map((row) => row.id)).toEqual([kept.id]);
  expect((await listGoals({ includeArchived: true })).map((row) => row.id).sort()).toEqual(
    [kept.id, gone.id].sort(),
  );
});

// ---------------------------------------------------------------------------
// Complete — the spec's third lifecycle verb, which had no implementation at
// all until now ("card offers Complete, Raise target, or Keep as-is"). A
// reached goal could only be DELETED, so the live list filled with goals the
// user had already finished.
// ---------------------------------------------------------------------------
test("COMPLETING A REACHED GOAL RETIRES IT AND LEAVES THE SAVINGS ALONE", async () => {
  // Rule 3 holds for completing exactly as it does for deleting: the goal is a
  // lens over the account, and finishing the plan must not touch the money.
  const goal = await createGoal({
    name: "Travel",
    targetAmount: 3000000,
    linkedWalletId: savings.id,
  });
  await fundWallet(savings.id, 3000000);

  await completeGoal(goal.id);

  expect(await listGoals()).toEqual([]);
  expect((await getGoal(goal.id))?.archivedAt).toEqual(expect.any(Number));
  expect((await getWallet(savings.id))?.balance).toBe(3000000);
});

test("a completed goal is restorable, and frees its account meanwhile", async () => {
  // Completing is a retirement, not a destruction — the same contract deleting
  // has since migration 016, and the reason `completeGoal` reuses `archived_at`
  // rather than inventing a second lifecycle.
  const goal = await createGoal({
    name: "Travel",
    targetAmount: 3000000,
    targetDate: "2027-01-01",
    linkedWalletId: savings.id,
  });

  await completeGoal(goal.id);

  expect(await countGoals()).toBe(0);
  expect((await listGoals({ includeArchived: true })).map((row) => row.id)).toEqual([goal.id]);

  await unarchiveGoal(goal.id);
  const restored = await getGoal(goal.id);
  expect(restored?.archivedAt).toBeNull();
  expect(restored?.createdAt).toBe(goal.createdAt);
  expect(restored?.targetDate).toBe("2027-01-01");
});

test("completing is idempotent and never re-stamps a goal that is already retired", async () => {
  const goal = await createGoal({ name: "Travel", targetAmount: 3000000, linkedWalletId: savings.id });
  await completeGoal(goal.id, 1000);

  await completeGoal(goal.id, 2000);
  await archiveGoal(goal.id);

  expect((await getGoal(goal.id))?.archivedAt).toBe(1000);
  await expect(completeGoal("no-such-goal")).resolves.toBeUndefined();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fundWallet(walletId: string, amount: number): Promise<void> {
  await insertTransaction({
    walletId,
    categoryId: UNCATEGORIZED_ID,
    amount,
    direction: "in",
    occurredAt: Date.now(),
    source: "manual",
    confidence: 1,
  });
}

// ---------------------------------------------------------------------------
// Milestones (GAP-055, goals rule 12). The column is a high-water mark: the
// repository only ever raises it, and the pass in
// lib/goals/goal_milestone_subscriber.ts decides when.
// ---------------------------------------------------------------------------
test("a new goal starts at the milestone its wallet already meets, so old progress is never announced", async () => {
  await fundWallet(savings.id, 300000); // ₱3,000 of ₱5,000: 60%
  const goal = await createGoal({ name: "Phone", targetAmount: 500000, linkedWalletId: savings.id });

  expect(await listGoalMilestoneStates()).toEqual([
    { goalId: goal.id, goalName: "Phone", targetAmount: 500000, balance: 300000, milestoneReached: 50 },
  ]);
});

test("raiseGoalMilestone only ever raises, and says whether it did", async () => {
  const goal = await createGoal({ name: "Phone", targetAmount: 500000, linkedWalletId: savings.id });

  expect(await raiseGoalMilestone(goal.id, 50)).toBe(true);
  // A second pass racing the first loses, which is what stops a double post.
  expect(await raiseGoalMilestone(goal.id, 50)).toBe(false);
  expect(await raiseGoalMilestone(goal.id, 25)).toBe(false);

  const [state] = await listGoalMilestoneStates();
  expect(state.milestoneReached).toBe(50);
});

test("listGoalMilestoneStates leaves out deleted goals and goals whose wallet is archived", async () => {
  const live = await createGoal({ name: "Phone", targetAmount: 500000, linkedWalletId: savings.id });
  const deleted = await createGoal({ name: "Trip", targetAmount: 500000, linkedWalletId: otherSavings.id });
  await archiveGoal(deleted.id);
  // Rule 18: a goal on an archived wallet is paused, its progress frozen.
  await createGoal({ name: "Tuition", targetAmount: 500000, linkedWalletId: spending.id });
  await archiveWallet(spending.id);

  expect((await listGoalMilestoneStates()).map((state) => state.goalId)).toEqual([live.id]);
});
