// app/(onboarding)/device_lock.tsx — the onboarding-time occurrence of the
// docs §5a device screen-lock requirement (docs/12-encryption-and-app-lock.md
// §5a; task-9a-brief.md). Runs BEFORE the recovery-phrase step (Task 10) and
// before any key is ever generated (rule 1): Android's KeyGenParameterSpec
// throws at key-generation time on a device with no screen lock, and there
// is no fallback that preserves the security claim (docs §5a) -- discovering
// that at generation time is a worse experience and leaves partial state, so
// this check runs first, on its own, with nothing else attempted yet.
//
// THE THREE RENDER STATES below are deliberately NOT the same as two:
// "checking" and "secure" both render null, but for different reasons, and
// collapsing that distinction would reintroduce the exact bug rule 2 warns
// against -- "checking" renders null only until the FIRST isDeviceSecure()
// resolves, specifically so a secure device is never shown so much as a
// flash of the explainer while that promise is in flight. Only "insecure"
// ever renders DeviceLockExplainer.
//
// ORDERING HAZARD, same shape as app/index.tsx's and app/lock.tsx's existing
// notes: this file is the FIRST thing to exist under app/(onboarding)/ --
// there is no index route in that group yet, and nothing in this codebase
// navigates here yet either. That wiring (an onboarding flow that pushes
// this screen, then the recovery-phrase step once this one is satisfied) is
// Task 10 / the M3c onboarding plan's job, exactly like app/lock.tsx's own
// "/(onboarding)" redirect already forward-references a route that doesn't
// resolve yet. This file's job is narrower and already fully testable on its
// own: given mount, report accurately whether the device is secure, and
// given a return from Settings, re-check rather than trust stale state.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { isDeviceSecure, openSecuritySettings } from "@/modules/notification_listener";
import { DeviceLockExplainer } from "@/components/onboarding/device_lock_explainer";

type Status = "checking" | "insecure" | "secure";

export default function DeviceLockScreen() {
  const [status, setStatus] = useState<Status>("checking");
  // Guards against an overlapping second isDeviceSecure() call -- the same
  // double-tap/double-fire discipline as contexts/lock_context.tsx's
  // unlockInFlightRef, applied here to the mount check racing an
  // AppState-triggered recheck.
  const checkInFlightRef = useRef(false);

  const check = useCallback(async () => {
    if (checkInFlightRef.current) return;
    checkInFlightRef.current = true;
    try {
      const secure = await isDeviceSecure();
      setStatus(secure ? "secure" : "insecure");
    } finally {
      checkInFlightRef.current = false;
    }
  }, []);

  // The initial check, on mount -- rule 1: before anything else in
  // onboarding runs.
  useEffect(() => {
    void check();
  }, [check]);

  // Rule 3: "on return, re-check. Loop until secure." Bounded by a real user
  // action every time (leaving for Settings and coming back), never a timer
  // or an auto-retry -- see lock_context.tsx's header comment on why an
  // unconditional auto-retry loop is exactly the bug shape this plan warns
  // about elsewhere.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") void check();
    });
    return () => subscription.remove();
  }, [check]);

  // "checking" and "secure" render identically (nothing) but for different
  // reasons -- see this file's header comment. Only "insecure" ever shows
  // the explainer, and rule 2 is exactly this: a device that was already
  // secure on the very first check never renders it, not even for a frame.
  if (status !== "insecure") {
    return null;
  }

  return <DeviceLockExplainer onOpenSettings={openSecuritySettings} />;
}
