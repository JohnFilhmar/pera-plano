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
import { Pressable, ScrollView, View } from "react-native";

import { GoalCard } from "@/components/goals/goal_card";
import { formatCentavos } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useGoals } from "@/hooks/queries/use_goals";
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
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        {/* Rule 7's copy. */}
        <EmptyState
          testID="goals-empty"
          title="No goals yet"
          body="Name something you are saving for and PeraPlano will track it against a savings account."
          action={{ label: "Create a goal", onPress: onAdd }}
        />
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
      </ScrollView>
      <View className="absolute bottom-6 right-6">
        <Button title="Add" onPress={onAdd} testID="goals-add" />
      </View>
    </View>
  );
}
