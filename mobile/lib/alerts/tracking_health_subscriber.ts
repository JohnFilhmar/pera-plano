// lib/alerts/tracking_health_subscriber.ts — the caller
// `notifyTrackingInterrupted` never had. `tracking_notifier.ts`'s own header
// names this exact seam ("a listener registered in app/_layout.tsx beside the
// loan/bill reminder scheduling effects ... call
// `notifyTrackingInterrupted(...)` when `useListenerHealth`'s result turns
// unhealthy") and left it as a follow-up.
//
// WHY A SUBSCRIBER AND NOT AN EFFECT ON THE HOME SCREEN. `TrackingBanner`
// already covers the user who is looking at the app. The push exists for the
// case that actually loses data: the listener dies, nobody opens the app for
// four days, and four days of transactions are gone with nothing to say so. A
// trigger that only fires while Home is mounted would be the banner again.
//
// THE HEALTH TEST IS TrackingBanner's, DELIBERATELY. Same two sources
// (`getListenerHealth`'s live native read, and the user's own `capture_enabled`
// switch) in the same precedence: a user who paused on purpose is NOT having a
// fault. Showing one to them trains them to ignore the real one — the reason
// hooks/queries/use_listener_health.ts keeps the two facts apart in the first
// place. The two surfaces must never disagree about what "interrupted" means.
//
// TRANSITIONS, NOT STATES. IA §6.2 rule 4 is "at most one per DISTINCT
// interruption, and no more than one per day even across repeated
// interruptions". `notifyTrackingInterrupted` enforces only the day cap and
// says so; the first half needs a caller that remembers whether the outage it
// is looking at is the same one it already announced. That memory lives here,
// per subscription — so a process restart during a continuing outage can
// re-announce once, which the day cap then bounds.
import { AppState, type AppStateStatus } from "react-native";

import { systemClock } from "@/lib/clock";
import { getSetting } from "@/lib/db/repos/app_settings_repo";
import { getListenerHealth } from "@/modules/notification_listener";

import { notifyTrackingInterrupted } from "./tracking_notifier";

/**
 * Whether capture is broken RIGHT NOW, or `null` when the facts could not be
 * read at all.
 *
 * Paused is not broken (the user's switch wins, exactly as in
 * `TrackingBanner`); granted-but-disconnected is, and it is the silent failure
 * this whole path exists for.
 */
async function isInterrupted(): Promise<boolean> {
  const [health, captureEnabled] = await Promise.all([
    getListenerHealth(),
    getSetting("capture_enabled"),
  ]);
  if (!captureEnabled) return false;
  return !health.granted || !health.serviceConnected;
}

/**
 * One health check, posting the notice when capture is interrupted.
 *
 * `wasInterrupted` is the caller's memory of the previous check: passing
 * `true` suppresses the post, because a continuing outage is not a new one.
 * Returns the health it observed so the caller can carry it to the next check.
 *
 * CLOCK-INJECTED like every entry point under lib/ — the day cap is elapsed-time
 * arithmetic, and a module that reads the wall clock itself can only be tested
 * by waiting for tomorrow.
 *
 * A FAILURE HERE IS SWALLOWED. A native bridge that is missing, a database that
 * is not open yet, a refused notification — none of them may reach the caller,
 * which is a fire-and-forget effect in the root layout.
 */
export async function runTrackingHealthCheck(
  now: number,
  wasInterrupted = false,
): Promise<boolean> {
  try {
    const interrupted = await isInterrupted();
    if (interrupted && !wasInterrupted) {
      // NO COUNT IS PASSED, AND NONE CAN BE. A dead listener captures nothing,
      // so the app has no record of what it missed, and the native module
      // exposes no non-destructive count of the capture buffer
      // (`drainPendingCaptures` empties it). A native `countPendingCaptures()`
      // is in the v2 backlog; until it exists, this notice states no figure.
      await notifyTrackingInterrupted(now);
    }
    return interrupted;
  } catch (error) {
    console.warn("the tracking health check failed; the app runs without it", error);
    // Unchanged rather than `false`: a failed read is not evidence that a
    // known outage ended, and reporting recovery would re-arm the notice.
    return wasInterrupted;
  }
}

/**
 * Checks listener health now and on every return to the foreground, posting the
 * tracking-interrupted notice on a fresh outage. Returns the teardown.
 *
 * FOREGROUND IS THE RIGHT WAKE-UP and the only one available: notification
 * access is revocable from system settings at any moment with no callback to
 * this app (`isAccessGranted`'s own doc), so the fact has to be re-asked rather
 * than subscribed to — the same reason app/(tabs)/more/listener_health.tsx
 * re-invalidates its query on `AppState` "active".
 */
export function startTrackingHealthSubscriber(): () => void {
  let wasInterrupted = false;
  // A check is two awaited reads plus a post. Two overlapping checks would both
  // see the pre-check `wasInterrupted` and both decide the outage was new,
  // which is the duplicate notice this subscriber exists to prevent — a fast
  // background/foreground flick is enough to cause it.
  let inFlight = false;

  const check = (): void => {
    if (inFlight) return;
    inFlight = true;
    void runTrackingHealthCheck(systemClock.now(), wasInterrupted).then((interrupted) => {
      wasInterrupted = interrupted;
      inFlight = false;
    });
  };

  check();

  const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state !== "active") return;
    check();
  });

  return () => subscription.remove();
}
