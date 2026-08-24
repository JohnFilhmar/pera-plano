// app/(onboarding)/access.tsx — the Notification Access step (m3c-onboarding-
// client plan Task 2, rules 1-3; docs/04-features/01-onboarding.md step 3).
// Third of the numbered flow's nine routed steps
// (lib/onboarding/onboarding_state.ts). Reached from how_it_works.tsx;
// advances to battery.tsx.
//
// VALUE BEFORE PERMISSION (rule 1): components/onboarding/access_explainer.tsx
// renders BEFORE the primary button ever opens the system screen, and stays
// mounted underneath it the whole time — there is no separate "now here's the
// system screen" transition screen, because OnboardingFrame's primary button
// IS the thing that opens it, wired below.
//
// AWAITING-RETURN, NOT AN UNCONDITIONAL RECHECK LOOP. Unlike
// app/(onboarding)/device_lock.tsx (a mandatory gate that must recheck on
// EVERY foreground return, forever, because the flow cannot proceed until
// secure), this step's system screen is optional and its outcome is checked
// exactly once, only after the user actually tapped through to it —
// `awaitingReturnRef` gates the AppState listener so a foreground return that
// never involved Settings (switching apps, a phone call) never fires
// isAccessGranted() at all. That is what "after returning from the system
// screen" (rule 3) means literally, not "every time the app resumes."
//
// GRANTED ADVANCES IMMEDIATELY; DECLINED SHOWS THE MESSAGE AND WAITS FOR A
// TAP. A user who said yes has nothing left to read on this screen. A user
// who said no is being told something new (rule 3's calm "you can turn this
// on later") and, same discipline as recovery_phrase.tsx's own "done" stage,
// that message must not be replaced by navigation before it can be read —
// so "declined" re-labels the primary button "Continue" and waits for an
// explicit tap rather than auto-advancing out from under it.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { AppState, type AppStateStatus } from "react-native";

import { AccessExplainer } from "@/components/onboarding/access_explainer";
import { OnboardingFrame } from "@/components/onboarding/onboarding_frame";
import { isAccessGranted, openAccessSettings } from "@/modules/notification_listener";

type Stage = "intro" | "declined";

export default function AccessScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("intro");

  // True only between "the user tapped the primary button on the intro
  // stage" and "the resulting AppState('active') recheck has run" — see this
  // file's header comment for why an unconditional listener would be wrong.
  const awaitingReturnRef = useRef(false);
  // Guards the recheck itself against a double-fire (e.g. two rapid
  // foreground transitions), the same discipline
  // app/(onboarding)/device_lock.tsx's checkInFlightRef uses.
  const checkInFlightRef = useRef(false);
  // Guards `advance` against a double-tap pushing the next route twice.
  const advancedRef = useRef(false);

  // nextStep("access") === "battery" (lib/onboarding/onboarding_state.ts) —
  // hardcoded here rather than computed, same reasoning as every other routed
  // step in this task: the literal has to match a real file
  // (app/(onboarding)/battery.tsx) for expo-router to resolve it, and a
  // dynamically built path cannot be checked against that at all.
  const advance = useCallback(() => {
    if (advancedRef.current) return;
    advancedRef.current = true;
    router.push("/(onboarding)/battery");
  }, [router]);

  const handlePrimary = useCallback(() => {
    if (stage === "declined") {
      advance();
      return;
    }
    awaitingReturnRef.current = true;
    openAccessSettings();
  }, [stage, advance]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next !== "active") return;
      if (!awaitingReturnRef.current) return;
      if (checkInFlightRef.current) return;

      awaitingReturnRef.current = false;
      checkInFlightRef.current = true;
      isAccessGranted()
        .then((granted) => {
          if (granted) {
            advance();
          } else {
            setStage("declined");
          }
        })
        .finally(() => {
          checkInFlightRef.current = false;
        });
    });
    return () => subscription.remove();
  }, [advance]);

  return (
    <OnboardingFrame
      step="access"
      title="Reading your money notifications"
      onPrimary={handlePrimary}
      primaryLabel={stage === "declined" ? "Continue" : "Turn on notification access"}
      onBack={() => router.back()}
      onSkip={advance}
    >
      <AccessExplainer outcome={stage === "declined" ? "declined" : undefined} />
    </OnboardingFrame>
  );
}
