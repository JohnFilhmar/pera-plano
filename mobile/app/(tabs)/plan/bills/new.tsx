// app/(tabs)/plan/bills/new.tsx — create a bill (m2c Task 5, rule 6).
//
// NO TIER GATE ANYWHERE ON THIS SCREEN, unlike the loans and goals create
// routes. Spec: "bill creation, reminders, and auto-match are unlimited in both
// tiers — bills are core control, and a capped bill list would make Free-tier
// Safe-to-Spend dishonest." An untracked bill is a missed payment.
import { useRouter } from "expo-router";
import { ScrollView } from "react-native";

import { BillForm } from "@/components/bills/bill_form";
import { useCreateBill } from "@/hooks/mutations/use_create_bill";
import { systemClock } from "@/lib/clock";
import { toDateIso } from "@/lib/dates";

export default function NewBillScreen() {
  const router = useRouter();
  const createBill = useCreateBill();

  return (
    <ScrollView
      testID="bill-new"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="p-4"
    >
      <BillForm
        today={toDateIso(new Date(systemClock.now()))}
        busy={createBill.isPending}
        onSubmit={async (values) => {
          await createBill.mutateAsync(values);
          router.back();
        }}
      />
    </ScrollView>
  );
}
