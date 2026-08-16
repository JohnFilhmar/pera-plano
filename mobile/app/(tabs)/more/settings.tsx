// app/(tabs)/more/settings.tsx — the Settings screen (M3b Task 5;
// docs/04-features/11-settings-privacy.md). Route: /more/settings.
//
// FOUR SECTIONS, MATCHING WHAT IS ACTUALLY SHIPPED TODAY, not the doc's full
// five-section structure. docs/04-features/11-settings-privacy.md's
// "Settings structure" table also names Tracking (health indicator, per-
// provider pause) and Backup (Plus cloud sync). Tracking and per-provider
// pause are real, shipped screens as of m3b Task 8 — Listener health
// (app/(tabs)/more/listener_health.tsx) and the Privacy centre's provider
// switches (app/(tabs)/more/privacy.tsx) — reached from their own rows on the
// More hub rather than duplicated as a Settings section; cloud backup still
// has no service behind it at all. Building a Settings row for backup would
// be dead UI wired to nothing, so this screen covers exactly the brief's
// three: theme (Appearance), alert preferences (Alerts), and the telemetry
// opt-out (Data & privacy) — plus the
// owner's 2026-08-16 addition, the subscription-forget multiplier
// (Recurring), which belongs here rather than on the gated Subscriptions
// screen because it is a preference, not a view of detected patterns.
//
// APPEARANCE READS/WRITES `useTheme()` DIRECTLY, never `use_set_setting`. See
// `components/settings/theme_picker.tsx`'s header for why routing the same
// preference through `app_settings_repo` as well would be a second,
// independently-timed persistence path for one value.
//
// ALERTS HAS NO PER-TYPE TOGGLES. docs/04-features/11-settings-privacy.md's
// Alerts row envisions one switch per channel in the canonical list (limit
// alerts, bill/loan reminders, goal updates, the Review Queue digest, payday
// summary) — but today the app has exactly two real Android notification
// channels (`lib/alerts/channels.ts`: `limits`, `reminders`) and no
// `AppSettings` key or service check for anything finer than that. Android
// channel importance is also immutable in-app once created (channels.ts's own
// comment: "the OS lets the app change only its name and description"), so a
// per-type in-app switch could not actually mute a channel even if one
// existed. Rather than build six toggles that write settings nothing reads,
// this row is honest about where that control lives today: the system
// notification settings screen, one tap away.
import { Linking, ScrollView, Switch, Text, View } from "react-native";

import { SettingRow } from "@/components/settings/setting_row";
import { ThemePicker } from "@/components/settings/theme_picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section_header";
import { useSetSetting } from "@/hooks/mutations/use_set_setting";
import { useSettings } from "@/hooks/queries/use_settings";

/** Owner decision 2026-08-16: the multiplier's editable range and step. */
const MULTIPLIER_MIN = 1;
const MULTIPLIER_MAX = 3;
const MULTIPLIER_STEP = 0.25;

function clampMultiplier(value: number): number {
  return Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, value));
}

/** All values here are exact multiples of 0.25, so no toFixed rounding noise. */
function formatMultiplier(value: number): string {
  return String(value);
}

export default function SettingsScreen() {
  const { data: settings } = useSettings();
  const setTelemetryEnabled = useSetSetting<"telemetry_enabled">();
  const setForgetMultiplier = useSetSetting<"recurring_forget_multiplier">();

  // Render nothing until the store has loaded — same convention as
  // app/(tabs)/plan/income.tsx: a settings screen that flashes defaults
  // before the real stored values reads as the app forgetting what the user
  // chose, even for the instant before the read resolves.
  if (settings === undefined) {
    return <View testID="settings-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  const multiplier = settings.recurring_forget_multiplier;
  const paymentsWord = multiplier === 1 ? "missed payment" : "missed payments";

  function stepMultiplier(delta: number): void {
    const next = clampMultiplier(multiplier + delta);
    if (next === multiplier) return;
    setForgetMultiplier.mutate({ key: "recurring_forget_multiplier", value: next });
  }

  return (
    <ScrollView
      testID="settings-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-1 p-4"
    >
      <SectionHeader title="Appearance" />
      <Card testID="settings-appearance">
        <Text className="mb-3 text-sm text-fg-2 dark:text-fg-2-dark">
          Auto follows your phone's system setting.
        </Text>
        <ThemePicker />
      </Card>

      <SectionHeader title="Alerts" />
      <SettingRow
        testID="settings-alerts-row"
        title="Notification settings"
        subtitle="Limit warnings and due-date reminders are separate channels — mute or reshape either one in your phone's settings."
        control={
          <Button
            testID="settings-open-notification-settings"
            title="Open"
            variant="secondary"
            onPress={() => {
              void Linking.openSettings();
            }}
          />
        }
      />

      <SectionHeader title="Recurring" />
      <SettingRow
        testID="settings-recurring-forget-row"
        title={`Forget a subscription after ${formatMultiplier(multiplier)} ${paymentsWord}`}
        subtitle="We can only see a charge arrive, never a cancellation — this is how much silence, scaled to how often it charges, counts as gone."
        control={
          <View className="flex-row items-center gap-2">
            <Button
              testID="settings-forget-multiplier-decrement"
              title="−"
              variant="secondary"
              disabled={multiplier <= MULTIPLIER_MIN}
              onPress={() => stepMultiplier(-MULTIPLIER_STEP)}
            />
            <Text
              testID="settings-forget-multiplier-value"
              className="w-10 text-center text-base font-semibold text-fg dark:text-fg-dark"
            >
              {formatMultiplier(multiplier)}
            </Text>
            <Button
              testID="settings-forget-multiplier-increment"
              title="+"
              variant="secondary"
              disabled={multiplier >= MULTIPLIER_MAX}
              onPress={() => stepMultiplier(MULTIPLIER_STEP)}
            />
          </View>
        }
      />

      <SectionHeader title="Data & privacy" />
      <SettingRow
        testID="settings-telemetry-row"
        title="Share anonymous parser health"
        // RULE 3, VERBATIM PROMISE — "states plainly what is sent: counts of
        // successful and failed parses per provider, and nothing else — no
        // notification content, no amounts, no merchants." Telemetry itself
        // ships in m3c Task 6; this copy is the contract that implementation
        // must satisfy, not the other way around.
        subtitle="When on, PeraPlano shares only counts of successful and failed notification parses, per provider. Never notification content, amounts, or merchant names."
        control={
          <Switch
            testID="settings-telemetry-toggle"
            value={settings.telemetry_enabled}
            onValueChange={(value) =>
              setTelemetryEnabled.mutate({ key: "telemetry_enabled", value })
            }
          />
        }
      />
      {/* Spacer so the last card clears the tab bar on short devices. */}
      <View className="h-4" />
    </ScrollView>
  );
}
