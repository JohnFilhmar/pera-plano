// app/(onboarding)/alerts.tsx — the app's own alerts step (GAP-003;
// docs/04-features/01-onboarding.md step 4, which asks for a value screen and
// then the Android 13+ POST_NOTIFICATIONS dialog). Reached from
// first_limit.tsx; advances to done.tsx.
//
// THE DEFECT THIS SCREEN EXISTS TO CLOSE. `requestAlertPermission`
// (lib/alerts/alerts_service.ts) had no caller anywhere in the app. On
// Android 13+ POST_NOTIFICATIONS defaults to DENIED until something asks, and
// every notifier — limit_notifier, bill_reminders, loan_reminders,
// payday_notifier, tracking_notifier — reads the grant and returns silently
// when it is false. So on the test device (a Samsung A54 on Android 16) no
// alert of any kind could ever be displayed. This screen is the ask.
//
// THE DIALOG IS ONE-SHOT PER INSTALL, WHICH SHAPES EVERY BRANCH BELOW.
// Android shows the POST_NOTIFICATIONS dialog once; after a refusal
// `requestPermissionsAsync` resolves from what the OS remembers, with no
// dialog and nothing for the user to answer. A screen that simply re-called
// it after a "no" would look identical to one that was working and would
// leave the user tapping a button that does nothing — so a refusal switches
// the primary action to the phone's own settings page, which is the only
// remaining route to the grant. `requestAlertPermission` covers the other
// half itself: it reads the current grant first and never spends the dialog
// on someone who has already said yes.
//
// A REFUSAL IS NOT AN ERROR. docs step 4: "If declined, alerts still appear
// inside the app (Home alert area); only system notifications are lost.
// Skippable, no retry pressure." Both the skip link and the settings button
// advance, so there is no state this screen can be left stuck in.
//
// NO VALUE COMPONENT UNDER components/onboarding/, unlike access.tsx's
// AccessExplainer and battery.tsx's BatteryExplainer. There is one caller and
// there will only ever be one — the More hub's recovery row
// (app/(tabs)/more/index.tsx) is a ListRow, not a second rendering of this
// copy — so a shared component would be a file to keep in sync with nothing.
import { useCallback, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Linking, Text, View } from "react-native";

import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { Card } from "@/components/ui/card";
import { requestAlertPermission } from "@/lib/alerts/alerts_service";

/**
 * "intro" is the ask; "declined" is the state the one-shot dialog has already
 * been spent from. There is deliberately no "granted" stage: a grant advances
 * immediately, so nothing would ever render it.
 */
type Stage = "intro" | "declined";

/** What the user actually gets, in the order they will meet it. */
const PROMISES: readonly string[] = [
  "A limit alert at 50%, 80% and 100% — while there is still something to do about it.",
  "A reminder before each bill and loan is due, on the days you chose.",
  "A payday summary, and a warning if tracking ever stops quietly.",
];

export default function AlertsScreen({
  onDone,
  onBack,
}: { onDone?: () => void; onBack?: () => void } = {}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("intro");
  const [asking, setAsking] = useState(false);
  // Guards the request against a double-tap, the same discipline
  // app/(onboarding)/access.tsx's checkInFlightRef uses: `asking` is state
  // and does not settle until the next render, which is one tap too late.
  const askingRef = useRef(false);

  // nextStep("alerts") === "done" (lib/onboarding/onboarding_state.ts),
  // hardcoded so the literal matches a real file for expo-router to resolve.
  const advance = useCallback(() => {
    if (onDone) {
      onDone();
      return;
    }
    router.push("/(onboarding)/done");
  }, [onDone, router]);

  const goBack = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    router.back();
  }, [onBack, router]);

  const handlePrimary = useCallback(() => {
    // The dialog is already spent (see this file's header) — settings is the
    // only place the grant can still come from, so open it and let the user
    // out of the flow either way.
    if (stage === "declined") {
      void Linking.openSettings();
      advance();
      return;
    }
    if (askingRef.current) return;
    askingRef.current = true;
    setAsking(true);
    requestAlertPermission()
      .then((granted) => {
        if (granted) {
          advance();
          return;
        }
        setStage("declined");
      })
      .catch((error: unknown) => {
        // A request that throws is indistinguishable from a refusal from
        // here, and the recovery is the same one — showing it beats leaving
        // the user on a step whose only action failed silently.
        console.warn("the alert permission could not be requested", error);
        setStage("declined");
      })
      .finally(() => {
        askingRef.current = false;
        setAsking(false);
      });
  }, [stage, advance]);

  return (
    <OnboardingFrame
      step="alerts"
      title="Let PeraPlano warn you in time"
      onPrimary={handlePrimary}
      primaryLabel={stage === "declined" ? "Open phone settings" : "Turn on alerts"}
      primaryBusy={asking}
      onBack={goBack}
      onSkip={advance}
    >
      <Text
        testID="alerts-step-intro"
        className="text-body font-medium text-fg-2 dark:text-fg-2-dark"
      >
        A limit you have already blown past is a number, not a warning. Alerts are how PeraPlano
        reaches you while there is still something you can do about it.
      </Text>

      <Card testID="alerts-step-promises">
        {PROMISES.map((promise) => (
          <View key={promise} className="flex-row gap-2 py-1">
            <Text className="text-secondary font-medium text-brand dark:text-brand-dark">•</Text>
            <Text className="flex-1 text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
              {promise}
            </Text>
          </View>
        ))}
      </Card>

      {stage === "declined" ? (
        <Card testID="alerts-step-declined">
          <Text className="text-row font-bold text-fg dark:text-fg-dark">
            Android only asks this once
          </Text>
          <Text className="mt-1 text-secondary font-medium text-fg-2 dark:text-fg-2-dark">
            Nothing is broken — Home still shows every limit, every due bill and every warning.
            Only the phone&apos;s own notifications are off. To switch them on, allow
            notifications for PeraPlano in your phone&apos;s settings; More &rsaquo; Turn on
            alerts brings you back here any time.
          </Text>
        </Card>
      ) : null}
    </OnboardingFrame>
  );
}
