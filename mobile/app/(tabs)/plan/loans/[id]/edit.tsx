// app/(tabs)/plan/loans/[id]/edit.tsx — edit a loan (owner's device report:
// loans "should also be modifable").
//
// NO TIER GATE, for the reason app/wallet/[id]/edit.tsx states: the cap is on
// CREATING a loan, and editing one the user already has is never blocked
// (docs/05-monetization.md §3.1 principle 2 — existing records keep working
// fully, including after a downgrade).
//
// NO ARCHIVE HERE. It lives on the detail screen, behind a confirmation.
//
// THE SCHEDULE IS RECONSTRUCTED, NOT GUESSED. A loan stores its INSTALLMENTS,
// not the term/count/interval they were generated from, so `loanFormInitialFrom`
// works those back out (see its own doc). Getting that wrong would rebuild a
// DIFFERENT repayment plan on save, for someone who only opened this screen to
// fix a typo in the lender's name.
//
// AN EDIT IS NOT A BALANCE CORRECTION. `recordAdjustment` exists for that and
// requires a note (loans rule 13). Editing `principal` here restates what was
// borrowed, which is a different claim from "the balance moved for a reason" —
// and recorded payments are untouched either way, since they live in their own
// table keyed on the loan id.
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { LoanForm, loanFormInitialFrom } from "@/components/loans/loan_form";
import { EmptyState } from "@/components/ui/empty_state";
import { useUpdateLoan } from "@/hooks/mutations/use_update_loan";
import { useLoans } from "@/hooks/queries/use_loans";

export default function EditLoanScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: statuses } = useLoans();
  const update = useUpdateLoan();

  if (statuses === undefined) {
    return <View testID="loan-edit-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  const loan = statuses.find((status) => status.loan.id === id)?.loan;
  if (loan === undefined) {
    return (
      <View testID="loan-edit-missing" className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          title="This loan is gone"
          body="It was archived. Any payments you recorded are still in your ledger."
          action={{ label: "Back to loans", onPress: () => router.back() }}
        />
      </View>
    );
  }

  // NO FormScreen WRAPPER HERE, unlike the bill and limit edit routes:
  // components/loans/loan_form.tsx mounts its own (see that file's header —
  // it was the only form in scope for the numeric-input migration), and
  // nesting one keyboard-aware scroll view inside another is the exact defect
  // that migration existed to fix.
  return (
    <LoanForm
      initial={loanFormInitialFrom(loan)}
      busy={update.isPending}
      submitLabel="Save changes"
      onSubmit={async (values) => {
        await update.mutateAsync({ id: loan.id, patch: values });
        router.back();
      }}
    />
  );
}
