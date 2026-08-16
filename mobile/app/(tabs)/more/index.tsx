// app/(tabs)/more/index.tsx — the More tab hub (M3 Part 2 Task 6).
//
// Converted from the M1 placeholder at app/(tabs)/more.tsx, the same move
// plan/index.tsx made for its own sub-screens: expo-router treats `more.tsx`
// and `more/index.tsx` as the same `/more` route (the tab registration in
// (tabs)/_layout.tsx did not move), which is what lets Subscriptions nest
// under `more/` without opening a second URL space —
// `app/more/subscriptions.tsx` would collide with this one, the same mistake
// m2b Tasks 4 and 8 and m2c Task 5 already made once each.
//
// ONE ROW SO FAR. Reports, CSV export and Settings are the rest of this hub
// (docs/06-information-architecture.md §2 "MoreTab") and land with the plans
// that build them; this task adds only the row it owns.
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";

import { PlusGate } from "@/components/gates/plus_gate";
import { Card } from "@/components/ui/card";

export default function MoreScreen() {
  const router = useRouter();

  return (
    <ScrollView
      testID="more-hub"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-3 p-4"
    >
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
