// app/(onboarding)/index.tsx — the onboarding flow's own entry point and
// step sequencer (task-10-brief.md). Two call sites:
//
//   1. app/lock.tsx's "needs_onboarding" branch renders this DIRECTLY, the
//      same way it renders DeviceLockExplainer/RecoveryUnlockForm/
//      UnlockPrompt for every other status -- NOT via <Redirect>. The Stack
//      that a routed "/(onboarding)" screen would need to actually display
//      only mounts once app/_layout.tsx's AppShell reports lockStatus
//      "unlocked" (interface contract §10's four-condition gate), and a
//      brand-new user has no DEK yet, so that condition can never be true
//      before onboarding itself runs. A <Redirect> fired from a component
//      that isn't inside a mounted Stack only updates router state that
//      nothing is currently rendering -- it does not make the screen
//      appear. Rendering this component's own tree directly is what
//      actually makes app/(onboarding)/device_lock.tsx and recovery_phrase.tsx
//      reachable, closing the exact gap this file's own predecessor
//      (device_lock.tsx's header comment) flagged as "unreachable" and
//      left for this task to resolve.
//   2. Expo Router's normal file-based routing, once the app IS unlocked:
//      app/index.tsx redirects here (a real "/(onboarding)" navigation)
//      when `onboarding_complete` is still false. That covers the user who
//      already finished THIS task's two steps (keys exist) but hasn't
//      finished the rest of onboarding (M3c, not built yet) -- for that
//      user isDeviceSecure() is already true and getKeyState() is already
//      not "uninitialized", so the check below falls through to "/(tabs)",
//      a deliberate, temporary landing spot until M3c adds the steps that
//      actually belong after the phrase. Same "falls through" pattern this
//      codebase already uses for every not-yet-built next step (see
//      app/index.tsx's and app/lock.tsx's own prior header comments).
//
// ORDERING (task-10-brief rule 1 / docs §5a): device-lock renders FIRST and
// unconditionally, for every entry above. Nothing here calls generatePhrase()
// or initializeKeys() until DeviceLockScreen reports secure via onSecure --
// key generation needs a screen lock to exist, so asking for it any earlier
// would be building on sand. A user who ALREADY has keys skips both steps
// entirely (branch 2 above) -- showing the phrase-capture UI again to that
// user would display a brand-new, unrelated random phrase that has nothing
// to do with the one actually protecting their data, which is worse than
// unhelpful.
import { Redirect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { getKeyState } from "@/lib/crypto/key_manager";
import DeviceLockScreen from "./device_lock";
import RecoveryPhraseScreen from "./recovery_phrase";

type Step = "checking" | "device_lock" | "recovery_phrase" | "already_keyed";

export default function OnboardingIndexScreen() {
  const [step, setStep] = useState<Step>("checking");

  useEffect(() => {
    let cancelled = false;
    getKeyState().then((state) => {
      if (cancelled) return;
      setStep(state === "uninitialized" ? "device_lock" : "already_keyed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSecure = useCallback(() => setStep("recovery_phrase"), []);

  if (step === "checking") {
    return null;
  }

  if (step === "already_keyed") {
    return <Redirect href="/(tabs)" />;
  }

  if (step === "device_lock") {
    return <DeviceLockScreen onSecure={handleSecure} />;
  }

  return <RecoveryPhraseScreen />;
}
