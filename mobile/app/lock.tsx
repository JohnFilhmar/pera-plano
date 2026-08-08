// app/lock.tsx — composes the app-lock UI from contexts/lock_context.tsx's
// status (docs/12-encryption-and-app-lock.md §7, §11a; task-9-brief.md).
// Rendered directly by app/_layout.tsx's AppShell whenever lockStatus !==
// "unlocked" (the same pattern that file already uses for
// BootstrapErrorScreen) — not reached via router navigation, though living
// under app/ also registers it as the addressable route "/lock" for free.
//
// "needs_onboarding" redirects to "/(onboarding)", a route that does not
// exist in this codebase yet (it ships in a later task, per this file's own
// test) — mirroring app/index.tsx's existing established pattern for the
// exact same not-yet-built route.
import { Redirect, type Href } from "expo-router";
import { RecoveryUnlockForm } from "@/components/lock/recovery_unlock_form";
import { UnlockPrompt } from "@/components/lock/unlock_prompt";
import { useLock } from "@/contexts/lock_context";

export default function LockScreen() {
  const { status, errorMessage, unlock, submitRecoveryPhrase, wipeAndStartOver } = useLock();

  if (status === "checking") {
    return null;
  }

  if (status === "needs_onboarding") {
    // "/(onboarding)" does not exist as a route in this codebase yet — it
    // ships in a later task (mirroring app/index.tsx's identical, already-
    // established forward-reference to the same not-yet-built route).
    // Expo Router's typed routes (app.json's experiments.typedRoutes) can
    // only type-check hrefs against routes that already exist, so this cast
    // is the deliberate escape hatch until that route lands — remove it once
    // app/(onboarding)/ exists and this starts type-checking on its own.
    return <Redirect href={"/(onboarding)" as unknown as Href} />;
  }

  if (status === "needs_recovery") {
    return (
      <RecoveryUnlockForm
        errorMessage={errorMessage}
        onSubmitPhrase={submitRecoveryPhrase}
        onWipe={wipeAndStartOver}
      />
    );
  }

  return (
    <UnlockPrompt
      isAuthenticating={status === "authenticating"}
      errorMessage={errorMessage}
      onUnlock={unlock}
    />
  );
}
