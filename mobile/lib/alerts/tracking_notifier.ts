// lib/alerts/tracking_notifier.ts — the tracking-interrupted push
// notification (m3c Task 8 audit fix;
// docs/06-information-architecture.md §6.1's "Listener health" row and
// §6.2 rule 4).
//
// FOUND MISSING BY THE m3c TASK 8 AUDIT. `trackingInterruptedAlertCopy`
// (alert_copy.ts) has carried both copy variants since the encryption
// amendment, and `useListenerHealth` (hooks/queries/use_listener_health.ts)
// already tells the Home tracking banner when capture is down — but nothing
// in the app ever turned that fact into the system notification IA §6.1
// describes ("PeraPlano stopped receiving notifications. Tap to fix
// tracking."). This file is that missing half: a real, tested function that
// posts it correctly, with the day-level anti-spam cap IA §6.2 rule 4 names.
// It is NOT YET CALLED from anywhere that observes a live health
// transition — see this task's report. The natural trigger is a listener
// registered in `app/_layout.tsx` beside the loan/bill reminder scheduling
// effects (the same file every other process-wide subscriber in this app is
// started from), which is out of this task's lane. Wiring the call is a
// follow-up for whoever owns that file: call
// `notifyTrackingInterrupted(pendingCount, systemClock.now())` when
// `useListenerHealth`'s result turns unhealthy.
import { trackingInterruptedAlertCopy } from "./alert_copy";
import { postAlert } from "./alerts_service";
import { CHANNEL_LIMITS } from "./channels";
import { getSetting, setSetting } from "@/lib/db/repos/app_settings_repo";
import type { EpochMs } from "@/types/domain";

/** IA §6.2 rule 4: "no more than one per day even across repeated interruptions." */
const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Pure half of rule 4's day cap: whether enough time has passed since the
 * last notice to post another one. `lastNotifiedAt === null` means never —
 * the fresh-install default — which always clears the gate.
 *
 * Split from `notifyTrackingInterrupted` so the cap's boundary arithmetic is
 * testable without a database or a mocked notification stack, the same way
 * `crossedThreshold` (limits/limit_engine.ts) is kept separate from
 * `notifyLimitAlerts`.
 *
 * WHAT THIS DOES NOT DO: IA §6.2 rule 4's fuller statement is "at most one
 * per DISTINCT interruption, and no more than one per day even across
 * repeated interruptions" — the first half implies a notice should not
 * repeat while the SAME outage continues, even within the day cap, and a
 * second one is warranted once the listener recovers and drops again. This
 * function enforces only the day cap (the one piece with an unambiguous,
 * testable trigger: a plain elapsed-time comparison); telling "still the same
 * outage" from "a fresh one" needs the caller to track a health transition,
 * which lives with whoever wires the live trigger, not in this pure
 * comparison. Left explicit here rather than silently claiming the fuller
 * rule is enforced.
 */
export function canNotifyTrackingInterrupted(lastNotifiedAt: EpochMs | null, now: EpochMs): boolean {
  if (lastNotifiedAt === null) return true;
  return now - lastNotifiedAt >= MIN_INTERVAL_MS;
}

/**
 * Posts the tracking-interrupted notice, unless the day cap is still in
 * effect.
 *
 * CHANNEL_LIMITS, NOT A NEW CHANNEL. Same reasoning as
 * `lib/income/payday_notifier.ts`: Android channel ids are permanent
 * (`channels.ts`'s own header), and IA §6.1 lists this channel's importance
 * as "High" — exactly what `CHANNEL_LIMITS` already carries — so reusing it
 * is the smallest correct choice rather than a new permanent id for one call
 * site.
 *
 * Returns the OS notification id, or `null` when the day cap is still in
 * effect or notification permission is denied (`postAlert`'s own contract —
 * the Home tracking banner is the surface that never depends on this).
 */
export async function notifyTrackingInterrupted(
  pendingCount: number,
  now: EpochMs,
): Promise<string | null> {
  const lastNotifiedAt = await getSetting("tracking_interrupted_last_notified_at");
  if (!canNotifyTrackingInterrupted(lastNotifiedAt, now)) return null;

  const id = await postAlert({
    channel: CHANNEL_LIMITS,
    copy: trackingInterruptedAlertCopy({ pendingCount }),
    // `kind` is the tap-routing discriminant `lib/alerts/alert_routes.ts`
    // switches on — IA §6.1: "Listener health → recovery screen (4.8)".
    data: { kind: "trackingInterrupted" },
    // IA §6.2 rule 7's ONE EXEMPTION, and this is the only call site in the
    // app that sets it: "everything EXCEPT listener-health warnings is held
    // and delivered after quiet hours end". It is right that this alert is
    // exempt — the listener being dead means the app is capturing nothing at
    // all, and a user who finds that out at 8am has lost a night of
    // transactions that no later notice can recover.
    //
    // FLAGGED HERE RATHER THAN INFERRED FROM `CHANNEL_LIMITS`. This notice
    // deliberately shares that channel with limit alerts (see the header
    // above), so a channel-based exemption in `alerts_service.ts` would exempt
    // every limit alert too — including the 100% breach rule 7 names by hand
    // as the thing that must wait for morning.
    bypassQuietHours: true,
  });
  await setSetting("tracking_interrupted_last_notified_at", now);
  return id;
}
