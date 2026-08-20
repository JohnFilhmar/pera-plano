// app/(tabs)/plan/bills/[id]/edit.tsx — edit a bill (owner's device report:
// bills "should also be modifable").
//
// `updateBill` has existed in lib/db/repos/bills_repo.ts since m2c, with its
// clearing semantics carefully worked out, and nothing ever called it. Until
// now a user who mistyped an amount or picked the wrong due rule had to archive
// the bill and build a new one — losing its payment history, and with it the
// estimator's inputs.
//
// NO TIER GATE, matching the create route: bills are uncapped in both tiers
// (spec rule 6), so there is nothing here to gate even in principle.
//
// NO ARCHIVE HERE. It lives on the detail screen, behind a confirmation.
//
// THE EDIT DOES NOT RESOLVE ANY CYCLE. Open cycles keep their own state in
// `bill_cycles` (spec rule 25's "two cycles open at once, resolved
// independently"), so changing the amount re-estimates FUTURE cycles without
// rewriting one the user already settled.
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";

import { BillForm } from "@/components/bills/bill_form";
import { EmptyState } from "@/components/ui/empty_state";
import { FormScreen } from "@/components/ui/form_screen";
import { useUpdateBill } from "@/hooks/mutations/use_update_bill";
import { useBills } from "@/hooks/queries/use_bills";
import { systemClock } from "@/lib/clock";
import { toDateIso } from "@/lib/dates";

export default function EditBillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: statuses } = useBills();
  const update = useUpdateBill();

  if (statuses === undefined) {
    return <View testID="bill-edit-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  // `useBills` returns one status PER CYCLE, so a bill with two open cycles
  // appears twice. Any of them carries the same `bill`, which is what is being
  // edited here — the cycle is irrelevant to this screen.
  const bill = statuses.find((status) => status.bill.id === id)?.bill;
  if (bill === undefined) {
    return (
      <View testID="bill-edit-missing" className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          title="This bill is gone"
          body="It was archived. Any payments you recorded are still in your ledger."
          action={{ label: "Back to bills", onPress: () => router.back() }}
        />
      </View>
    );
  }

  return (
    <FormScreen testID="bill-edit">
      <BillForm
        testID="bill-edit-form"
        today={toDateIso(new Date(systemClock.now()))}
        busy={update.isPending}
        submitLabel="Save changes"
        initial={{
          name: bill.name,
          amount: bill.amount,
          amountMode: bill.amountMode,
          dueRule: bill.dueRule,
          reminderOffsets: bill.reminderOffsets,
        }}
        onSubmit={async (values) => {
          await update.mutateAsync({ id: bill.id, patch: values });
          router.back();
        }}
      />
    </FormScreen>
  );
}
