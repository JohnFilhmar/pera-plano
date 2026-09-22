// lib/db/repos/contribution_decisions_repo.ts: what the user decided about
// one payday's planned goal contribution (GAP-056, goals rule 14): that they
// made it, or that they skipped it. Every other state a contribution can be in
// is derived from the ledger, in lib/goals/planned_contributions.ts.
import { getDatabase } from "@/lib/db/database";
import type { EpochMs, IsoDate } from "@/types/domain";

/** The two outcomes only the user can state (goals rule 14 b and c). */
export type ContributionDecision = "recorded" | "skipped";

export type ContributionDecisionRow = {
  goalId: string;
  paydayDate: IsoDate;
  decision: ContributionDecision;
};

/**
 * Records the user's decision about one goal's contribution from one payday.
 *
 * A RECORDING REPLACES A SKIP; NOTHING REPLACES A RECORDING. A recording means
 * money moved, which no later tap can take back, while a skip followed by a
 * recording means the user moved it after all. So a second skip, or a skip
 * after a recording, changes nothing.
 *
 * @param input.goalId - The goal the contribution was planned for.
 * @param input.paydayDate - The local day the pay landed (lib/income/paydays.ts).
 * @param input.decision - What the user said.
 * @param input.now - When they said it.
 */
export async function decideContribution(input: {
  goalId: string;
  paydayDate: IsoDate;
  decision: ContributionDecision;
  now: EpochMs;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO contribution_decisions (goal_id, payday_date, decision, decided_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (goal_id, payday_date) DO UPDATE
       SET decision = excluded.decision, decided_at = excluded.decided_at
       WHERE excluded.decision = 'recorded' AND contribution_decisions.decision = 'skipped'`,
    [input.goalId, input.paydayDate, input.decision, input.now],
  );
}

/**
 * Every decision about a payday between two local days, both inclusive.
 *
 * @param from - The first payday to include.
 * @param to - The last payday to include.
 * @returns Oldest payday first.
 */
export async function listContributionDecisions(
  from: IsoDate,
  to: IsoDate,
): Promise<ContributionDecisionRow[]> {
  const db = await getDatabase();
  // `decision` is typed as the union because the table's CHECK admits no other value.
  const rows = await db.getAllAsync<{
    goal_id: string;
    payday_date: string;
    decision: ContributionDecision;
  }>(
    `SELECT goal_id, payday_date, decision FROM contribution_decisions
     WHERE payday_date >= ? AND payday_date <= ?
     ORDER BY payday_date, goal_id`,
    [from, to],
  );
  return rows.map((row) => ({
    goalId: row.goal_id,
    paydayDate: row.payday_date,
    decision: row.decision,
  }));
}
