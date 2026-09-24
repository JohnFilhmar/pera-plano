// lib/privacy/capture_guard.ts — Android's FLAG_SECURE, for the whole app.
//
// WHAT THIS REPLACES. Screenshot blocking used to live on exactly three
// surfaces: phrase_display.tsx, phrase_confirm.tsx and recovery_unlock_form.tsx,
// each holding its own `usePreventScreenCapture` key. Everything else -- every
// balance, every wallet, the whole transaction ledger, Safe-to-Spend, the
// review queue with parsed notification text in it -- was capturable and
// screen-recordable. The owner's call, 2026-09-08: the recovery words are not
// the only thing on this device worth protecting, and the guard goes app-wide.
//
// THE THREE SCOPED GUARDS STAY. They are now redundant under a global one, and
// they are kept anyway: they are the fallback if this call ever fails on a
// device (it is best-effort, see below), and removing three working guards to
// tidy up would be scope creep on a security control. The package ref-counts
// prevent/allow BY KEY, so a global key and three screen keys coexist without
// either releasing the other's flag.
//
// ONE EXEMPTION, AND IT IS DELIBERATE. Development builds stay capturable so
// the on-device verification walkthrough (docs/13) and bug reports can still
// carry screenshots. Production and preview are both guarded -- preview
// especially, because that is the build handed to other people.
//
// FLAG_SECURE IS ANDROID-EFFECTIVE, NOT A GUARANTEE, and this file does not
// pretend otherwise. It stops the system screenshot, the Recents thumbnail and
// screen recording; it cannot stop a second phone's camera, and some OEM builds
// honour it incompletely. It is a raised floor, not a wall.
//
// THE VISIBLE COST, so nobody files it as a bug: with the flag on, the app's
// thumbnail in the Recents switcher is blank, and screen sharing or casting
// shows nothing. That is the flag working.
import Constants from "expo-constants";
import { preventScreenCaptureAsync } from "expo-screen-capture";

/** This module's own prevent/allow key -- see the header for why keys matter. */
const CAPTURE_GUARD_KEY = "app-wide";

/**
 * Whether a build of this variant should block screen capture.
 *
 * FAILS TOWARDS PROTECTION. `undefined`, `""` and anything unrecognised all
 * return `true`. Those mean the config chain did not deliver what it should
 * have, and the safe reading of "I do not know which build this is" is to
 * guard it: an over-guarded development build costs the owner a screenshot,
 * while an unguarded production build puts a user's finances on screen for any
 * recorder. Only the exact string `development` opts out.
 */
export function shouldPreventCapture(variant: string | undefined): boolean {
  return variant !== "development";
}

/**
 * Turns the guard on for the whole app, once, at root mount.
 *
 * NEVER THROWS, NEVER REJECTS. The root layout calls this without awaiting it,
 * so a rejection would surface as an unhandled promise rejection during app
 * start, on a path that has nothing to do with whether the app can run. A
 * device that refuses the flag is a device with weaker protection, not a device
 * that should fail to boot.
 *
 * Logged rather than silent: `transform-remove-console` strips this from
 * production bundles, so it serves development and dev-client builds -- the
 * same trade pipeline.ts makes for its parse-stats guard, and for the same
 * reason, that a missing guard is survivable and an undiagnosable one is not.
 */
export async function applyCaptureGuard(): Promise<void> {
  const variant = Constants.expoConfig?.extra?.appVariant as string | undefined;
  if (!shouldPreventCapture(variant)) return;

  try {
    await preventScreenCaptureAsync(CAPTURE_GUARD_KEY);
  } catch (error) {
    console.warn("[privacy] the app-wide screen capture guard could not be set", error);
  }
}
