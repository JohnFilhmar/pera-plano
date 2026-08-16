// app/(tabs)/more/index.tsx — the More tab hub (M3 Part 2 Task 6; Reports row
// added by the M3b chart-colours-and-integration task).
//
// Converted from the M1 placeholder at app/(tabs)/more.tsx, the same move
// plan/index.tsx made for its own sub-screens: expo-router treats `more.tsx`
// and `more/index.tsx` as the same `/more` route (the tab registration in
// (tabs)/_layout.tsx did not move), which is what lets Reports and
// Subscriptions nest under `more/` without opening a second URL space —
// `app/more/reports.tsx` or `app/more/subscriptions.tsx` would collide with
// this one, the same mistake m2b Tasks 4 and 8 and m2c Task 5 already made
// once each.
//
// TWO ROWS, TWO DIFFERENT GATES — not a data-driven list like
// app/(tabs)/plan/index.tsx's `SECTIONS`. Plan's rows all gate the same way
// (`SoonGate`, phased rollout); these two do not: Reports is still `"soon"`
// in constants/shipped_features.ts (a later task flips it), while
// Subscriptions is a shipped feature gated by `PlusGate` (a tier paywall,
// docs/05-monetization.md). A single table shape would have to smuggle two
// gate kinds through one field, which is more machinery than two rows need.
// CSV export lives inside the Reports screen itself
// (components/reports/export_button.tsx is self-gated); Settings is the rest
// of this hub and lands with the plan that builds it.
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { SoonGate } from "@/components/gates/soon_gate";
import { Card } from "@/components/ui/card";

export default function MoreScreen() {
  const router = useRouter();

  return (
    <ScrollView
      testID="more-hub"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-3 p-4"
    >
      {/* `reports` is still "soon" — SoonGate keeps the row visible and
          desaturated with its grey chip rather than hiding it outright, the
          same phased-rollout convention Plan hub's sections use. Once a
          later task flips the key, this row becomes fully interactive with
          no code change here. */}
      <SoonGate feature="reports">
        <Pressable
          testID="more-reports"
          onPress={() => router.push("/more/reports")}
          accessibilityRole="button"
          accessibilityLabel="Reports"
        >
          <Card>
            <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Reports</Text>
            <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
              Spending by category, top merchants, and the trend behind them.
            </Text>
          </Card>
        </Pressable>
      </SoonGate>

      {/* Plan rule 5: a locked door the user can see through converts better
          than a hidden one — Free sees this exact row and its one-line
          explanation, never the merchants or amounts behind it (Reports rule
          19; see app/(tabs)/more/subscriptions.tsx for where that data lives
          and how it stays hidden even if this gate is bypassed). */}
      <PlusGate capability="recurring">
        <Pressable
          testID="more-subscriptions"
          onPress={() => router.push("/more/subscriptions")}
          accessibilityRole="button"
          accessibilityLabel="Subscriptions"
        >
          <Card>
            <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Subscriptions</Text>
            <Text className="mt-1 text-fg-2 dark:text-fg-2-dark">
              We flag recurring charges and total what's locked in every month.
            </Text>
          </Card>
        </Pressable>
      </PlusGate>
      {/* Spacer so the last card clears the tab bar on short devices. */}
      <View className="h-4" />
    </ScrollView>
  );
}
