// components/plan/bills_panel.tsx — the Bills list (m2c Task 5, rules 1, 6,
// 7).
//
// A PANEL, NOT A SCREEN. `app/(tabs)/plan/bills.tsx` still exists and still
// renders this panel as a full screen: Plan's segmented control (a follow-up
// task) will swap panels in place without navigating, but `/plan/bills`
// stays a real, routable stack screen. `bills/[id].tsx` pops back to it with
// `router.back()`; Home (`app/(tabs)/index.tsx`) pushes straight to
// `/plan/bills/[id]` from its alert cards and upcoming-bills strip; and a
// bill-reminder push notification resolves to the same route
// (`lib/alerts/alert_routes.ts`). Deleting the route would strand all three
// (revamp spec R4).
//
// ORDERED BY URGENCY, NOT BY DATE (rule 1). Overdue first, then due today, then
// upcoming by date — the spec's own section order. A plain chronological list
// would bury a bill that is three weeks late underneath one due tomorrow, which
// is exactly backwards: the late one is the only entry the user can still do
// something wrong about.
//
// PAID CYCLES COLLAPSE TO THE BOTTOM. The spec's states table calls that
// section "Paid this cycle (collapsed)" — it is reassurance, not a to-do, and
// putting it first would make a well-run month look like a wall of work.
import { useRouter } from "expo-router";
import { ScrollView, Text, View } from "react-native";

import { BillRow } from "@/components/bills/bill_row";
import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty_state";
import { SectionHeader } from "@/components/ui/section_header";
import { useBills } from "@/hooks/queries/use_bills";
import type { BillStatus } from "@/lib/bills/bills_service";
import { systemClock } from "@/lib/clock";
import { addDaysIso, toDateIso } from "@/lib/dates";

/** Rule 1: "a header shows the total due in the next 30 days". */
const HEADER_WINDOW_DAYS = 30;

const SECTIONS: readonly { key: string; title: string; states: BillStatus["state"][] }[] = [
  { key: "overdue", title: "Overdue", states: ["overdue"] },
  { key: "due-today", title: "Due today", states: ["due_today"] },
  { key: "upcoming", title: "Upcoming", states: ["upcoming"] },
  { key: "resolved", title: "Settled", states: ["paid", "skipped", "resolved_external"] },
];

export function BillsPanel() {
  const router = useRouter();
  const { data: statuses } = useBills();

  if (statuses === undefined) {
    return <View testID="bills-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  if (statuses.length === 0) {
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          testID="bills-empty"
          title="No bills tracked yet"
          body="Add the ones you never want to miss — rent, Meralco, tuition, a subscription."
          action={{ label: "Add a bill", onPress: () => router.push("/plan/bills/new") }}
        />
      </View>
    );
  }

  const today = toDateIso(new Date(systemClock.now()));
  const windowEnd = addDaysIso(today, HEADER_WINDOW_DAYS);
  // Unresolved cycles only — the header answers "what do I still owe", and a
  // paid bill is not part of that question.
  const dueSoon = statuses
    .filter((status) => status.dueDate <= windowEnd)
    .filter(
      (status) =>
        status.state === "overdue" || status.state === "due_today" || status.state === "upcoming",
    );
  const total = dueSoon.reduce((sum, status) => sum + status.estimate.amount, 0);

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView testID="bills-list" contentContainerClassName="gap-3 p-4">
        <Card>
          <Text className="text-fg-2 dark:text-fg-2-dark">Due in the next 30 days</Text>
          <AmountText testID="bills-total" amount={total} size="lg" />
          <Text className="mt-1 text-xs text-fg-2 dark:text-fg-2-dark">
            {dueSoon.length === 1 ? "1 bill" : `${dueSoon.length} bills`}
          </Text>
        </Card>

        {SECTIONS.map((section) => {
          const rows = statuses.filter((status) => section.states.includes(status.state));
          if (rows.length === 0) return null;

          return (
            <View key={section.key} testID={`bills-section-${section.key}`} className="gap-3">
              <SectionHeader title={section.title} />
              {rows.map((status) => (
                <BillRow
                  key={`${status.bill.id}|${status.dueDate}`}
                  testID={`bill-row-${status.bill.id}-${status.dueDate}`}
                  status={status}
                  onPress={() =>
                    router.push({
                      pathname: "/plan/bills/[id]",
                      params: { id: status.bill.id, dueDate: status.dueDate },
                    })
                  }
                />
              ))}
            </View>
          );
        })}
        {/* Clears the floating action button on short devices. */}
        <View className="h-16" />
      </ScrollView>
      <View className="absolute bottom-6 right-6">
        <Button title="Add" testID="bills-add" onPress={() => router.push("/plan/bills/new")} />
      </View>
    </View>
  );
}
