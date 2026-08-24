// app/(tabs)/more/listener_health.tsx — m3b Task 7. Route: /more/listener_health.
//
// NESTED UNDER app/(tabs)/more/, matching app/(tabs)/more/reports.tsx and
// app/(tabs)/more/subscriptions.tsx — NOT a sibling app/more/ tree, which
// would collide on the same /more/* URL space (that mistake has landed five
// times already across m2b, m2c and m3-part2; see reports.tsx's own header).
//
// THE DETAIL VIEW BEHIND components/home/tracking_banner.tsx's ambient
// banner, and the two must never disagree (m3b Task 7 interface note 1). Both
// read the exact same `useListenerHealth()` — the hook that deliberately
// keeps the live native read (`granted`, `serviceConnected`, `lastCaptureAt`)
// apart from the user's own pause switch (`captureEnabled`), so a fault
// banner is never shown to someone who paused on purpose, and a reassuring
// "paused" pill is never shown to someone whose listener silently died.
//
// FREE-TIER, UNGATED (rule 5): a user must always be able to see whether
// tracking is working, so nothing on this screen sits behind PlusGate or
// SoonGate.
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AppState, ScrollView, Text, View } from "react-native";
import type { AppStateStatus } from "react-native";

import { HealthCard } from "@/components/privacy/health_card";
import { OemGuidance } from "@/components/privacy/oem_guidance";
import { queryKeys } from "@/constants/query_keys";
import { useListenerHealth } from "@/hooks/queries/use_listener_health";
import { openAccessSettings } from "@/modules/notification_listener";

export default function ListenerHealthScreen() {
  const { data: health } = useListenerHealth();
  const queryClient = useQueryClient();

  // `isAccessGranted`'s own doc (modules/notification_listener/index.ts):
  // access is revocable from system settings at any moment with no callback
  // to this app, so a live read must be re-asked "in particular when the app
  // returns to the foreground after openAccessSettings()" — exactly the round
  // trip this screen's own settings button starts.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.listenerHealth.all });
      }
    });
    return () => subscription.remove();
  }, [queryClient]);

  return (
    <ScrollView
      testID="listener-health-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-4 p-4"
    >
      {/* The user's own switch, stated plainly — this screen shows the
          listener's true facts even while paused (they do not stop being
          true), but a reader who paused on purpose should not mistake that
          for a fault the three facts below are about to describe. */}
      {health !== undefined && !health.captureEnabled ? (
        <View
          testID="listener-health-paused-note"
          className="rounded-lg bg-surface px-4 py-3 dark:bg-surface-dark"
        >
          <Text className="text-fg-2 dark:text-fg-2-dark">
            Tracking is paused — you turned it off. The facts below are still accurate; resume
            tracking from Privacy to start recording again.
          </Text>
        </View>
      ) : null}

      <HealthCard health={health} onOpenAccessSettings={openAccessSettings} />

      <OemGuidance />

      {/* Clears the tab bar on short devices. */}
      <View className="h-8" />
    </ScrollView>
  );
}
