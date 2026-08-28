// app/(tabs)/plan/goals/[id].tsx — Goal detail (m2b Task 4).
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { GoalCard } from "@/components/goals/goal_card";
import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useDeleteGoal } from "@/hooks/mutations/use_delete_goal";
import { useGoals } from "@/hooks/queries/use_goals";
import { useWallets } from "@/hooks/queries/use_wallets";

export default function GoalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: statuses } = useGoals();
  const { data: wallets } = useWallets();
  const remove = useDeleteGoal();

  if (statuses === undefined) {
    return (
      <View testID="goal-detail-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={4} />
      </View>
    );
  }

  const status = statuses.find((candidate) => candidate.goal.id === id);
  if (status === undefined) {
    // Reachable by pressing Delete on this very screen — the mutation
    // invalidates, the status disappears, and this renders for a frame before
    // `router.back()` lands. Also what a stale deep link hits.
    return (
      <View testID="goal-detail-missing" className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          title="This goal is gone"
          body="It was deleted. The money in the savings account is untouched — a goal only ever watched it — and you can restore it from Plan → Goals."
          action={{ label: "Back to goals", onPress: () => router.back() }}
        />
      </View>
    );
  }

  const wallet = (wallets ?? []).find((candidate) => candidate.id === status.goal.linkedWalletId);

  return (
    <ScrollView
      testID="goal-detail"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-4 p-4"
    >
      <GoalCard
        testID="goal-detail-card"
        name={status.goal.name}
        progress={status.progress}
        targetDate={status.goal.targetDate}
        contributionRule={status.goal.contributionRule}
      />

      <Card>
        <View className="flex-row items-center justify-between">
          <Text className="text-fg-2 dark:text-fg-2-dark">Savings account</Text>
          <Text className="text-fg dark:text-fg-dark">{wallet?.name ?? "—"}</Text>
        </View>
        <View className="mt-2 flex-row items-center justify-between">
          <Text className="text-fg-2 dark:text-fg-2-dark">Still to save</Text>
          <AmountText testID="goal-detail-remaining" amount={status.progress.remaining} />
        </View>
        {/* Spec rule 1, said out loud. A user who does not know that progress
            IS the balance will not understand why a withdrawal moved their goal
            backwards, and will think the app lost their savings. */}
        <Text className="mt-3 text-fg-2 dark:text-fg-2-dark">
          Progress is whatever is in this account, however it got there — transfers, interest, or
          money that was already sitting in it.
        </Text>
      </Card>

      {/* EDIT SITS ABOVE DELETE, and this screen used to have only the second
          of the two (owner's device report: "unable to edit goals"). Without
          it, correcting a target or a deadline meant deleting the goal and
          building it again — safe for the money (rule 3) but not for the plan,
          which restarts its pace from a new created date. */}
      <Button
        title="Edit goal"
        variant="secondary"
        testID="goal-edit"
        onPress={() =>
          router.push({ pathname: "/plan/goals/[id]/edit", params: { id: status.goal.id } })
        }
      />

      <Button
        title="Delete goal"
        variant="destructive"
        testID="goal-delete"
        loading={remove.isPending}
        onPress={async () => {
          await remove.mutateAsync(status.goal.id);
          router.back();
        }}
      />
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Deleting the goal keeps the account and every peso in it, and you can restore the
        goal itself from Plan → Goals.
      </Text>
    </ScrollView>
  );
}
