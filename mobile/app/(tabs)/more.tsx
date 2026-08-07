// app/(tabs)/more.tsx — More tab placeholder. The real More tab is a hub
// (Reports, export, Settings, PeraPlano Plus — docs/06-information-
// architecture.md §2 "MoreTab", §3.5); there is no one "More" row in the §5
// empty-state table, so this placeholder shows the Reports section's empty
// copy as a stand-in until the M3 insight plans build the real hub. The tab
// registration in (tabs)/_layout.tsx does not change when they do.
import { Text, View } from "react-native";

export default function MoreScreen() {
  return (
    <View className="flex-1 items-center justify-center gap-2 bg-bg px-6 dark:bg-bg-dark">
      <Text className="text-xl font-semibold text-fg dark:text-fg-dark">More</Text>
      <Text className="text-center text-fg-2 dark:text-fg-2-dark">
        Reports build up as your data does — check back after a few days of tracking.
      </Text>
    </View>
  );
}
