// app/(tabs)/plan/loans/new.tsx — add a Loan (m2b Task 8, rules 3 and 6).
//
// NO ScrollView HERE (numeric-input-system Task 10 fix round). LoanForm wraps
// itself in FormScreen, which IS a (keyboard-avoiding) vertical scroll view;
// nesting it inside another one left the OUTER ScrollView — which knows
// nothing about the keypad's height — as the only one with real scroll range,
// so FormScreen's own keyboard-avoidance became a no-op. Same fix as
// app/transaction/new.tsx, which never had a wrapper here to begin with.
import { useLocalSearchParams, useRouter } from "expo-router";
import { Text, View } from "react-native";

import { LoanForm } from "@/components/loans/loan_form";
import { useCreateLoan } from "@/hooks/mutations/use_create_loan";

export default function NewLoanScreen() {
  const router = useRouter();
  const { gated } = useLocalSearchParams<{ gated?: string }>();
  const create = useCreateLoan();

  if (gated === "1") {
    return (
      <View
        testID="loans-gated"
        className="flex-1 items-center justify-center bg-bg p-6 dark:bg-bg-dark"
      >
        <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Loan cap reached</Text>
        {/* Rule 6, and m2 Global Constraint 11: a cap blocks a NEW loan and
            never touches the existing one. Free keeps "balance + next due"
            tracking and its reminders (spec rule 16) — only the amortization
            schedule and the second loan are Plus. */}
        <Text className="mt-2 text-center text-fg-2 dark:text-fg-2-dark">
          Free tracks one loan, and it keeps its balance, next due date and reminders exactly as
          they are. Plus removes the cap and adds the full amortization schedule.
        </Text>
      </View>
    );
  }

  return (
    <LoanForm
      busy={create.isPending}
      onSubmit={async (values) => {
        await create.mutateAsync(values);
        router.back();
      }}
    />
  );
}
