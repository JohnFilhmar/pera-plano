// components/plan/goals_panel.tsx — the Goals list (m2b Task 4;
// docs/04-features/05-goals-savings.md).
//
// A PANEL, NOT A SCREEN. `app/(tabs)/plan/goals.tsx` still exists and still
// renders this panel as a full screen: Plan's segmented control (a follow-up
// task) will swap panels in place without navigating, but `/plan/goals`
// stays a real, routable stack screen — `goals/[id].tsx` pushes onto it and
// pops back with `router.back()`. Deleting the route would turn "tap a goal
// -> goal detail -> system back" into a dead end (revamp spec R4).
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { GoalCard } from "@/components/goals/goal_card";
import { ArchivedSection } from "@/components/plan/archived_section";
import { formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useUnarchiveGoal } from "@/hooks/mutations/use_unarchive_goal";
import { useArchivedGoals } from "@/hooks/queries/use_archived_plan_items";
import { useGoals } from "@/hooks/queries/use_goals";
import { WalletAlreadyHasGoalError } from "@/lib/db/repos/goals_repo";
import { canCreateGoal } from "@/lib/entitlements";
import type { GoalStatus } from "@/lib/goals/goals_service";

/**
 * TalkBack has nothing to read off a bare row (F5) — this states what
 * `GoalCard` beside it draws: the goal's name and its saved-versus-target
 * figures, in the same "N% · saved of target" shape the card's own text
 * nodes use. Reached goals skip the percentage the same way the card does
 * (its ring has already hit 100 — restating it teaches nothing a plain
 * "reached" does not).
 */
function goalRowAccessibilityLabel(status: GoalStatus): string {
  const { goal, progress } = status;
  const saved = formatCentavos(progress.saved);
  const target = formatCentavos(progress.target);
  if (progress.pace === "reached") return `${goal.name} goal, reached, ${saved} of ${target} saved`;

  const percent = Math.round(progress.fraction * 100);
  return `${goal.name} goal, ${percent}% saved, ${saved} of ${target} saved`;
}

export function GoalsPanel() {
  const router = useRouter();
  const { data: statuses } = useGoals();

  const onAdd = () => {
    const count = statuses?.length ?? 0;
    router.push(canCreateGoal(count) ? "/plan/goals/new" : "/plan/goals/new?gated=1");
  };

  // Closed by default and the query is gated on it (see `ArchivedQueryOptions`).
  // The state lives here rather than in `ArchivedSection` because it also has
  // to reach the hook.
  const [showDeleted, setShowDeleted] = useState(false);
  const { data: deleted } = useArchivedGoals({ enabled: showDeleted });
  const restore = useUnarchiveGoal();

  // THE ONE RESTORE IN THE APP THAT CAN BE REFUSED. Deleting a goal frees its
  // savings account, so the wallet may have been claimed by a new goal since —
  // and only one live goal may hold a wallet. Naming the error rather than
  // showing "something went wrong" is what makes the fix (delete or re-point
  // the newer goal) findable.
  const restoreError =
    restore.error instanceof WalletAlreadyHasGoalError
      ? "That goal's savings account already has another goal on it. Delete or move that one first."
      : restore.error !== null
        ? "That goal could not be restored."
        : null;

  const deletedSection = (
    <ArchivedSection
      testID="goals-archived"
      noun="goals"
      open={showDeleted}
      onToggle={() => setShowDeleted((shown) => !shown)}
      items={deleted?.map((goal) => ({
        id: goal.id,
        name: goal.name,
        detail: `Target ${formatCentavos(goal.targetAmount)}`,
      }))}
      restoringId={restore.isPending ? (restore.variables ?? null) : null}
      error={restoreError}
      onRestore={(id) => restore.mutate(id)}
    />
  );

  // Render nothing until the list has loaded. An empty state that flashes on
  // every cold start reads as data loss — the rule the Wallets tab set.
  if (statuses === undefined) {
    return (
      <View testID="goals-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={5} />
      </View>
    );
  }

  if (statuses.length === 0) {
    return (
      // The deleted toggle is in this branch too, and it matters most here: a
      // user who deleted their only goal lands on an empty state that otherwise
      // reads as "the goal is gone for good" rather than "it is recoverable".
      <View className="flex-1 justify-center gap-4 bg-bg px-4 dark:bg-bg-dark">
        {/* Rule 7's copy. */}
        <EmptyState
          testID="goals-empty"
          title="No goals yet"
          body="Name something you are saving for and PeraPlano will track it against a savings account."
          action={{ label: "Create a goal", onPress: onAdd }}
        />
        {deletedSection}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView contentContainerClassName="gap-3 p-4">
        {statuses.map((status) => (
          <Pressable
            key={status.goal.id}
            testID={`goal-row-${status.goal.id}`}
            accessibilityRole="button"
            accessibilityLabel={goalRowAccessibilityLabel(status)}
            onPress={() =>
              router.push({ pathname: "/plan/goals/[id]", params: { id: status.goal.id } })
            }
          >
            <GoalCard
              testID={`goal-card-${status.goal.id}`}
              name={status.goal.name}
              progress={status.progress}
              targetDate={status.goal.targetDate}
              contributionRule={status.goal.contributionRule}
            />
          </Pressable>
        ))}
        {deletedSection}
        {/* Clears the floating action button on short devices. */}
        <View className="h-16" />
      </ScrollView>
      <View className="absolute bottom-6 right-6">
        <Button title="Add" onPress={onAdd} testID="goals-add" />
      </View>
    </View>
  );
}
