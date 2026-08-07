// app/(tabs)/wallets.tsx — Wallets tab placeholder (wallet list, balances,
// cash reconciliation, docs/06-information-architecture.md §3.3). Later
// plans replace this body; the tab registration in (tabs)/_layout.tsx does
// not change.
import { Text, View } from "react-native";

export default function WalletsScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-bg px-6 dark:bg-bg-dark">
      <Text className="text-xl font-semibold text-fg dark:text-fg-dark">Wallets</Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Add your first Wallet — GCash, bank, or cash.
      </Text>
    </View>
  );
}
