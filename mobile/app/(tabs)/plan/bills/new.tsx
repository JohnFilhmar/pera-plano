// app/(tabs)/plan/bills/new.tsx — create a bill (m2c Task 5, rule 6).
//
// NO TIER GATE ANYWHERE ON THIS SCREEN, unlike the loans and goals create
// routes. Spec: "bill creation, reminders, and auto-match are unlimited in both
// tiers — bills are core control, and a capped bill list would make Free-tier
// Safe-to-Spend dishonest." An untracked bill is a missed payment.
//
// NO ScrollView HERE (numeric-input-system Task 11). FormScreen IS a
// (keyboard-avoiding) vertical scroll view; nesting it inside another one
// left the OUTER ScrollView — which knows nothing about the keypad's height
// — as the only one with real scroll range, so FormScreen's own keyboard
// avoidance became a no-op. Same fix as app/(tabs)/plan/loans/new.tsx.
import { useRouter } from "expo-router";

import { BillForm } from "@/components/bills/bill_form";
import { FormScreen } from "@/components/ui/form_screen";
import { useCreateBill } from "@/hooks/mutations/use_create_bill";
import { systemClock } from "@/lib/clock";
import { toDateIso } from "@/lib/dates";

export default function NewBillScreen() {
  const router = useRouter();
  const createBill = useCreateBill();

  return (
    <FormScreen testID="bill-new">
      <BillForm
        today={toDateIso(new Date(systemClock.now()))}
        busy={createBill.isPending}
        onSubmit={async (values) => {
          await createBill.mutateAsync(values);
          router.back();
        }}
      />
    </FormScreen>
  );
}
