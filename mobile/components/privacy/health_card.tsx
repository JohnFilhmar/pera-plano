// components/privacy/health_card.tsx — m3b Task 7. The Listener health
// screen's detail view behind `components/home/tracking_banner.tsx`'s ambient
// banner (hooks/queries/use_listener_health.ts's own header explains why the
// two sources — the live native read and the user's own pause switch — are
// kept apart; this card renders only the native half, the three facts
// `getListenerHealth()` promises).
//
// PRESENTATIONAL, LIKE `TrackingBanner`. No native import here — the screen
// passes `onOpenAccessSettings` down rather than this card reaching for
// `openAccessSettings()` itself, which is what keeps this file requirable
// under Jest with no mock at all (`modules/notification_listener` calls
// `requireNativeModule` at import time and throws otherwise).
import { Pressable, Text, View } from "react-native";

import { Card } from "@/components/ui/card";
import type { TrackingHealth } from "@/hooks/queries/use_listener_health";
import { formatDateTime } from "@/lib/datetime";

export type HealthCardProps = {
  health: TrackingHealth | undefined;
  onOpenAccessSettings: () => void;
  testID?: string;
};

function lastCaptureLabel(lastCaptureAt: number | null): string {
  // `null` stays "not yet" rather than being coerced to an epoch date — the
  // same distinction `getListenerHealth`'s own doc insists on, preserved here
  // rather than re-decided.
  return lastCaptureAt === null
    ? "No capture yet"
    : `Last capture ${formatDateTime(lastCaptureAt)}`;
}

export function HealthCard({ health, onOpenAccessSettings, testID }: HealthCardProps) {
  if (health === undefined) {
    return <View testID={testID ?? "health-card-loading"} />;
  }

  const { granted, serviceConnected, lastCaptureAt } = health;

  return (
    <Card testID={testID ?? "health-card"}>
      <Text className="text-lg font-semibold text-fg dark:text-fg-dark">Listener health</Text>

      {/* The three facts, rule 1 — always shown, regardless of state, so the
          screen never makes the user guess what it already knows. */}
      <View className="mt-3 gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-fg-2 dark:text-fg-2-dark">Notification access</Text>
          <Text
            testID="health-card-granted"
            className={
              granted
                ? "font-semibold text-brand dark:text-brand-dark"
                : "font-semibold text-danger dark:text-danger-dark"
            }
          >
            {granted ? "Granted" : "Revoked"}
          </Text>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-fg-2 dark:text-fg-2-dark">Listener service</Text>
          <Text
            testID="health-card-connected"
            className={
              serviceConnected
                ? "font-semibold text-brand dark:text-brand-dark"
                : "font-semibold text-warn dark:text-warn-dark"
            }
          >
            {serviceConnected ? "Connected" : "Disconnected"}
          </Text>
        </View>
        <Text testID="health-card-last-capture" className="text-fg-2 dark:text-fg-2-dark">
          {lastCaptureLabel(lastCaptureAt)}
        </Text>
      </View>

      {/* Rule 1's loud case. Some OEMs revoke Notification Access silently —
          on reboot, on an app update, from an aggressive "permission auto-
          reset" feature — with no callback to this app, so this is the one
          state on this card that gets its own banner and its own action
          rather than sitting quietly in the three-fact list above. */}
      {!granted ? (
        <View
          testID="health-card-revoked-warning"
          className="mt-4 gap-2 rounded-lg bg-danger px-4 py-3 dark:bg-danger-dark"
        >
          <Text className="font-semibold text-surface dark:text-surface-dark">
            Notification access was revoked
          </Text>
          <Text className="text-surface dark:text-surface-dark">
            PeraPlano can no longer read your notifications, so nothing is being tracked. Some
            phone brands turn this off on their own — re-grant it to resume tracking.
          </Text>
          <Pressable
            testID="health-card-open-settings"
            accessibilityRole="button"
            onPress={onOpenAccessSettings}
          >
            <Text className="font-semibold text-surface underline dark:text-surface-dark">
              Open notification access settings
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}
