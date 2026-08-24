// app/(tabs)/plan/goals/new.tsx — create a Goal (m2b Task 4, rules 3-4).
//
// NO ScrollView AROUND THE FORM (numeric-input-system Task 11). FormScreen IS
// a (keyboard-avoiding) vertical scroll view; nesting it inside another one
// left the OUTER ScrollView — which knows nothing about the keypad's height
// — as the only one with real scroll range, so FormScreen's own keyboard
// avoidance became a no-op. Same fix as app/(tabs)/plan/loans/new.tsx. The
// gated early return below is a SEPARATE render path with its own `p-6` —
// left alone, it never holds a form.
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";

import { GoalForm } from "@/components/goals/goal_form";
import { FormScreen } from "@/components/ui/form_screen";
import { useCreateGoal } from "@/hooks/mutations/use_create_goal";
import { useGoals } from "@/hooks/queries/use_goals";
import { useWallets } from "@/hooks/queries/use_wallets";

export default function NewGoalScreen() {
  const router = useRouter();
  const { gated } = useLocalSearchParams<{ gated?: string }>();
  const create = useCreateGoal();
  const { data: wallets } = useWallets();
  const { data: statuses } = useGoals();

  if (gated === "1") {
    return (
      <View
        testID="goals-gated"
        className="flex-1 items-center justify-center bg-bg p-6 dark:bg-bg-dark"
      >
        <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Goal cap reached</Text>
        {/* Rule 4, and m2 Global Constraint 11: a cap blocks a NEW goal and
            never touches the existing one. Its progress keeps updating, because
            progress is just the linked wallet's balance. */}
        <Text className="mt-2 text-center text-fg-2 dark:text-fg-2-dark">
          Free keeps one goal, and it carries on tracking exactly as it is. Plus removes the cap
          and adds payday auto-allocation.
        </Text>
      </View>
    );
  }

  // Invariant I10, both halves: a savings wallet, and one no other goal has
  // claimed. Filtering here rather than in the form keeps the form
  // presentational — it renders the wallets it is given.
  const claimed = new Set((statuses ?? []).map((status) => status.goal.linkedWalletId));
  const available = (wallets ?? []).filter(
    (wallet) => wallet.type === "savings" && !claimed.has(wallet.id),
  );

  return (
    <FormScreen>
      <GoalForm
        availableWallets={available}
        busy={create.isPending}
        // Rule 3's inline path. The wallet-creation flow already exists, so
        // this hands off to it rather than reimplementing wallet creation
        // inside a goal form — one place that knows how to make a wallet.
        onCreateWallet={() => router.push("/wallet/new")}
        onSubmit={async (values) => {
          await create.mutateAsync(values);
          router.back();
        }}
      />
    </FormScreen>
  );
}
