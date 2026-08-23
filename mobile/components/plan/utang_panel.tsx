// components/plan/utang_panel.tsx — the Loans list (m2b Task 8, rules 1, 6,
// 7). Named `UtangPanel`, not `LoansPanel`: the follow-up task that wires
// this panel into Plan's segmented control also renames the user-facing tab
// to "Utang", so this file is written under its final name instead of being
// renamed again a task later. The user-facing copy is untouched here — every
// string below still reads "loan(s)" — only this component's own name moved
// early.
//
// A PANEL, NOT A SCREEN. `app/(tabs)/plan/loans.tsx` still exists — file name
// and route both unchanged — and still renders this panel as a full screen:
// Plan's segmented control (a follow-up task) will swap panels in place
// without navigating, but `/plan/loans` stays a real, routable stack screen.
// `loans/[id].tsx` pops back to it with `router.back()`, and a loan-reminder
// push notification resolves straight to `/plan/loans/[id]`
// (`lib/alerts/alert_routes.ts`). Deleting the route would strand both
// (revamp spec R4).
//
// TWO SECTIONS WITH SEPARATE TOTALS (rule 1). Mixing "I owe" and "Owed to me"
// into one list would misrepresent the user's position — a ₱5,000 debt and a
// ₱5,000 loan to a cousin are not a wash, they are two obligations pointing in
// opposite directions, and only one of them is under the user's control.
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { LoanCard } from "@/components/loans/loan_card";
import { AmountText } from "@/components/ui/amount_text";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty_state";
import { SectionHeader } from "@/components/ui/section_header";
import { useLoans } from "@/hooks/queries/use_loans";
import { systemClock } from "@/lib/clock";
import { canCreateLoan } from "@/lib/entitlements";
import type { LoanStatus } from "@/lib/loans/loans_service";

export function UtangPanel() {
  const router = useRouter();
  const { data: statuses } = useLoans();
  const now = systemClock.now();

  const onAdd = () => {
    const count = statuses?.length ?? 0;
    router.push(canCreateLoan(count) ? "/plan/loans/new" : "/plan/loans/new?gated=1");
  };

  if (statuses === undefined) {
    return <View testID="loans-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  const iOwe = statuses.filter((status) => status.loan.direction === "i-owe");
  const owedToMe = statuses.filter((status) => status.loan.direction === "owed-to-me");

  if (statuses.length === 0) {
    return (
      <View className="flex-1 justify-center bg-bg dark:bg-bg-dark">
        <EmptyState
          testID="loans-empty"
          title="No loans tracked"
          body="Track what you owe and what people owe you — including utang with no fixed terms."
          action={{ label: "Add a loan", onPress: onAdd }}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg dark:bg-bg-dark">
      <ScrollView contentContainerClassName="gap-3 p-4">
        <LoanSection
          testID="loans-i-owe"
          title="I owe"
          // Rule 7: the two empty states say different things, because an empty
          // debt list is good news and an empty lending list is neutral.
          emptyCopy="You're not tracking any debts."
          statuses={iOwe}
          now={now}
          onOpen={(id) => router.push({ pathname: "/plan/loans/[id]", params: { id } })}
        />
        <LoanSection
          testID="loans-owed-to-me"
          title="Owed to me"
          emptyCopy="No one owes you right now."
          statuses={owedToMe}
          now={now}
          onOpen={(id) => router.push({ pathname: "/plan/loans/[id]", params: { id } })}
        />
      </ScrollView>
      <View className="absolute bottom-6 right-6">
        <Button title="Add" onPress={onAdd} testID="loans-add" />
      </View>
    </View>
  );
}

function LoanSection({
  testID,
  title,
  emptyCopy,
  statuses,
  now,
  onOpen,
}: {
  testID: string;
  title: string;
  emptyCopy: string;
  statuses: LoanStatus[];
  now: number;
  onOpen: (id: string) => void;
}) {
  const total = statuses.reduce((sum, status) => sum + status.outstanding, 0);

  return (
    <View testID={testID} className="gap-3">
      <SectionHeader title={title} />
      {statuses.length === 0 ? (
        <Text testID={`${testID}-empty`} className="text-fg-2 dark:text-fg-2-dark">
          {emptyCopy}
        </Text>
      ) : (
        <>
          <View className="flex-row items-center justify-between">
            <Text className="text-fg-2 dark:text-fg-2-dark">Total</Text>
            <AmountText testID={`${testID}-total`} amount={total} size="lg" />
          </View>
          {statuses.map((status) => (
            <Pressable
              key={status.loan.id}
              testID={`loan-row-${status.loan.id}`}
              onPress={() => onOpen(status.loan.id)}
            >
              <LoanCard testID={`loan-card-${status.loan.id}`} status={status} now={now} />
            </Pressable>
          ))}
        </>
      )}
    </View>
  );
}
