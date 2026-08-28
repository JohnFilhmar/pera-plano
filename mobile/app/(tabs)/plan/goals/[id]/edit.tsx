// app/(tabs)/plan/goals/[id]/edit.tsx — edit a Goal (owner's device report:
// "unable to edit goals").
//
// The goal detail screen offered exactly one action, "Delete goal", and
// `updateGoal` in lib/db/repos/goals_repo.ts had never been called by anything
// — so fixing a mistyped target or a deadline that moved meant deleting the
// goal and rebuilding it. Deleting is safe for the MONEY (rule 3: the wallet
// and its balance survive) but it is not safe for the PLAN: the goal's created
// date, and with it the pace the app quotes, restart from scratch.
//
// NO TIER GATE, matching bills' edit route and unlike goals' CREATE route. The
// Free cap in `new.tsx` is a cap on HOW MANY goals exist (rule 4, m2 Global
// Constraint 11) — it has never applied to the one a user already has, whose
// progress keeps updating regardless of tier. Gating an edit here would take
// away a goal the cap explicitly promises to leave alone.
//
// NO DELETE HERE. It stays on the detail screen next to the sentence that says
// what deleting does and does not touch.
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { GoalForm } from "@/components/goals/goal_form";
import { EmptyState } from "@/components/ui/empty_state";
import { FormScreen } from "@/components/ui/form_screen";
import { LoadingSkeleton } from "@/components/ui/loading_skeleton";
import { useUpdateGoal } from "@/hooks/mutations/use_update_goal";
import { useGoals } from "@/hooks/queries/use_goals";
import { useWallets } from "@/hooks/queries/use_wallets";

export default function EditGoalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: statuses } = useGoals();
  const { data: wallets } = useWallets();
  const update = useUpdateGoal();

  if (statuses === undefined) {
    return (
      <View testID="goal-edit-loading" className="flex-1 bg-bg dark:bg-bg-dark">
        <LoadingSkeleton rows={3} />
      </View>
    );
  }

  const goal = statuses.find((status) => status.goal.id === id)?.goal;
  if (goal === undefined) {
    return (
      <View testID="goal-edit-missing" className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          title="This goal is gone"
          body="It was deleted. The money in the savings account is untouched — a goal only ever watched it."
          action={{ label: "Back to goals", onPress: () => router.back() }}
        />
      </View>
    );
  }

  // The create route's filter, PLUS this goal's own wallet. `linked_wallet_id`
  // is UNIQUE, so the account this goal already holds reads as "claimed" to the
  // same test that keeps two goals off one wallet — and leaving it out here
  // would render the goal's own account as the one option the user cannot pick,
  // with no way to restore it after touching the picker. `updateGoal` already
  // allows re-saving a goal onto its own wallet (`assertWalletIsFree`'s
  // `exceptGoalId`), so the write side agrees with showing it.
  const claimed = new Set(
    statuses.map((status) => status.goal.linkedWalletId).filter((walletId) => walletId !== goal.linkedWalletId),
  );
  const available = (wallets ?? []).filter(
    (wallet) => !wallet.owedBalance && !wallet.isArchived && !claimed.has(wallet.id),
  );

  return (
    <FormScreen testID="goal-edit">
      <GoalForm
        availableWallets={available}
        busy={update.isPending}
        submitLabel="Save changes"
        initial={{
          name: goal.name,
          targetAmount: goal.targetAmount,
          targetDate: goal.targetDate,
          linkedWalletId: goal.linkedWalletId,
          contributionRule: goal.contributionRule,
        }}
        onCreateWallet={() => router.push("/wallet/new")}
        onSubmit={async (values) => {
          await update.mutateAsync({ id: goal.id, patch: values });
          router.back();
        }}
      />
    </FormScreen>
  );
}
