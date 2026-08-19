// app/(tabs)/plan/income.tsx — the Income screen (m2-part2 Task 13;
// docs/04-features/04-income.md).
//
// ROUTE PATH DIFFERS FROM THE PLAN, WHICH SAYS `app/plan/income.tsx`. The
// limits screens already live under `app/(tabs)/plan/`, and expo-router would
// have two directories — `app/plan/` and `app/(tabs)/plan/` — both contributing
// to the same `/plan/*` URL space. The route this file serves is `/plan/income`
// either way; keeping the whole Plan tab in one tree is what stops a later
// reader having to know that half of it lives somewhere else.
//
// THE SCREEN IS A READ PLUS FOUR ACTIONS. Detection itself runs on bootstrap
// and on ledger commits (Task 14), never from a render — opening this screen
// must not change what the app believes about the user's pay.
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { IncomeForm } from "@/components/income/income_form";
import { IncomeSummaryCard } from "@/components/income/income_summary_card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormScreen } from "@/components/ui/form_screen";
import { SectionHeader } from "@/components/ui/section_header";
import { useClearManualIncome } from "@/hooks/mutations/use_clear_manual_income";
import { useConfirmIncome } from "@/hooks/mutations/use_confirm_income";
import { useDismissIncome } from "@/hooks/mutations/use_dismiss_income";
import { useSetManualIncome } from "@/hooks/mutations/use_set_manual_income";
import { useIncomeSummary } from "@/hooks/queries/use_income_summary";
import { useWallets } from "@/hooks/queries/use_wallets";

export default function IncomeScreen() {
  const router = useRouter();
  const { data: summary } = useIncomeSummary();
  const { data: wallets } = useWallets();

  const confirm = useConfirmIncome();
  const dismiss = useDismissIncome();
  const setManual = useSetManualIncome();
  const clearManual = useClearManualIncome();

  const [editing, setEditing] = useState(false);

  // Render nothing until income has loaded. A screen that flashes "we don't
  // know your income" before showing the real figure reads as data loss on the
  // one screen whose subject is a number the user told the app.
  if (summary === undefined) {
    return <View testID="income-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  const known = summary.cadence !== null && summary.averageAmount !== null;
  const showForm = editing || !known;

  return (
    // NO ScrollView HERE (numeric-input-system Task 12). FormScreen IS a
    // keyboard-aware scroll view, and wrapping one in another left the OUTER
    // one — which knows nothing about the keypad panel's height — holding the
    // only real scroll range, so the avoidance below it was a no-op.
    //
    // gap-4/bg-bg/px-4/pt-4 move in from that wrapper's contentContainer.
    // pt-4 is a bare utility rather than insets.top: (tabs)/_layout.tsx
    // already insets every tab-nested screen's top edge in one place. No
    // bottom padding — FormScreen's contentContainerStyle owns that edge.
    <FormScreen testID="income-screen">
      <View className="gap-4 bg-bg px-4 pt-4 dark:bg-bg-dark">
        {known ? (
          <IncomeSummaryCard
            summary={summary}
            onConfirm={() => confirm.mutate()}
            onDismiss={() => dismiss.mutate()}
            onSetManually={() => setEditing(true)}
            busy={confirm.isPending || dismiss.isPending}
          />
        ) : (
          // Rule 4: when income is unknown, say WHAT DEPENDS ON IT. A user who
          // does not know that a percent-of-income limit is sitting paused has
          // no reason to fill this in, and the limit stays silently inert.
          <Card testID="income-unknown">
            <Text className="text-lg font-semibold text-fg dark:text-fg-dark">
              PeraPlano hasn&apos;t worked out your income yet.
            </Text>
            <Text className="mt-2 text-fg-2 dark:text-fg-2-dark">
              It watches for regular money coming in and works this out on its own — usually after
              two or three paydays. Until then, any limit you set as a percentage of income is
              paused, because the app would rather say nothing than guess your pay.
            </Text>
            <Text className="mt-2 text-fg-2 dark:text-fg-2-dark">
              You can tell it now instead, and change it whenever you like.
            </Text>
          </Card>
        )}

        {showForm ? (
          <View>
            <SectionHeader title={known ? "Change your income" : "Set it yourself"} />
            <IncomeForm
              wallets={wallets ?? []}
              initial={
                known
                  ? {
                      cadence: summary.cadence ?? "kinsenas",
                      averageAmount: summary.averageAmount ?? 0,
                      sourceWalletIds: summary.sourceWalletIds,
                    }
                  : undefined
              }
              busy={setManual.isPending}
              onSubmit={async (values) => {
                await setManual.mutateAsync(values);
                setEditing(false);
              }}
            />
          </View>
        ) : (
          <View className="gap-3">
            <Button
              title="Change my income"
              variant="secondary"
              testID="income-edit"
              onPress={() => setEditing(true)}
            />
            {/* Rule 15's "Switch to automatic". Only offered when there is an
                override to switch away from — otherwise it is a button that
                undoes nothing. */}
            {summary.isManualOverride ? (
              <Button
                title="Switch back to automatic"
                variant="ghost"
                testID="income-clear-manual"
                loading={clearManual.isPending}
                onPress={() => clearManual.mutate()}
              />
            ) : null}
          </View>
        )}

        <Button
          title="Back to Plan"
          variant="ghost"
          testID="income-back"
          onPress={() => router.back()}
        />
      </View>
    </FormScreen>
  );
}
