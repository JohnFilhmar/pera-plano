// lib/goals/goal_milestone_subscriber.ts: goals rule 12's notifications
// (GAP-055): "Milestone notifications fire when progress first crosses 25%,
// 50%, 75%, and 100%. Each milestone fires at most once per goal lifetime."
//
// WHAT A PASS DOES. For every live goal it asks which milestones the linked
// wallet's balance has passed that the goal has not announced yet
// (`milestonesCrossed` against `goals.milestone_reached`, migration 022). EACH of
// them is announced, lowest first, which is the owner's ruling of 2026-09-24 and
// the opposite of Limits, where only the highest crossed fires (docs/06 §6.2 rule
// 2). Four alerts at once is exactly what §6.2 rule 6 collapses into one summary,
// and that is alerts_service.ts's decision, not this pass's. The mark is raised
// to the top of the run BEFORE any post, so a pass racing this one posts nothing,
// and a crash between the two loses notifications rather than repeating them.
//
// A GOAL STARTS AT A LEVEL RATHER THAN AT ZERO. Created on, or moved onto, a
// wallet that already sits past a milestone, it announces the level it starts at
// and nothing under it. goals_repo.ts seeds the mark one rung below that level,
// and the creating mutation runs a pass so the announcement is immediate.
//
// NOTHING RE-FIRES A MILESTONE. The mark never falls: not on a withdrawal (rule
// 12), a raised target (rule 20) or a downward reconciliation (rule 21). An
// upward reconciliation that crosses a milestone for the first time does
// announce it. The entry that asked for this said it should not; the spec's own
// acceptance criteria require a goal on a manual wallet to "behave identically
// to tracked ones given the same balance history".
//
// TWO WAKE-UPS, THE SHAPE lib/wallets/reconcile_scheduler.ts USES: a pass at
// launch and a debounced pass after every ingest commit, which is the flow the
// spec names ("contribution via Ingest"). ponytail: a manual deposit or a
// reconciliation is announced at the next commit or launch rather than at once,
// because `ledger:changed` has no producer yet. Subscribe to it when one exists.
//
// NOTHING HERE MAY BREAK THE APP. A milestone is a celebration; a failure is
// logged and swallowed, like every other pass the root layout starts.
import { goalMilestoneAlertCopy } from "@/lib/alerts/alert_copy";
import { postAlert } from "@/lib/alerts/alerts_service";
import { CHANNEL_GOALS } from "@/lib/alerts/channels";
import { listGoalMilestoneStates, raiseGoalMilestone } from "@/lib/db/repos/goals_repo";
import { onAppEvent } from "@/lib/events/app_events";

import { milestonesCrossed } from "./goal_math";

/** The window limit_ledger_subscriber.ts uses: long enough to swallow a drained burst. */
const DEFAULT_DEBOUNCE_MS = 750;

/**
 * One milestone pass over every live goal: raises each mark a balance has
 * passed, and posts a Goal update for every milestone that rise crossed.
 *
 * Swallows its own failures; see the file header.
 */
export async function runGoalMilestonePass(): Promise<void> {
  try {
    for (const goal of await listGoalMilestoneStates()) {
      const crossed = milestonesCrossed(goal.milestoneReached, goal.balance, goal.targetAmount);
      const highest = crossed[crossed.length - 1];
      if (highest === undefined) continue;
      // RAISED ONCE, TO THE TOP OF THE RUN, BEFORE ANY POST. A pass racing this
      // one then finds nothing owed and posts nothing, so the guard still holds
      // with several alerts per goal rather than one.
      if (!(await raiseGoalMilestone(goal.goalId, highest))) continue;

      for (const milestone of crossed) {
        await postAlert({
          channel: CHANNEL_GOALS,
          copy: goalMilestoneAlertCopy({
            goalName: goal.goalName,
            milestone,
            saved: goal.balance,
            target: goal.targetAmount,
          }),
          // `kind` is the discriminant lib/alerts/alert_routes.ts switches on.
          data: { kind: "goalMilestone", goalId: goal.goalId, milestone },
        });
      }
    }
  } catch (error) {
    console.warn("the goal milestone check failed; the app runs without it", error);
  }
}

/**
 * Runs a milestone pass at launch, after every debounced ledger commit, and
 * after a goal is created or edited.
 *
 * @param options.debounceMs - The trailing-edge window. Tests shorten it.
 * @returns The teardown, which also cancels a pass still waiting to fire.
 */
export function startGoalMilestoneSubscriber(options: { debounceMs?: number } = {}): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let pending: ReturnType<typeof setTimeout> | null = null;

  void runGoalMilestonePass();

  const schedule = (): void => {
    // Restarting the timer is what makes this trailing-edge: a drained burst of
    // fifty commits schedules one pass, and that pass sees all fifty.
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      void runGoalMilestonePass();
    }, debounceMs);
  };

  const unsubscribes = [
    onAppEvent("ledger:committed", schedule),
    // A goal created on, or moved onto, a wallet already past a milestone
    // announces the level it starts at, and a commit is not what happened.
    // Shares the debounce, so saving an edit twice still runs one pass.
    onAppEvent("goals:changed", schedule),
  ];

  return () => {
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
