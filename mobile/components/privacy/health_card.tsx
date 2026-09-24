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
import { HeartPulse } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";

import { registerIcon } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list_row";
import type { TrackingHealth } from "@/hooks/queries/use_listener_health";
import { formatDateTime } from "@/lib/datetime";

export type HealthCardProps = {
  health: TrackingHealth | undefined;
  onOpenAccessSettings: () => void;
  testID?: string;
};

const HeartPulseIcon = registerIcon(HeartPulse);

function lastCaptureLabel(lastCaptureAt: number | null): string {
  // `null` stays "not yet" rather than being coerced to an epoch date — the
  // same distinction `getListenerHealth`'s own doc insists on, preserved here
  // rather than re-decided.
  return lastCaptureAt === null
    ? "No capture yet"
    : `Last capture ${formatDateTime(lastCaptureAt)}`;
}

/**
 * "4 captures were dropped", "1 capture was dropped" (GAP-051).
 *
 * The verb agrees as well as the noun. A plain `capture(s)` suffix reads as
 * machine output in the one sentence on this card that reports real loss.
 */
function evictedSentence(count: number): string {
  return count === 1 ? "1 capture was dropped" : `${count} captures were dropped`;
}

/**
 * The board's "Everything's listening" headline, generalised to its two
 * unhealthy equivalents from the SAME two booleans this card already reads —
 * no new data. Ordered by severity: a revoked permission is worse than a
 * disconnected service (the service cannot run at all without the
 * permission), matching `!granted`'s existing precedence over
 * `!serviceConnected` in the revoked-warning branch below.
 */
function healthHeadline(granted: boolean, serviceConnected: boolean): string {
  if (!granted) return "Notification access needed";
  if (!serviceConnected) return "Listener disconnected";
  return "Everything's listening";
}

export function HealthCard({ health, onOpenAccessSettings, testID }: HealthCardProps) {
  if (health === undefined) {
    return <View testID={testID ?? "health-card-loading"} />;
  }

  const { granted, serviceConnected, lastCaptureAt, pendingCaptures, evictedCaptures } = health;
  const healthy = granted && serviceConnected;

  return (
    <Card testID={testID ?? "health-card"}>
      {/* Mint disc + heart-pulse glyph when healthy, per the task-4 brief —
          and its unhealthy equivalents, built from the SAME two booleans the
          three-fact list below already reads rather than new state. The
          disc's own colour never goes further than `bg-chip` (neutral): the
          app's tokens have no `danger-soft`/`warn-soft` background — only
          `brand-soft` is a real opaque token (constants/colors.ts) — and the
          actual fault severity already has its own loud red banner further
          down, so this disc stays calm and lets the icon tint alone carry
          the difference. */}
      <View className="items-center gap-2 py-1">
        <View
          className={`h-[46px] w-[46px] items-center justify-center rounded-full ${
            healthy ? "bg-brand-soft dark:bg-brand-soft-dark" : "bg-chip dark:bg-chip-dark"
          }`}
        >
          <HeartPulseIcon
            size={22}
            className={
              !granted
                ? "text-danger dark:text-danger-dark"
                : !serviceConnected
                  ? "text-warn dark:text-warn-dark"
                  : "text-brand dark:text-brand-dark"
            }
          />
        </View>
        <Text className="text-center text-body font-extrabold text-fg dark:text-fg-dark">
          {healthHeadline(granted, serviceConnected)}
        </Text>
        <Text
          testID="health-card-last-capture"
          className="text-center text-secondary text-fg-2 dark:text-fg-2-dark"
        >
          {lastCaptureLabel(lastCaptureAt)}
        </Text>
        {/* Only when something IS waiting. A permanent "0 waiting" line is the
            kind of fixture a reader learns to skip, which is exactly the habit
            that would make the dropped-capture banner below invisible too. */}
        {pendingCaptures > 0 ? (
          <Text
            testID="health-card-pending"
            className="text-center text-secondary text-fg-2 dark:text-fg-2-dark"
          >
            {pendingCaptures === 1
              ? "1 capture waiting to be read"
              : `${pendingCaptures} captures waiting to be read`}
          </Text>
        ) : null}
      </View>

      {/* The two live permission facts, rule 1 — always shown, regardless of
          state, so the screen never makes the user guess what it already
          knows. Each is a `ListRow` with a status `Chip` on the right,
          established for exactly this screen: `tone="brand" fill="soft"` for
          granted, `tone="warn" fill="soft"` for a service that needs a
          check, `tone="neutral" fill="outline"` for not granted. A revoked
          permission stays in the calm "not-granted" bucket here — its actual
          severity is the loud dedicated banner below, not this row. */}
      <View className="mt-2 border-t border-line dark:border-line-dark">
        <ListRow
          title="Notification access"
          right={
            <Chip
              testID="health-card-granted"
              label={granted ? "Granted" : "Revoked"}
              tone={granted ? "brand" : "neutral"}
              fill={granted ? "soft" : "outline"}
            />
          }
        />
        <View className="border-t border-line dark:border-line-dark">
          <ListRow
            title="Listener service"
            right={
              <Chip
                testID="health-card-connected"
                label={serviceConnected ? "Connected" : "Disconnected"}
                tone={serviceConnected ? "brand" : "warn"}
                fill="soft"
              />
            }
          />
        </View>
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

      {/* GAP-051. The native buffer is capped at 500 sealed records and drops
          the oldest to take a new one, which used to be entirely silent. Amber
          rather than the red above: the loss is real but it is HISTORY, while
          the red banner is a fault still happening. `bg-warn` + `text-fg` is
          the pair components/home/safe_to_spend_hero.tsx already proved
          against AA on this exact fill — `warn-ink` is tuned for warn's soft
          tint and measures 1.4-2.2:1 on the solid one (constants/colors.ts).

          NO DISMISS. Nothing can un-drop a capture, so there is no state in
          which this stops being true; it clears only when the buffer it
          describes is wiped. */}
      {evictedCaptures > 0 ? (
        <View
          testID="health-card-evicted"
          className="mt-4 gap-2 rounded-lg bg-warn px-4 py-3 dark:bg-warn-dark"
        >
          <Text className="font-semibold text-fg dark:text-on-brand-dark">
            {evictedSentence(evictedCaptures)}
          </Text>
          <Text className="text-fg dark:text-on-brand-dark">
            PeraPlano can hold 500 unread notifications. These were pushed out before the app could
            read them, so they never reached your ledger and cannot be recovered. Opening the app
            more often stops it happening again.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}
