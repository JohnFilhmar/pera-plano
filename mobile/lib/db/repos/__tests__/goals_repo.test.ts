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
import { createWallet, getWallet } from "@/lib/db/repos/wallets_repo";
import { freshDb } from "@/test_support/db";
import type { Wallet } from "@/types/domain";

import {
  countGoals,
  createGoal,
  deleteGoal,
  GoalNotFoundError,
  getGoal,
  listGoals,
  updateGoal,
  WalletAlreadyHasGoalError,
  WalletNotSavingsError,
} from "../goals_repo";

let db: SQLiteDatabase;
let savings: Wallet;
let otherSavings: Wallet;
let spending: Wallet;

beforeEach(async () => {
  db = await freshDb();
  await seedDefaultCategories();
  savings = await createWallet({ name: "GSave", type: "savings" });
  otherSavings = await createWallet({ name: "SeaBank", type: "savings" });
  spending = await createWallet({ name: "GCash", type: "e-wallet" });
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
test("A NON-SAVINGS WALLET IS REJECTED", async () => {
  // Invariant I10: "A Goal's linkedWalletId is a savings Wallet". Progress IS
  // the wallet's balance (spec rule 1), so a goal linked to a spending wallet
  // would report the user's grocery money as savings and celebrate a milestone
  // every time their salary landed.
  await expect(
    createGoal({ name: "Nope", targetAmount: 100000, linkedWalletId: spending.id }),
  ).rejects.toThrow(WalletNotSavingsError);

  expect(await countGoals()).toBe(0);
});

test("a wallet that does not exist is rejected too", async () => {
  await expect(
    createGoal({ name: "Nope", targetAmount: 100000, linkedWalletId: "no-such-wallet" }),
  ).rejects.toThrow(WalletNotSavingsError);
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
  await deleteGoal(first.id);

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

test("updateGoal rejects a move to a non-savings wallet", async () => {
  const goal = await createGoal({ name: "Travel", targetAmount: 3000000, linkedWalletId: savings.id });

  await expect(updateGoal(goal.id, { linkedWalletId: spending.id })).rejects.toThrow(
    WalletNotSavingsError,
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

  await deleteGoal(goal.id);

  expect(await getGoal(goal.id)).toBeNull();
  expect((await getWallet(savings.id))?.balance).toBe(1200000);
  const rows = await db.getAllAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM transactions WHERE wallet_id = ?",
    [savings.id],
  );
  expect(rows[0].n).toBe(1);
});

test("deleting a goal that is already gone is not an error", async () => {
  await expect(deleteGoal("no-such-goal")).resolves.toBeUndefined();
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
