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
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};

/**
 * Thrown when the wallet a goal is being linked to does not exist.
 *
 * REPLACES `WalletNotSavingsError`, WHICH ALSO REFUSED WALLETS OF THE WRONG
 * TYPE. That rule required the user to have told the app, during onboarding,
 * that a particular wallet was a "savings" one — a claim they had no way to
 * make accurately and no way to see the consequence of. With the type picker
 * gone the app would have had to INFER savings-ness and then block a goal on
 * its own guess, which is the worst version of the rule: a user whose account
 * the app failed to recognise would be told, with no explanation they could
 * act on, that they may not save toward anything in it.
 *
 * So the restriction is gone entirely. Any wallet can back a goal; the picker
 * still leads with the ones that look like savings, as a suggestion rather
 * than a wall.
 */
export class LinkedWalletNotFoundError extends Error {
  constructor(public readonly walletId: string) {
    super(`goal cannot be linked to a wallet that does not exist: ${walletId}`);
    this.name = "LinkedWalletNotFoundError";
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
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Throws unless `walletId` is a savings wallet with no goal other than `exceptGoalId`. */
async function assertWalletIsFree(walletId: string, exceptGoalId?: string): Promise<void> {
  const db = await getDatabase();

  const wallet = await db.getFirstAsync<{ id: string }>("SELECT id FROM wallets WHERE id = ?", [
    walletId,
  ]);
  // EXISTENCE ONLY. The wallet's kind is no longer this repository's business —
  // see `LinkedWalletNotFoundError` for why the savings requirement was dropped
  // rather than re-expressed against the inferred traits. The check stays
  // because `linked_wallet_id` is a foreign key: without it the caller gets a
  // raw SQLite constraint failure instead of an error a screen can act on.
  if (!wallet) throw new LinkedWalletNotFoundError(walletId);

  // `archived_at IS NULL` — a DELETED GOAL DOES NOT HOLD ITS WALLET. That was
  // already true when goals were hard-deleted (the row was gone), and migration
  // 016 keeps it true by replacing the column-level UNIQUE with a partial index
  // over live rows only. Without this clause a user who deleted a goal could
  // never start a new one on the same account, and nothing on screen would say
  // why — the goal blocking them is one they cannot see.
  const claimed = await db.getFirstAsync<{ id: string }>(
    "SELECT id FROM goals WHERE linked_wallet_id = ? AND archived_at IS NULL",
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
export async function listGoals(opts?: {
  includeAchieved?: boolean;
  includeArchived?: boolean;
}): Promise<Goal[]> {
  const db = await getDatabase();
  const includeAchieved = opts?.includeAchieved ?? true;

  // DELETED GOALS ARE OUT BY DEFAULT, unlike reached ones. A reached goal is
  // hidden from nobody — the spec gives it a celebration card with actions on
  // it — whereas a deleted goal is one the user has said they are done with,
  // and every screen that reads this list is showing the plan as it stands.
  // `includeArchived: true` is how the restore list gets at them.
  const archivedClause = opts?.includeArchived === true ? "" : " goals.archived_at IS NULL";

  const rows = await db.getAllAsync<GoalRow>(
    includeAchieved
      ? `SELECT goals.* FROM goals${archivedClause === "" ? "" : ` WHERE${archivedClause}`}
          ORDER BY goals.created_at`
      : `SELECT goals.* FROM goals
           JOIN wallets ON wallets.id = goals.linked_wallet_id
          WHERE wallets.balance < goals.target_amount${
            archivedClause === "" ? "" : ` AND${archivedClause}`
          }
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
 * Deletes a goal — SOFT, by stamping `archived_at` (migration 016). Idempotent.
 *
 * REPLACES A REAL `DELETE FROM goals`, finishing the rule 010 applied to loans
 * and limits ("soft-delete data, no hard delete") on the one Plan entity it
 * skipped. The exception goals used to have was a good argument about the wrong
 * noun: hard delete never touched the WALLET or a peso in it, which is true and
 * is not the loss. What a mistaken delete destroyed was the PLAN — target,
 * deadline, payday rule, and the created date the quoted pace is measured from.
 *
 * THE NAME. `archiveGoal`, not `deleteGoal`, because the mechanism is the
 * archive its three siblings already use and the column is `archived_at`. The
 * BUTTON says "Delete goal": that is the word a user reaches for, and every
 * Plan entity is restorable, so the app says delete and means archive
 * everywhere rather than teaching two words for one idea.
 *
 * STILL NEVER TOUCHES THE WALLET OR ITS TRANSACTIONS (rule 3), and still frees
 * the account for a new goal — `assertWalletIsFree` and migration 016's partial
 * unique index both scope the one-goal-per-wallet rule to LIVE rows, so this
 * keeps the one thing the old hard delete genuinely got right.
 */
export async function archiveGoal(id: string): Promise<void> {
  const db = await getDatabase();
  const now = Date.now();
  await db.runAsync(
    "UPDATE goals SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
    [now, now, id],
  );
}

/**
 * Retires a goal the user has FINISHED with — the spec's "Complete", which the
 * states table offers on the Reached card and, as "Complete anyway", on the
 * Past due one (docs/04-features/05-goals-savings.md §States, §complete or edit
 * flow step 3). `goal_card.tsx` has promised this in copy since it shipped
 * ("Move the date, lower the target, or complete it anyway") with nothing
 * behind it, so a reached goal sat in the live list until the user deleted it.
 *
 * IT IS THE SAME WRITE `archiveGoal` MAKES, and that is the honest state of the
 * schema rather than a shortcut: `goals` has ONE retirement column,
 * `archived_at` (migration 016), and no `completed_at`. Completing and deleting
 * therefore land a goal in exactly the same place — out of the live list,
 * restorable, wallet and transactions untouched (rule 3) — and the difference
 * between them is not recorded. Adding a column is out of scope here and
 * belongs with GAP-055, which owns the goal schema; until it lands, an archived
 * goal reads as completed only where the app can DERIVE it, which is the
 * balance-versus-target test rule 10 already calls Reached.
 *
 * It exists as its own name anyway, rather than the screen calling
 * `archiveGoal`, because the two are different requests from the user and only
 * one place then has to change when the column arrives.
 *
 * Idempotent on an unknown or already-retired id, like every archive here.
 */
export async function completeGoal(id: string, now: number = Date.now()): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE goals SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL",
    [now, now, id],
  );
}

/**
 * Restores a deleted goal. The exact inverse of `archiveGoal`.
 *
 * THE WALLET IS THE ONE THING THIS CAN FAIL ON. Deleting a goal frees its
 * account, so the user may well have started a NEW goal on that wallet since —
 * and migration 016's partial unique index would reject a second live goal
 * against it with a raw SQLite constraint error. `assertWalletIsFree` runs
 * first so the caller gets `WalletAlreadyHasGoalError`, which a screen can turn
 * into a sentence, instead.
 *
 * IDEMPOTENT AND SILENT on an unknown or already-live id, matching every other
 * unarchive in this codebase: a caller retrying is asking for a state that
 * already holds.
 */
export async function unarchiveGoal(id: string): Promise<void> {
  const goal = await getGoal(id);
  if (goal === null || goal.archivedAt === null) return;

  await assertWalletIsFree(goal.linkedWalletId, id);

  const db = await getDatabase();
  await db.runAsync(
    "UPDATE goals SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at IS NOT NULL",
    [Date.now(), id],
  );
}

/**
 * Feeds `canCreateGoal` at the call site (m2 Global Constraint 10).
 *
 * LIVE GOALS ONLY. Counting deleted ones would let a user hit the Free cap with
 * goals they had already thrown away and leave no way back under it, since
 * nothing is removed any more — the same reasoning `countLoans` records.
 */
export async function countGoals(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM goals WHERE archived_at IS NULL",
  );
  return row?.n ?? 0;
}
