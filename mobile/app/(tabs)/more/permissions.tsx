// app/(tabs)/more/permissions.tsx — the permissions checklist (GAP-018).
// Route: /more/permissions.
//
// WHY THIS SCREEN EXISTS. Every grant PeraPlano needs is offered exactly once,
// inside onboarding, and every one of them is skippable on purpose
// (docs/04-features/01-onboarding.md). Skipping used to be permanent: nothing
// in the installed app asked a second time, so the only way back was a
// reinstall. docs/04-features/01-onboarding.md has promised "a permissions
// checklist in Settings & Privacy [that lets] every skipped grant be completed
// later" since v1 and this is it.
//
// NESTED UNDER app/(tabs)/more/, matching every other screen in this folder —
// NOT a sibling app/more/ tree, which would collide on the same /more/* URL
// space (see reports.tsx's own header for the five times that has landed).
//
// THREE ROWS, ONLY TWO OF THEM READABLE. Notification access
// (`isAccessGranted`) and the Android 13+ alerts permission
// (`Notifications.getPermissionsAsync`) both answer honestly. The battery
// exemption does NOT: nothing in modules/notification_listener surfaces
// `isIgnoringBatteryOptimizations`, and app/(onboarding)/battery.tsx's header
// records why an unverifiable recheck loop was not built for it. So that row
// carries no state claim at all and its action is always offered — the one
// thing this screen can honestly do for it.
//
// "COULDN'T READ IT" IS NEVER RENDERED AS "OFF". A read that threw tells us
// nothing about the grant, and a screen that turns a failed read into "Off"
// teaches the user to distrust the two rows that ARE accurate. `null` (still
// reading) and "unknown" (the read failed) each get their own chip, and
// neither one is the word "Off".
//
// NEVER RE-REQUESTS AFTER A REFUSAL. Android spends the POST_NOTIFICATIONS
// dialog on the first ask and answers every later request from what it
// remembers, showing nothing — so once `canAskAgain` is false this screen
// stops asking and opens the phone's settings instead, exactly as the "Turn
// on alerts" row on app/(tabs)/more/index.tsx (GAP-003) already does. Both
// paths are the SAME `requestAlertPermission`; this screen adds no second way
// to spend that one dialog.
//
// RE-READS ON FOREGROUND, NOT ON FOCUS — the same call app/(tabs)/more/
// index.tsx's alerts row and app/(tabs)/more/listener_health.tsx both make.
// Every action here hands the user to ANOTHER app (system settings), and
// leaving PeraPlano never unfocuses this screen, so `useFocusEffect` would
// not fire on the one return that matters.
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, ScrollView, Text, View } from "react-native";

import { OemGuidance } from "@/components/privacy/oem_guidance";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import type { ChipFill, ChipTone } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list_row";
import { SectionHeader } from "@/components/ui/section_header";
import { requestAlertPermission } from "@/lib/alerts/alerts_service";
import { openBatterySettings } from "@/lib/onboarding/battery_settings";
import { isAccessGranted, openAccessSettings } from "@/modules/notification_listener";

/**
 * What this screen knows about one grant. `"unknown"` is a FAILED read, not a
 * pending one — pending is `null` at the call site, so the two never collapse
 * into one hedge (see this file's header).
 */
type GrantState = "granted" | "missing" | "unknown";

/**
 * `canAskAgain` is the half that decides whether a tap can still raise the
 * one-shot POST_NOTIFICATIONS dialog or has to send the user to the settings
 * app instead.
 */
type AlertGrant = { state: GrantState; canAskAgain: boolean };

const CHIP_FOR_STATE: Record<GrantState, { label: string; tone: ChipTone; fill: ChipFill }> = {
  // "Granted"/"Revoked" belong to components/privacy/health_card.tsx's live
  // fault view; this is a checklist, so the words are the ones a settings
  // screen uses. Tones match that card either way: brand-soft for held,
  // neutral-outline for anything else, so nothing here shouts.
  granted: { label: "On", tone: "brand", fill: "soft" },
  missing: { label: "Off", tone: "neutral", fill: "outline" },
  unknown: { label: "Can't tell", tone: "neutral", fill: "outline" },
};

const CHECKING_CHIP = { label: "Checking…", tone: "neutral", fill: "outline" } as const;

async function readAccessGrant(): Promise<GrantState> {
  try {
    return (await isAccessGranted()) ? "granted" : "missing";
  } catch {
    return "unknown";
  }
}

/**
 * `getPermissionsAsync` DIRECTLY, not through lib/alerts/alerts_service.ts —
 * the same call app/(tabs)/more/index.tsx documents at length: that module's
 * own non-prompting read (`hasPermission`) is deliberately unexported, and
 * widening it for a settings row would invite a posting path to start asking.
 * The only mutation either screen can cause is `requestAlertPermission`.
 */
async function readAlertGrant(): Promise<AlertGrant> {
  try {
    const status = await Notifications.getPermissionsAsync();
    return { state: status.granted ? "granted" : "missing", canAskAgain: status.canAskAgain };
  } catch {
    return { state: "unknown", canAskAgain: false };
  }
}

/**
 * One row: what the permission is for, what state it is in, and the single
 * action that can change it.
 *
 * `action` IS `null` ONCE THE GRANT IS HELD, and that is the point of the
 * whole screen — a button that cannot change anything is a button that
 * teaches the user their tap did nothing. A failed read keeps its action:
 * opening settings is harmless and costs one hop, where hiding it would strand
 * a user whose grant really is missing.
 */
function PermissionCard({
  testID,
  title,
  subtitle,
  subtitleLines,
  state,
  action,
}: {
  testID: string;
  title: string;
  subtitle: string;
  subtitleLines: number;
  state: GrantState | null;
  action: { testID: string; label: string; onPress: () => void } | null;
}) {
  const chip = state === null ? CHECKING_CHIP : CHIP_FOR_STATE[state];

  return (
    <Card testID={testID}>
      <ListRow
        title={title}
        subtitle={subtitle}
        subtitleLines={subtitleLines}
        right={
          <Chip
            testID={`${testID}-state`}
            label={chip.label}
            tone={chip.tone}
            fill={chip.fill}
          />
        }
      />
      {action ? (
        <View className="mt-3">
          <Button
            testID={action.testID}
            title={action.label}
            variant="secondary"
            onPress={action.onPress}
          />
        </View>
      ) : null}
    </Card>
  );
}

export default function PermissionsScreen() {
  const [access, setAccess] = useState<GrantState | null>(null);
  const [alerts, setAlerts] = useState<AlertGrant | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readAccessGrant().then((next) => {
        if (!cancelled) setAccess(next);
      });
      void readAlertGrant().then((next) => {
        if (!cancelled) setAlerts(next);
      });
    };
    refresh();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  const canAskForAlerts = alerts?.canAskAgain ?? false;

  const turnOnAlerts = useCallback(() => {
    // ONE SHOT, EVER — see this file's header. Once Android is done prompting,
    // settings is the only route left.
    if (!canAskForAlerts) {
      void Linking.openSettings();
      return;
    }
    requestAlertPermission()
      .then(async (granted) => {
        if (granted) {
          setAlerts({ state: "granted", canAskAgain: false });
          return;
        }
        // The refusal just spent the dialog, so re-read rather than assume:
        // the next tap has to go to settings instead of asking again.
        setAlerts(await readAlertGrant());
      })
      .catch((error: unknown) => {
        console.warn("the alert permission could not be requested", error);
      });
  }, [canAskForAlerts]);

  return (
    <ScrollView
      testID="permissions-screen"
      className="flex-1 bg-bg dark:bg-bg-dark"
      contentContainerClassName="gap-3 p-4"
    >
      <Text className="text-secondary text-fg-2 dark:text-fg-2-dark">
        Setup asks for each of these once, and every one of them can be skipped. Turn any of them
        on here — PeraPlano never asks a second time on its own.
      </Text>

      <SectionHeader title="Tracking" />

      <PermissionCard
        testID="permissions-access"
        title="Notification access"
        subtitle="Lets PeraPlano read bank and e-wallet notifications. Nothing is tracked without it."
        // 82 characters / 22 — the same chars-per-line figure every row on
        // app/(tabs)/more/index.tsx uses (see that file's SUBTITLELINES note).
        subtitleLines={4}
        state={access}
        action={
          access === "granted"
            ? null
            : {
                testID: "permissions-open-access-settings",
                // Android's access list, not a dialog: there is no runtime
                // request for a NotificationListenerService, which is why
                // app/(onboarding)/access.tsx sends the user out too.
                label: "Open notification access settings",
                onPress: openAccessSettings,
              }
        }
      />

      <PermissionCard
        testID="permissions-alerts"
        title="Alerts"
        subtitle="Lets limit warnings and due-date reminders reach your phone."
        // 59 characters / 22.
        subtitleLines={3}
        state={alerts === null ? null : alerts.state}
        action={
          alerts !== null && alerts.state === "granted"
            ? null
            : {
                testID: "permissions-turn-on-alerts",
                // The same two labels app/(onboarding)/alerts.tsx uses for the
                // same two cases, so the second encounter reads like the first.
                label: canAskForAlerts ? "Turn on alerts" : "Open phone settings",
                onPress: turnOnAlerts,
              }
        }
      />

      <PermissionCard
        testID="permissions-battery"
        title="Battery exemption"
        subtitle="Stops your phone sleeping PeraPlano in the background. Android never reports this one back, so it isn't shown above."
        // 118 characters / 22.
        subtitleLines={6}
        // "Can't tell", NEVER "Off", and not because a read failed — there is
        // no read at all (see this file's header). Same chip either way on
        // purpose: from the user's side "PeraPlano cannot see this" is one
        // fact, and it is the only honest one this row has.
        state="unknown"
        action={{
          testID: "permissions-open-battery-settings",
          label: "Open battery settings",
          onPress: openBatterySettings,
        }}
      />

      {/* The same guidance app/(onboarding)/battery.tsx shows beside its own
          step, mounted the same way — no `brand` prop, so it resolves the real
          device's manufacturer and falls back to generic advice for anyone
          else. "Open battery settings" lands on a list whose menu names differ
          per skin, so the shortcut without the guidance is half an answer. */}
      <OemGuidance />

      {/* Clears the tab bar on short devices. */}
      <View className="h-8" />
    </ScrollView>
  );
}
