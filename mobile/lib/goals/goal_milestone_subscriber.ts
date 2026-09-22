// lib/goals/goal_milestone_subscriber.ts: goals rule 12's notifications
// (GAP-055): "Milestone notifications fire when progress first crosses 25%,
// 50%, 75%, and 100%. Each milestone fires at most once per goal lifetime."
//
// WHAT A PASS DOES. For every live goal it compares the milestone the linked
// wallet's balance meets now (`milestoneFor`) with the highest one ever recorded
// (`goals.milestone_reached`, migration 022). Only a rise is news, and when one
// change reaches several milestones only the highest is announced, the rule
// Limits already follow (docs/06 §6.2 rule 2). The mark is raised BEFORE the
// post, so a pass racing this one posts nothing, and a crash between the two
// loses one notification rather than sending it twice.
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

import { milestoneFor } from "./goal_math";

/** The window limit_ledger_subscriber.ts uses: long enough to swallow a drained burst. */
const DEFAULT_DEBOUNCE_MS = 750;

/**
 * One milestone pass over every live goal: raises each mark a balance has
 * passed, and posts one Goal update for each goal whose mark rose.
 *
 * Swallows its own failures; see the file header.
 */
export async function runGoalMilestonePass(): Promise<void> {
  try {
    for (const goal of await listGoalMilestoneStates()) {
      const reached = milestoneFor(goal.balance, goal.targetAmount);
      if (reached === 0 || reached <= goal.milestoneReached) continue;
      if (!(await raiseGoalMilestone(goal.goalId, reached))) continue;

      await postAlert({
        channel: CHANNEL_GOALS,
        copy: goalMilestoneAlertCopy({
          goalName: goal.goalName,
          milestone: reached,
          saved: goal.balance,
          target: goal.targetAmount,
        }),
        // `kind` is the discriminant lib/alerts/alert_routes.ts switches on.
        data: { kind: "goalMilestone", goalId: goal.goalId, milestone: reached },
      });
    }
  } catch (error) {
    console.warn("the goal milestone check failed; the app runs without it", error);
  }
}

/**
 * Runs a milestone pass at launch and after every debounced ledger commit.
 *
 * @param options.debounceMs - The trailing-edge window. Tests shorten it.
 * @returns The teardown, which also cancels a pass still waiting to fire.
 */
export function startGoalMilestoneSubscriber(options: { debounceMs?: number } = {}): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let pending: ReturnType<typeof setTimeout> | null = null;

  void runGoalMilestonePass();

  const unsubscribe = onAppEvent("ledger:committed", () => {
    // Restarting the timer is what makes this trailing-edge: a drained burst of
    // fifty commits schedules one pass, and that pass sees all fifty.
    if (pending !== null) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      void runGoalMilestonePass();
    }, debounceMs);
  });

  return () => {
    if (pending !== null) {
      clearTimeout(pending);
      pending = null;
    }
    unsubscribe();
  };
}
