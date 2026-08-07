// app/(tabs)/transactions.tsx — Transactions tab placeholder (ledger + Review
// Queue, docs/06-information-architecture.md §3.2). Later plans replace this
// body; the tab registration in (tabs)/_layout.tsx does not change.
import { Text, View } from "react-native";

export default function TransactionsScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-bg px-6 dark:bg-bg-dark">
      <Text className="text-xl font-semibold text-fg dark:text-fg-dark">Transactions</Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Nothing tracked yet. Your transactions will appear here automatically.
      </Text>
    </View>
  );
}
