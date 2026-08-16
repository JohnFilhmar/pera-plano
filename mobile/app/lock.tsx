// app/lock.tsx — composes the app-lock UI from contexts/lock_context.tsx's
// status (docs/12-encryption-and-app-lock.md §7, §11a; task-9-brief.md).
// Rendered directly by app/_layout.tsx's AppShell whenever lockStatus !==
// "unlocked" (the same pattern that file already uses for
// BootstrapErrorScreen) — not reached via router navigation, though living
// under app/ also registers it as the addressable route "/lock" for free.
//
// "needs_onboarding" renders app/(onboarding)/index.tsx's OnboardingIndexScreen
// DIRECTLY (task-10-brief.md) — an earlier version of this file used
// <Redirect href="/(onboarding)"> instead, back when that route did not
// exist yet. That approach could never have worked even once the route
// existed: the Stack a Redirect's target needs in order to actually render
// only mounts once AppShell reports lockStatus "unlocked" (interface
// contract §10's four-condition gate), and a brand-new user has no DEK, so
// that condition is never true before onboarding runs — a Redirect fired
// from here would only update router state that nothing is currently
// mounted to display. Rendering OnboardingIndexScreen directly is exactly
// what every OTHER non-"unlocked" status already does below
// (DeviceLockExplainer, RecoveryUnlockForm, UnlockPrompt); this just extends
// that same discipline to the one status that used to be the exception.
import OnboardingIndexScreen from "./(onboarding)/index";
import { DeviceLockExplainer } from "@/components/onboarding/device_lock_explainer";
import { RecoveryUnlockForm } from "@/components/lock/recovery_unlock_form";
import { UnlockPrompt } from "@/components/lock/unlock_prompt";
import { useLock } from "@/contexts/lock_context";
import { openSecuritySettings } from "@/modules/notification_listener";

export default function LockScreen() {
  const { status, errorMessage, unlock, submitRecoveryPhrase, keysProvisioned, wipeAndStartOver } =
    useLock();

  if (status === "checking") {
    return null;
  }

  if (status === "needs_onboarding") {
    // `onKeysReady` is the first-run handoff (contexts/lock_context.tsx's
    // keysProvisioned): the pre-flow above renders here with no navigator
    // mounted, so the moment it has nothing left to run, something has to
    // move the app on -- and the only correct destination is the ordinary
    // lock gate, since everything after this point needs both a mounted
    // Stack and an open database. Supplied ONLY here: the same component
    // reached by routing (app/index.tsx, once already unlocked) gets no
    // callback and keeps redirecting into the numbered flow, which is
    // exactly right when a navigator does exist.
    return <OnboardingIndexScreen onKeysReady={keysProvisioned} />;
  }

  if (status === "needs_device_lock") {
    // docs §5a's "mid-life removal" paragraph; task-9a-brief rule 5: the
    // device Keystore key died (removed screen lock) AND there is currently
    // no screen lock to re-wrap against, so recreateDeviceKek() would fail
    // outright. Same component the onboarding-time gate uses
    // (app/(onboarding)/device_lock.tsx) — see lock_context.tsx's header
    // comment for why this is rendered directly rather than via navigation.
    return <DeviceLockExplainer onOpenSettings={openSecuritySettings} />;
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
