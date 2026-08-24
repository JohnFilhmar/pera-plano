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
// notes: this file used to be the FIRST thing to exist under
// app/(onboarding)/, with no index route in that group and nothing in this
// codebase navigating here. Task 10 (app/(onboarding)/index.tsx) closes that
// gap: it renders this screen first, unconditionally, and advances to the
// recovery-phrase step via the optional `onSecure` callback below, fired
// once (and only once) `check()` determines the device is secure. This
// file's OWN job stays narrower and unchanged: given mount, report
// accurately whether the device is secure, and given a return from
// Settings, re-check rather than trust stale state. `onSecure` is optional
// specifically so every test that predates it (constructing this component
// with zero props) keeps working unmodified.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { isDeviceSecure, openSecuritySettings } from "@/modules/notification_listener";
import { DeviceLockExplainer } from "@/components/onboarding/device_lock_explainer";

type Status = "checking" | "insecure" | "secure";

export default function DeviceLockScreen({ onSecure }: { onSecure?: () => void } = {}) {
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

  // Fires the caller's onward-navigation hook exactly once per transition
  // into "secure" -- deliberately a separate effect from check() itself, so
  // this stays a plain post-commit side effect rather than a call made
  // during state-setting. onSecure is optional so every pre-Task-10 test
  // (constructing this component with zero props) is unaffected.
  useEffect(() => {
    if (status === "secure") {
      onSecure?.();
    }
  }, [status, onSecure]);

  // "checking" and "secure" render identically (nothing) but for different
  // reasons -- see this file's header comment. Only "insecure" ever shows
  // the explainer, and rule 2 is exactly this: a device that was already
  // secure on the very first check never renders it, not even for a frame.
  if (status !== "insecure") {
    return null;
  }

  return <DeviceLockExplainer onOpenSettings={openSecuritySettings} />;
}
