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
//      finished the rest of onboarding -- for that user isDeviceSecure() is
//      already true and getKeyState() is already not "uninitialized", so the
//      check below falls through to the numbered flow's first screen (see
//      "THE NUMBERED FLOW" below), same as the fresh-install path once its
//      own pre-flow steps are done.
//
// THE PROVIDER STEP (provider-selection plan Task 4) is the first of "the
// steps that actually belong after the phrase" to exist. It runs in the
// FRESH-INSTALL sequence only -- branch 1 above.
//
// THE NUMBERED FLOW (m3c-onboarding-client plan Task 2; docs
// §04-features/01-onboarding.md) is lib/onboarding/onboarding_state.ts's nine
// skippable steps, starting at "welcome". Both "already_keyed" and "done"
// below redirect there now instead of straight to "/(tabs)" -- Task 1 left
// that wiring for whichever task actually built the "/welcome" route, since
// pointing a Redirect at a route that does not exist yet is the exact
// ordering hazard this codebase already hit and fixed once in
// app/index.tsx's own history (see that file's and app/lock.tsx's header
// comments). onboarding_state.ts's own header explains why landing BOTH
// branches on "welcome" specifically is correct rather than merely
// convenient: a freshly-provisioned user has no recorded step yet, and
// "welcome" is both the first step and what `readOnboardingStep` returns when
// there is nothing usable to resume from.
//
// THE ALREADY-KEYED BRANCH NO LONGER LANDS ON "welcome" UNCONDITIONALLY
// (GAP-067). It did, and that is what made an interrupted run a loop rather
// than a pause: the access and battery steps both send the user into system
// Settings, five minutes there trips the background re-lock, and on the way
// back this redirect threw away every step they had finished. It now resumes at
// the recorded step. See lib/onboarding/onboarding_state.ts's header for why
// the "progress is not persisted" reasoning was reversed.
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
//
// THE HANDOFF OUT OF BRANCH 1 (`onKeysReady`). Everything above is true of
// the three pre-flow screens, none of which touches the database. It stops
// being true the moment this sequencer runs out of them: the numbered flow
// navigates with `router.push` and its last four steps read and write the
// ledger, so it needs BOTH a mounted Stack and an unlocked database, and
// branch 1 has neither. The `<Redirect>` below was therefore only ever
// reachable-in-effect from branch 2 -- fired from branch 1 it updated router
// state nothing was rendering, and a first-session user was stranded until
// they force-quit and relaunched. `onKeysReady` (supplied only by
// app/lock.tsx, which is branch 1 by definition) hands control back to the
// lock gate instead; see contexts/lock_context.tsx's keysProvisioned for why
// "locked" is the correct and only destination. Branch 2 supplies no
// callback and keeps the redirect, which is right: there a navigator exists.
import { Redirect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { getKeyState } from "@/lib/crypto/key_manager";
import { readOnboardingStep } from "@/lib/onboarding/onboarding_state";
import type { OnboardingStep } from "@/lib/onboarding/onboarding_state";
import DeviceLockScreen from "./device_lock";
import RecoveryPhraseScreen from "./recovery_phrase";
import ProvidersScreen from "./providers";

type Step =
  | "checking"
  | "device_lock"
  | "recovery_phrase"
  | "providers"
  | "done"
  | "already_keyed";

export default function OnboardingIndexScreen({
  onKeysReady,
}: { onKeysReady?: () => void } = {}) {
  const [step, setStep] = useState<Step>("checking");
  // Where the numbered flow resumes. `null` until the read below answers, which
  // is also the only state the Redirect below can be reached in without one --
  // it falls back to "welcome", the pre-GAP-067 behaviour.
  const [resumeAt, setResumeAt] = useState<OnboardingStep | null>(null);

  useEffect(() => {
    let cancelled = false;
    getKeyState()
      .then(async (state) => {
        if (cancelled) return;
        if (state === "uninitialized") {
          setStep("device_lock");
          return;
        }
        // READ BEFORE THE STEP IS SET, so the Redirect never renders once with
        // "welcome" and then again with the real target -- the first one would
        // already have navigated.
        //
        // A read that throws falls back to "welcome" rather than propagating:
        // the `.catch` below would send an already-keyed user to "device_lock",
        // which re-runs the key check rather than the flow they were in.
        const resume = await readOnboardingStep().catch<OnboardingStep>(() => "welcome");
        if (cancelled) return;
        setResumeAt(resume);
        setStep("already_keyed");
      })
      // "device_lock", NOT A STUCK "checking". Without this catch a rejecting
      // bridge left the step at "checking" forever, and "checking" renders
      // `null` — a permanently blank screen with no spinner, no message and no
      // control, on the very first screen of a first install. Falling forward
      // to the device-lock step is the safe direction of the two: it re-checks
      // the device itself and, once satisfied, runs `initializeKeys()`, which
      // is a no-op-or-create rather than a destructive write, so a device that
      // turns out to be keyed after all is not harmed by arriving here. The
      // opposite guess ("already_keyed") would hand a brand-new user straight
      // to the numbered flow with no keys and no database behind it.
      .catch(() => {
        if (cancelled) return;
        setStep("device_lock");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSecure = useCallback(() => setStep("recovery_phrase"), []);
  // The provider picker runs AFTER the phrase, never before: it is the first
  // step that writes anything the listener will act on, and a user who
  // abandoned onboarding earlier would be left with a configured listener and
  // no recovery words for the data it goes on to collect.
  const handlePhraseDone = useCallback(() => setStep("providers"), []);
  const handleProvidersDone = useCallback(() => setStep("done"), []);

  // Both terminal steps mean the same thing to a caller: this sequencer has
  // nothing left to run and the keys it exists to create are on the device.
  const finished = step === "already_keyed" || step === "done";

  // In an effect rather than in the branch below, because `onKeysReady` sets
  // state in another component -- doing that during this one's render is the
  // "Cannot update a component while rendering a different component"
  // warning, and worse, it would run again on every re-render. `finished`
  // only ever flips false -> true, and keysProvisioned is itself idempotent
  // (it only moves "needs_onboarding"), so this fires exactly once.
  useEffect(() => {
    if (finished) onKeysReady?.();
  }, [finished, onKeysReady]);

  if (step === "checking") {
    return null;
  }

  if (finished) {
    // With a callback, the caller (app/lock.tsx) is mid-handoff and there is
    // no navigator for a Redirect to move -- rendering one would be the same
    // no-op this file's header describes. Without one, this component was
    // reached by routing, so the Redirect is the real forward action.
    return onKeysReady ? null : <Redirect href={`/(onboarding)/${resumeAt ?? "welcome"}`} />;
  }

  if (step === "device_lock") {
    return <DeviceLockScreen onSecure={handleSecure} />;
  }

  if (step === "recovery_phrase") {
    return <RecoveryPhraseScreen onDone={handlePhraseDone} />;
  }

  return <ProvidersScreen onDone={handleProvidersDone} />;
}
