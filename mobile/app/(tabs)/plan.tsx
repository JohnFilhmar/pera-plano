// app/(tabs)/plan.tsx — Plan tab placeholder. The real Plan tab is a single
// scrollable hub of four sections — Limits, Goals, Loans, Bills
// (docs/06-information-architecture.md §2 "PlanTab", §3.4) — each with its
// own empty state; there is no one "Plan" row in the §5 empty-state table.
// This placeholder shows the Limits section's empty copy (the hub's first
// section) as a stand-in until the M2 control plans build the real four-
// section hub. The tab registration in (tabs)/_layout.tsx does not change
// when they do.
import { Text, View } from "react-native";

export default function PlanScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-bg px-6 dark:bg-bg-dark">
      <Text className="text-xl font-semibold text-fg dark:text-fg-dark">Plan</Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Set your first Limit and PeraPlano will watch it for you.
      </Text>
    </View>
  );
}
