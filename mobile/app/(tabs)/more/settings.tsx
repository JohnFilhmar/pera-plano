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
//
// IT DOES CARRY QUIET HOURS, THOUGH. docs/06-information-architecture.md §6.2
// rule 7 says the window is "user-adjustable", and a default the user cannot
// change is not adjustable — so unlike the per-channel toggles above, this one
// has a real setting behind it (`quiet_hours_*` in
// `lib/db/repos/app_settings_repo.ts`) that `lib/alerts/alerts_service.ts`
// reads on every post. Android's own notification settings cannot provide it:
// this is an app-level hold-and-redeliver rule, not a channel property.
import type { ReactNode } from "react";
import { Linking, ScrollView, Switch, Text, View } from "react-native";

import { ThemePicker } from "@/components/settings/theme_picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ListRow } from "@/components/ui/list_row";
import { SectionHeader } from "@/components/ui/section_header";
import { useSetSetting } from "@/hooks/mutations/use_set_setting";
import { useSettings } from "@/hooks/queries/use_settings";
import { MINUTES_PER_DAY } from "@/lib/alerts/notification_policy";
import { formatMinuteOfDay } from "@/lib/datetime";

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

/**
 * Half-hour steps for the quiet-hours bounds (IA §6.2 rule 7's
 * "user-adjustable"). Both ends of the window are the kind of thing people
 * express to the nearest half hour — "about nine", "about eight" — and a
 * 30-minute step keeps the whole 24 hours reachable in 48 taps from either
 * direction without a picker component the app does not have.
 */
const QUIET_STEP_MINUTES = 30;

/**
 * WRAPS instead of clamping, unlike the multiplier stepper above. The window
 * itself wraps midnight — that is the entire subtlety of rule 7 — so a start
 * time that could not step from 23:30 to 00:00 would make the most ordinary
 * settings (a window starting late) unreachable from one direction.
 */
function stepMinuteOfDay(minute: number, delta: number): number {
  return (minute + delta + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * mobile-ui-revamp Part 3 Task 4: `components/settings/setting_row.tsx`'s own
 * hand-rolled row becomes the shared `ListRow` atom, Card-wrapped exactly as
 * `SettingRow` already was — "each row is its own Card, not a divided list"
 * is that file's own deliberate rule, and this keeps it rather than silently
 * merging six rows into one shared card. `setting_row.tsx` itself is outside
 * this task's file list (`components/settings/*` is not one of the globs the
 * brief names), so this is a LOCAL replacement built from atoms already in
 * scope (`Card`, `ListRow`) rather than an edit to that file.
 */
function SettingCard({
  title,
  subtitle,
  subtitleLines,
  control,
  testID,
}: {
  title: string;
  subtitle?: string;
  /** Forwarded to `ListRow` untouched — see that prop's own doc for the default. */
  subtitleLines?: number;
  control: ReactNode;
  testID?: string;
}) {
  return (
    <Card testID={testID}>
      <ListRow title={title} subtitle={subtitle} subtitleLines={subtitleLines} right={control} />
    </Card>
  );
}

/**
 * A ± stepper over one wall-clock time, rendered as the right-hand control of
 * a `SettingCard`. Same shape as the multiplier stepper below it — this is a
 * component only because there are two of them (start and end) and a copy of
 * the same six lines is how the two ends drift apart.
 */
function TimeStepper(props: {
  testID: string;
  label: string;
  onStep: (delta: number) => void;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Button
        testID={`${props.testID}-decrement`}
        title="−"
        variant="secondary"
        onPress={() => props.onStep(-QUIET_STEP_MINUTES)}
      />
      <Text
        testID={`${props.testID}-value`}
        className="w-20 text-center text-base font-semibold text-fg dark:text-fg-dark"
      >
        {props.label}
      </Text>
      <Button
        testID={`${props.testID}-increment`}
        title="+"
        variant="secondary"
        onPress={() => props.onStep(QUIET_STEP_MINUTES)}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { data: settings } = useSettings();
  const setTelemetryEnabled = useSetSetting<"telemetry_enabled">();
  const setForgetMultiplier = useSetSetting<"recurring_forget_multiplier">();
  const setQuietEnabled = useSetSetting<"quiet_hours_enabled">();
  const setQuietStart = useSetSetting<"quiet_hours_start_minute">();
  const setQuietEnd = useSetSetting<"quiet_hours_end_minute">();

  // Render nothing until the store has loaded — same convention as
  // app/(tabs)/plan/income.tsx: a settings screen that flashes defaults
  // before the real stored values reads as the app forgetting what the user
  // chose, even for the instant before the read resolves.
  if (settings === undefined) {
    return <View testID="settings-loading" className="flex-1 bg-bg dark:bg-bg-dark" />;
  }

  const multiplier = settings.recurring_forget_multiplier;
  const paymentsWord = multiplier === 1 ? "missed payment" : "missed payments";
  const quietEnabled = settings.quiet_hours_enabled;
  const quietStart = settings.quiet_hours_start_minute;
  const quietEnd = settings.quiet_hours_end_minute;

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
      <SettingCard
        testID="settings-alerts-row"
        title="Notification settings"
        subtitle="Limit warnings and due-date reminders are separate channels — mute or reshape either one in your phone's settings."
        // 114 characters beside an "Open" button — fix-round-1.
        subtitleLines={4}
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
      <SettingCard
        testID="settings-quiet-hours-row"
        title="Quiet hours"
        subtitle="Alerts raised while you're asleep wait until the window ends and arrive together — nothing is dropped. Warnings that tracking has stopped still come through."
        // 157 characters, this row's longest — fix-round-1.
        subtitleLines={5}
        control={
          <Switch
            testID="settings-quiet-hours-toggle"
            value={quietEnabled}
            onValueChange={(value) =>
              setQuietEnabled.mutate({ key: "quiet_hours_enabled", value })
            }
          />
        }
      />
      {/* The bounds only exist when the window does — showing two steppers
          that change nothing is worse than showing none. */}
      {quietEnabled ? (
        <>
          <SettingCard
            testID="settings-quiet-hours-start-row"
            title="Quiet from"
            control={
              <TimeStepper
                testID="settings-quiet-start"
                label={formatMinuteOfDay(quietStart)}
                onStep={(delta) =>
                  setQuietStart.mutate({
                    key: "quiet_hours_start_minute",
                    value: stepMinuteOfDay(quietStart, delta),
                  })
                }
              />
            }
          />
          <SettingCard
            testID="settings-quiet-hours-end-row"
            title="Quiet until"
            control={
              <TimeStepper
                testID="settings-quiet-end"
                label={formatMinuteOfDay(quietEnd)}
                onStep={(delta) =>
                  setQuietEnd.mutate({
                    key: "quiet_hours_end_minute",
                    value: stepMinuteOfDay(quietEnd, delta),
                  })
                }
              />
            }
          />
        </>
      ) : null}

      <SectionHeader title="Recurring" />
      <SettingCard
        testID="settings-recurring-forget-row"
        title={`Forget a subscription after ${formatMultiplier(multiplier)} ${paymentsWord}`}
        subtitle="We can only see a charge arrive, never a cancellation — this is how much silence, scaled to how often it charges, counts as gone."
        // 129 characters beside the three-part −/value/+ stepper — the
        // narrowest control of the four rows here, so despite being
        // shorter than quiet-hours' subtitle this one needs more lines,
        // not fewer. fix-round-1.
        subtitleLines={6}
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
      <SettingCard
        testID="settings-telemetry-row"
        title="Share anonymous parser health"
        // RULE 3, VERBATIM PROMISE — "states plainly what is sent: counts of
        // successful and failed parses per provider, and nothing else — no
        // notification content, no amounts, no merchants." Telemetry itself
        // ships in m3c Task 6; this copy is the contract that implementation
        // must satisfy, not the other way around.
        subtitle="When on, PeraPlano shares only counts of successful and failed notification parses, per provider. Never notification content, amounts, or merchant names."
        // 153 characters beside a bare Switch — fix-round-1, the Critical
        // finding: this is the row whose clipped last clause was the
        // "never notification content, amounts, or merchant names"
        // promise itself.
        subtitleLines={5}
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
