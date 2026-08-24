// lib/db/repos/goals_repo.ts — the only SQL surface for the Goal aggregate
// (interface contract §3; m2b Task 1). Same house shape as wallets_repo.ts.
//
// THE COLUMN IS `contribution_rule_json`. The m2b plan's own schema note calls
// it `contribution_rule`; 001_core.sql says otherwise, and the difference fails
// at runtime rather than at compile time.
//
// INVARIANT I10 IS HALF IN THE SCHEMA ALREADY. `linked_wallet_id TEXT NOT NULL
// UNIQUE REFERENCES wallets(id)` enforces "a savings Wallet backs at most one
// Goal" without any help — so this file's job is not to re-enforce it in
// JavaScript but to turn it into an error a SCREEN can act on. "UNIQUE
// constraint failed: goals.linked_wallet_id" cannot tell the user which wallet
// is taken; `WalletAlreadyHasGoalError.walletId` can.
//
// The other half — "a Goal's linkedWalletId is a savings Wallet" — has no
// column to enforce it, so it is checked here on every write.
import { getDatabase } from "@/lib/db/database";
import { newId } from "@/lib/ids";
import type { ContributionRule, Goal } from "@/types/domain";

export type NewGoal = {
  name: string;
  targetAmount: number;
  /** `'YYYY-MM-DD'` or null — a goal with no deadline is valid (rule 4). */
  targetDate?: string | null;
  linkedWalletId: string;
  /**
   * `null` means no rule, matching `Goal.contributionRule`. The m2b plan adds a
   * third `{ kind: "none" }` variant; types/domain.ts has two and uses `null`
   * for absence, and two ways to say "no rule" is how one of them stops being
   * handled somewhere downstream.
   */
  contributionRule?: ContributionRule | null;
};

type GoalRow = {
  id: string;
  name: string;
  target_amount: number;
  target_date: string | null;
  linked_wallet_id: string;
  contribution_rule_json: string | null;
  created_at: number;
  updated_at: number;
};

/** Thrown when the linked wallet is missing, or is not of type `savings` (I10). */
export class WalletNotSavingsError extends Error {
  constructor(public readonly walletId: string) {
    super(`goal must be linked to a savings wallet: ${walletId}`);
    this.name = "WalletNotSavingsError";
  }
}

/** Thrown when a wallet already backs a goal (I10). Carries the wallet id. */
export class WalletAlreadyHasGoalError extends Error {
  constructor(public readonly walletId: string) {
    super(`wallet already backs a goal: ${walletId}`);
    this.name = "WalletAlreadyHasGoalError";
  }
}

export class GoalNotFoundError extends Error {
  constructor(public readonly goalId: string) {
    super(`goal not found: ${goalId}`);
    this.name = "GoalNotFoundError";
  }
}

function rowToGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.target_amount,
    targetDate: row.target_date,
    linkedWalletId: row.linked_wallet_id,
    contributionRule:
      row.contribution_rule_json === null
        ? null
        : (JSON.parse(row.contribution_rule_json) as ContributionRule),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Throws unless `walletId` is a savings wallet with no goal other than `exceptGoalId`. */
async function assertWalletIsFree(walletId: string, exceptGoalId?: string): Promise<void> {
  const db = await getDatabase();

  const wallet = await db.getFirstAsync<{ type: string }>(
    "SELECT type FROM wallets WHERE id = ?",
    [walletId],
  );
  // A missing wallet and a wrong-typed one get the SAME error on purpose: from
  // the caller's side both mean "you cannot link this", and a separate
  // not-found error would only be actionable by a screen that already knew the
  // wallet existed.
  if (!wallet || wallet.type !== "savings") throw new WalletNotSavingsError(walletId);

  const claimed = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM goals WHERE linked_wallet_id = ?",
    [walletId],
  );
  if (claimed && claimed.id !== exceptGoalId) throw new WalletAlreadyHasGoalError(walletId);
}

export async function createGoal(input: NewGoal): Promise<Goal> {
  await assertWalletIsFree(input.linkedWalletId);

  const db = await getDatabase();
  const now = Date.now();
  const id = newId();

  await db.runAsync(
    `INSERT INTO goals (id, name, target_amount, target_date, linked_wallet_id,
       contribution_rule_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.targetAmount,
      input.targetDate ?? null,
      input.linkedWalletId,
      input.contributionRule ? JSON.stringify(input.contributionRule) : null,
      now,
      now,
    ],
  );

  const created = await getGoal(id);
  if (created === null) throw new GoalNotFoundError(id);
  return created;
}

export async function getGoal(id: string): Promise<Goal | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<GoalRow>("SELECT * FROM goals WHERE id = ?", [id]);
  return row ? rowToGoal(row) : null;
}

/**
 * Every goal, oldest first.
 *
 * REACHED GOALS ARE INCLUDED BY DEFAULT, which inverts the m2b plan's stated
 * default. The spec's states table gives Reached its own card — "Celebration
 * state; card offers Complete, Raise target, or Keep as-is" — and those actions
 * cannot be offered on a hidden card. There is no `completed` column for the
 * user to reach afterwards either, so a hidden reached goal would simply
 * vanish. `includeAchieved: false` is still available for callers that want
 * only live goals.
 *
 * "Reached" is `balance >= target_amount` (spec rule 10), computed by joining
 * the linked wallet — progress IS that balance (rule 1), so there is nothing
 * else it could be derived from.
 */
export async function listGoals(opts?: { includeAchieved?: boolean }): Promise<Goal[]> {
  const db = await getDatabase();
  const includeAchieved = opts?.includeAchieved ?? true;

  const rows = await db.getAllAsync<GoalRow>(
    includeAchieved
      ? "SELECT * FROM goals ORDER BY created_at"
      : `SELECT goals.* FROM goals
           JOIN wallets ON wallets.id = goals.linked_wallet_id
          WHERE wallets.balance < goals.target_amount
          ORDER BY goals.created_at`,
  );
  return rows.map(rowToGoal);
}

/**
 * Patches a goal. `targetDate` and `contributionRule` are checked with
 * `!== undefined` rather than `??`, so an explicit `null` CLEARS them — "move
 * the date" and "turn the rule off" both have to be expressible, and with `??`
 * clearing and not-mentioning would be the same request.
 */
export async function updateGoal(id: string, patch: Partial<NewGoal>): Promise<Goal> {
  const current = await getGoal(id);
  if (current === null) throw new GoalNotFoundError(id);

  const linkedWalletId = patch.linkedWalletId ?? current.linkedWalletId;
  if (linkedWalletId !== current.linkedWalletId) {
    // `exceptGoalId` so re-saving a goal onto its OWN wallet is not read as a
    // collision with itself.
    await assertWalletIsFree(linkedWalletId, id);
  }

  const merged = {
    name: patch.name ?? current.name,
    targetAmount: patch.targetAmount ?? current.targetAmount,
    targetDate: patch.targetDate !== undefined ? patch.targetDate : current.targetDate,
    linkedWalletId,
    contributionRule:
      patch.contributionRule !== undefined ? patch.contributionRule : current.contributionRule,
  };

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE goals
        SET name = ?, target_amount = ?, target_date = ?, linked_wallet_id = ?,
            contribution_rule_json = ?, updated_at = ?
      WHERE id = ?`,
    [
      merged.name,
      merged.targetAmount,
      merged.targetDate,
      merged.linkedWalletId,
      merged.contributionRule ? JSON.stringify(merged.contributionRule) : null,
      Date.now(),
      id,
    ],
  );

  const updated = await getGoal(id);
  if (updated === null) throw new GoalNotFoundError(id);
  return updated;
}

/**
 * Deletes a goal. Idempotent.
 *
 * NEVER TOUCHES THE WALLET OR ITS TRANSACTIONS (rule 3). The money is real; the
 * goal is a lens over it. A delete that took the savings with it would turn
 * abandoning a plan into losing the plan's savings — and it also frees the
 * wallet, so the user can start a fresh goal on the same account.
 */
export async function deleteGoal(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM goals WHERE id = ?", [id]);
}

/** Feeds `canCreateGoal` at the call site (m2 Global Constraint 10). */
export async function countGoals(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM goals");
  return row?.n ?? 0;
}
