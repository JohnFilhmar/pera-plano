// app/(tabs)/index.tsx — Home tab placeholder. Later plans (Safe-to-Spend,
// listener health, recent activity — docs/06-information-architecture.md
// §3.1) replace this body; the tab registration in (tabs)/_layout.tsx does
// not change when they do.
import { Text, View } from "react-native";

export default function HomeScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-bg px-6 dark:bg-bg-dark">
      <Text className="text-xl font-semibold text-fg dark:text-fg-dark">Home</Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Watching for your first transaction — pay with GCash or your bank as usual.
      </Text>
    </View>
  );
}
