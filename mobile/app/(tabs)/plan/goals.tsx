// app/(tabs)/plan/goals.tsx — the Goals list (m2b Task 4;
// docs/04-features/05-goals-savings.md).
//
// Flattened beside the `goals/` directory rather than `goals/index.tsx`, for
// the reason m2 Task 8 recorded: with `typedRoutes` on, expo-router's generator
// emits only `/plan/goals/index` for a nested index route inside a route group,
// never the bare `/plan/goals`. The repo already does this with
// `app/wallet/[id].tsx` beside `app/wallet/[id]/edit.tsx`.
import { useRouter } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";

import { GoalCard } from "@/components/goals/goal_card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty_state";
import { useGoals } from "@/hooks/queries/use_goals";
import { canCreateGoal } from "@/lib/entitlements";

export default function GoalsScreen() {
  const router = useRouter();
  const { data: statuses } = useGoals();

  const onAdd = () => {
    const count = statuses?.length ?? 0;
    router.push(canCreateGoal(count) ? "/plan/goals/new" : "/plan/goals/new?gated=1");
  };

  // Render nothing until the list has loaded. An empty state that flashes on
  // every cold start reads as data loss — the rule the Wallets tab set.
  if (statuses === undefined) {
    return <View testID="goals-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
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
            onPress={() =>
              router.push({ pathname: "/plan/goals/[id]", params: { id: status.goal.id } })
            }
          >
            <GoalCard
              testID={`goal-card-${status.goal.id}`}
              name={status.goal.name}
              progress={status.progress}
              targetDate={status.goal.targetDate}
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
