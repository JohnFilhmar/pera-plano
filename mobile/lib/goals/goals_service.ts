// lib/goals/goals_service.ts — goals against the ledger, and the payday
// allocation prompt (m2b Task 3; docs/04-features/05-goals-savings.md).
//
// ---------------------------------------------------------------------------
// THE APP DOES NOT MOVE MONEY
// ---------------------------------------------------------------------------
// Rule 1, and the reason this module is split the way it is:
// `proposePaydayAllocations` WRITES NOTHING. It returns what the user might
// choose to do; `applyAllocations` records what they say they did, after they
// have moved it in their banking app (spec's payday flow, step 3). A service
// that quietly wrote the transfers would put transactions in the ledger the
// user never made — and a ledger that invents entries is worse than no ledger,
// because everything else in the app is derived from it.
//
// The two halves are separately testable for exactly that reason: several tests
// assert that after proposing, the transaction table is still empty.
import { getDatabase } from "@/lib/db/database";
import { UNCATEGORIZED_ID } from "@/lib/db/repos/categories_repo";
import {
  decideContribution,
  listContributionDecisions,
} from "@/lib/db/repos/contribution_decisions_repo";
import { listGoals } from "@/lib/db/repos/goals_repo";
import { insertTransaction } from "@/lib/db/repos/transactions_repo";
import { linkTransfer } from "@/lib/db/repos/transfer_links_repo";
import { withUnitOfWork } from "@/lib/db/unit_of_work";
import { toDateIso } from "@/lib/dates";
import { hasPaydayAutoAllocation } from "@/lib/entitlements";
import type { AppEventMap } from "@/lib/events/app_events";
import type { Centavos, Goal, IsoDate } from "@/types/domain";

import { computeGoalProgress, type GoalPaceInputs, type GoalProgress } from "./goal_math";
import { plannedAmountFor } from "./planned_contributions";

/** The payday the income service published (`income:payday`). */
export type PaydayEvent = AppEventMap["income:payday"];

export type GoalStatus = { goal: Goal; progress: GoalProgress };

export type AllocationProposal = {
  goalId: string;
  goalName: string;
  /** What to actually move — already capped. */
  amount: Centavos;
  /**
   * What the rule ASKED for before capping. Not in the m2b plan's type, and
   * rule 3 needs it: it says to cap "in goal-priority order (nearest deadline
   * first) and MARK THE SHORTFALL". `amount < requested` is that mark, and it
   * is what lets the sheet say "₱3,000 of the ₱6,000 you planned".
   */
  requested: Centavos;
  fromWalletId: string;
  toWalletId: string;
  /**
   * The local day the pay landed: with `goalId`, the key a recording or a
   * skip is filed under (GAP-056, goals rule 14).
   */
  paydayDate: IsoDate;
};

/**
 * Every goal with its progress. Pace inputs are optional here for the same
 * reason they are in `goal_math`: a caller with no income context still gets
 * real progress, just no pace verdict worth showing.
 */
export async function listGoalStatuses(
  now: number,
  paceInputs?: (goal: Goal) => GoalPaceInputs,
): Promise<GoalStatus[]> {
  const db = await getDatabase();
  const goals = await listGoals();

  const statuses: GoalStatus[] = [];
  for (const goal of goals) {
    // Progress IS the linked wallet's balance (spec rule 1) — read straight
    // from the row, never summed from tagged contributions, so the figure
    // always matches what the bank says.
    const wallet = await db.getFirstAsync<{ balance: number }>(
      "SELECT balance FROM wallets WHERE id = ?",
      [goal.linkedWalletId],
    );
    statuses.push({
      goal,
      progress: computeGoalProgress(goal, wallet?.balance ?? 0, now, paceInputs?.(goal)),
    });
  }
  return statuses;
}

/** Nearest deadline first; goals with no deadline last (rule 3's priority order). */
function byDeadline(a: GoalStatus, b: GoalStatus): number {
  if (a.goal.targetDate === null && b.goal.targetDate === null) return 0;
  // An undated goal is never urgent — it has no date to miss.
  if (a.goal.targetDate === null) return 1;
  if (b.goal.targetDate === null) return -1;
  return a.goal.targetDate.localeCompare(b.goal.targetDate);
}

/**
 * What the user might move into their goals out of this payday. WRITES NOTHING.
 *
 * Gated on `hasPaydayAutoAllocation` (rule 5). On the free tier the
 * `contributionRule` is RETAINED and only the prompt disappears — docs/05 §3.2
 * says so outright, and gate principle 1 requires it: a cap blocks an action,
 * it never deletes what the user configured.
 */
export async function proposePaydayAllocations(
  event: PaydayEvent,
  now: number,
): Promise<AllocationProposal[]> {
  if (!hasPaydayAutoAllocation()) return [];

  const statuses = (await listGoalStatuses(now)).sort(byDeadline);
  const paydayDate = toDateIso(new Date(event.occurredAt));

  let budget = event.amount;
  const proposals: AllocationProposal[] = [];

  for (const { goal, progress } of statuses) {
    if (goal.contributionRule === null) continue;
    // A met target does not want more money — the spec's Reached card offers
    // Complete, Raise target or Keep as-is, none of which is "keep allocating".
    if (progress.remaining <= 0) continue;

    const requested = plannedAmountFor(goal, event.amount);
    if (requested <= 0) continue;

    // Two ceilings: what the goal still needs, and what is left of the payday.
    // Rule 3's cap is the second; the first stops an allocation overshooting a
    // target the user is nearly at.
    const amount = Math.min(requested, progress.remaining, budget);
    if (amount <= 0) continue;

    proposals.push({
      goalId: goal.id,
      goalName: goal.name,
      amount,
      requested,
      fromWalletId: event.walletId,
      toWalletId: goal.linkedWalletId,
      paydayDate,
    });
    budget -= amount;
  }

  return proposals;
}

/**
 * Records the moves the user says they made. Returns the created transfer-link
 * ids, in the order the proposals were given.
 *
 * A RETRY NEVER RECORDS A MOVE TWICE. The sheet stays open after a failed
 * confirm so the user can retry with the same proposals, and any of them already
 * recorded for its payday (an earlier proposal of the same confirm that
 * committed before a later one threw) is passed over and contributes no id.
 *
 * COMMITS ITS ARGUMENT, never a freshly re-derived list. The allocation sheet
 * lets the user uncheck rows and edit amounts (Task 4 rule 6); re-deriving here
 * would silently commit the proposals they declined.
 *
 * ONE TRANSACTION PER PROPOSAL (rule 6): both legs, the link and the
 * recorded decision, or nothing. A half-applied allocation shows money leaving
 * the payroll wallet and never arriving, which is the single worst thing a
 * ledger can say.
 *
 * THE DECISION IS WHAT KEEPS A LATE RECORDING COMPLETE (GAP-056, goals rule
 * 14b). The in-leg alone would complete the payday's contribution only inside
 * rule 14a's three days, so a recording made later would read as never made.
 */
export async function applyAllocations(
  proposals: AllocationProposal[],
  now: number,
): Promise<string[]> {
  const linkIds: string[] = [];
  const recorded = await recordedContributions(proposals);

  for (const proposal of proposals) {
    if (recorded.has(`${proposal.goalId}|${proposal.paydayDate}`)) continue;
    const linkId = await withUnitOfWork(async () => {
      const out = await insertTransaction({
        walletId: proposal.fromWalletId,
        categoryId: UNCATEGORIZED_ID,
        amount: proposal.amount,
        direction: "out",
        occurredAt: now,
        merchant: proposal.goalName,
        note: `Saved toward ${proposal.goalName}`,
        source: "manual",
        confidence: 1,
      });
      const inLeg = await insertTransaction({
        walletId: proposal.toWalletId,
        categoryId: UNCATEGORIZED_ID,
        amount: proposal.amount,
        direction: "in",
        occurredAt: now,
        merchant: proposal.goalName,
        note: `Saved toward ${proposal.goalName}`,
        source: "manual",
        confidence: 1,
      });

      // `feeAmount: 0` — moving your own money between your own accounts has no
      // fee to record here. `detectedBy: "manual"` because the USER made this
      // move; the app is recording it, not detecting it.
      const link = await linkTransfer(out.id, inLeg.id, 0, { detectedBy: "manual" });
      await decideContribution({
        goalId: proposal.goalId,
        paydayDate: proposal.paydayDate,
        decision: "recorded",
        now,
      });
      return link.id;
    });

    linkIds.push(linkId);
  }

  return linkIds;
}

/** Goal-and-payday keys among `proposals` whose contribution is already recorded. */
async function recordedContributions(proposals: AllocationProposal[]): Promise<Set<string>> {
  if (proposals.length === 0) return new Set();
  const dates = proposals.map((proposal) => proposal.paydayDate).sort();
  const rows = await listContributionDecisions(dates[0], dates[dates.length - 1]);
  return new Set(
    rows
      .filter((row) => row.decision === "recorded")
      .map((row) => `${row.goalId}|${row.paydayDate}`),
  );
}

/**
 * Records that the user skipped these goals' contributions for this payday
 * (GAP-056, goals rule 14c): "this payday only; the rule stays active".
 *
 * WRITES NO TRANSACTION. Skipping is a decision about money that stays where
 * it is; Safe-to-Spend then releases whatever of the plan never moved (goals
 * rule 15).
 *
 * @param skipped - Each goal and the payday it skips. A proposal fits as it is.
 * @param now - When the user decided.
 */
export async function skipAllocations(
  skipped: ReadonlyArray<{ goalId: string; paydayDate: IsoDate }>,
  now: number,
): Promise<void> {
  for (const { goalId, paydayDate } of skipped) {
    await decideContribution({ goalId, paydayDate, decision: "skipped", now });
  }
}
